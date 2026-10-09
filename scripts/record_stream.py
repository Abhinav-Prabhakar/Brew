"""Record golden event streams (the backend <-> frontend contract fixtures).

    uv run python scripts/record_stream.py --all            # all scenarios + design/data/demo-stream.jsonl
    uv run python scripts/record_stream.py --name closing   # one scenario

Runs the real sim headless in-process (policy D, continuous, fixed seed/date) and writes
``tests/fixtures/streams/<name>.jsonl``:

    {"kind":"meta", ...}                       scenario description incl. schema_sha256
    {"kind":"snapshot", "data": <GET /state>}  at the start time
    {"kind":"event", seq, sim_s, t, type, data}   one per event (the WebSocket envelope)
    {"kind":"checkpoint", "seq", "data": <GET /state>}  every 30 sim-min (only if something happened) + the end
    {"kind":"event", "seq":null, "sim_s", "t", "type":"rest.<name>", "data": <REST response>}  pseudo-events: what
        BrewLive.refresh() would fetch (same endpoints, served by the real FastAPI app in-process), at the start and
        every 30 sim-min: inventory, lots (one per key), purchasing, impact, comparison, forecast, bottlenecks, usage
        (pantry slot keys). ``advisor`` is skipped: it runs counterfactual forks (minutes) and the UI polls a job.

Recording is deterministic: same args -> byte-identical file (``--recorded-with`` pins the recorded_with field).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import orjson
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.api.world_manager import ManagedWorld
from brew.config.loader import load_scenario, repo_root
from brew.domain.timeutil import DAY_S
from brew.events.bus import EventRecord, envelope
from brew.events.schema import event_json_schema
from brew.policies.registry import make_policy
from brew.settings import Settings
from brew.sim import readmodels as rm
from brew.sim.world import World

START_DATE = "2026-10-06"  # a Tuesday
CHECKPOINT_EVERY_S = 30 * 60
FIXTURES = repo_root() / "tests" / "fixtures" / "streams"


def hm(s: str) -> float:
    """``"08:30"`` or ``"+1 07:10"`` (next day) -> sim seconds since day-0 midnight."""
    day = 0
    if s.startswith("+"):
        d, s = s.split(" ", 1)
        day = int(d[1:])
    h, m = s.split(":")
    return day * DAY_S + int(h) * 3600 + int(m) * 60


# name -> scenario spec. chaos/actions are scripted by sim time; "invest" goes through POST /invest in the API.
SCENARIOS: dict[str, dict[str, Any]] = {
    "morning_rush": {
        "seed": 7, "from": "07:55", "to": "10:30",
        "chaos": [{"at": "08:30", "kind": "equipment_down", "target": "espresso_machine", "duration_min": 30}],
        "actions": [{"at": "09:00", "kind": "set_price"}, {"at": "09:15", "kind": "serve_order"}],
    },
    "lunch_delivery": {
        "seed": 11, "from": "12:00", "to": "14:00",
        "chaos": [
            {"at": "12:30", "kind": "rider_shortage", "target": None, "duration_min": 45},
            {"at": "12:50", "kind": "rain_storm", "target": None, "duration_min": 40},
            {"at": "13:00", "kind": "supplier_delay", "target": None, "duration_min": 60},
        ],
        "actions": [{"at": "12:10", "kind": "invest", "key": "marketing_push"}],
    },
    "closing": {"seed": 7, "from": "20:30", "to": "+1 07:10", "chaos": [], "actions": []},
}  # fmt: skip


def schema_sha256() -> str:
    canon = json.dumps(event_json_schema(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode()).hexdigest()


def git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=repo_root(), capture_output=True, text=True, check=True
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def dumps(obj: Any) -> bytes:
    return orjson.dumps(obj, option=orjson.OPT_SERIALIZE_NUMPY)


def full_state(w: World) -> bytes:
    """What ``GET /worlds/{id}/state`` returns (readmodels.state + the status fields the router adds), serialised NOW:
    the read models hold references to live sim lists (order_nos, table_ids, ...) that keep mutating."""
    s = rm.state(w)
    s["world"].update({"status": "playing", "clock_mode": "open", "kind": "demo", "lagging": False})
    return dumps(s)


class LineSink:
    """Serialises every event the moment it is emitted (payloads may share lists with the live sim)."""

    def __init__(self, start_date: str) -> None:
        self.start_date = start_date
        self.min_seq = 0  # events with seq <= min_seq belong to the hydration and are dropped
        self.lines: list[bytes] = []
        self.n_events = 0

    def emit(self, ev: EventRecord) -> None:
        if ev.seq > self.min_seq:
            self.lines.append(dumps({"kind": "event", **envelope(ev, self.start_date)}))
            self.n_events += 1


def pick_price_change(w: World) -> tuple[str, float]:
    """A legal (charter-checked, non-staple, off-cooldown) owner price change at the current time."""
    for item in w.cfg.menu:
        if item.staple:
            continue
        m = w.menu[item.sku]
        for delta in (-5.0, 5.0, -10.0, 10.0):
            p = m.price + delta
            if p < item.min_price or p > item.max_price:
                continue
            chk = w.charter.check_price(item, m.price, p, w.now, m.last_change_s, False, False, False)
            if chk.ok and chk.price != m.price and chk.price == p:
                return item.sku, p
    raise RuntimeError("no legal price change found")


def pantry_keys() -> list[str]:
    """The inventory keys of the pantry shelf slots (``window.BrewPantry.SLOTS`` in design/pantry.js), minus 'rescue'."""
    src = (repo_root() / "design" / "pantry.js").read_text()
    block = src[src.index("const SLOTS = [") : src.index("const BY = ")]
    return [k for k in re.findall(r"\{id:'([a-z0-9_]+)'", block) if k != "rescue"]


class Rest:
    """The REST read models BrewLive.refresh() fetches, served by the real FastAPI app (in-process TestClient) over the
    recorded world, as ``rest.<name>`` pseudo-event lines (seq null: always applied by the store)."""

    def __init__(self, mw: ManagedWorld) -> None:
        self.mw = mw
        self.app = create_app(Settings(db_enabled=False))
        self.keys = pantry_keys()
        self.client: TestClient | None = None

    def __enter__(self) -> Rest:
        self.client = TestClient(self.app).__enter__()
        self.app.state.manager.worlds[self.mw.world.world_id] = self.mw
        return self

    def __exit__(self, *a: object) -> None:
        assert self.client is not None
        self.app.state.manager.worlds.clear()  # the recorder owns the world: don't let the manager stop it
        self.client.__exit__(*a)

    def lines(self) -> list[bytes]:
        assert self.client is not None
        w = self.mw.world
        wid = w.world_id
        tf = rm.t_fields(w)
        reqs: list[tuple[str, str, str | None]] = [  # (name, path, key)
            ("inventory", f"/worlds/{wid}/inventory", None),
            *(("lots", f"/worlds/{wid}/inventory/{k}/lots", k) for k in self.keys if k in w.inv.onhand),
            ("purchasing", f"/worlds/{wid}/purchasing/proposal", None),
            ("impact", f"/worlds/{wid}/impact", None),
            ("comparison", "/policies/comparison", None),
            ("forecast", f"/worlds/{wid}/forecast?horizon_min=120", None),
            ("bottlenecks", f"/worlds/{wid}/bottlenecks", None),
            *(("usage", f"/worlds/{wid}/inventory/{k}/forecast", k) for k in self.keys if k in w.inv.onhand),
        ]  # fmt: skip
        out: list[bytes] = []
        for name, path, key in reqs:
            r = self.client.get("/api/v1" + path)
            if r.status_code != 200:
                raise RuntimeError(f"{path}: {r.status_code} {r.text[:200]}")
            data = r.content
            if name == "lots":  # BrewLive.refresh: data = {key, items}
                data = dumps({"key": key, "items": r.json()["items"]})
            elif name == "usage":  # BrewLive.refresh: {...data, key}
                data = dumps({**r.json(), "key": key})
            head = {"kind": "event", "seq": None, "sim_s": tf["sim_s"], "t": tf["t"], "type": "rest." + name}
            out.append(dumps(head)[:-1] + b',"data":' + data + b"}")
        return out


def record(name: str, git: str) -> list[bytes]:
    spec = SCENARIOS[name]
    seed = spec["seed"]
    sink = LineSink(START_DATE)
    w = World(
        scenario=load_scenario("weekday_normal"),
        policy=make_policy("D", models_dir=repo_root() / "models"),
        seed=seed, days=10**6, continuous=True, start_date=START_DATE, world_id=f"rec-{name}", sink=sink,
    )  # fmt: skip
    mw = ManagedWorld(w, "demo", Settings(db_enabled=False))  # the chaos / action path the API uses (shadow fork)
    mw.fan.add(sink)
    w.advance_to(w.day_start_t(0))
    t0, t1 = hm(spec["from"]), hm(spec["to"])
    w.advance_to(t0)
    snapshot = full_state(w)
    seq0 = w.seq
    sink.min_seq = seq0
    sink.lines.clear()  # everything before the start time is the hydration, not the stream
    sink.n_events = 0
    rest = Rest(mw).__enter__()
    sink.lines.extend(rest.lines())  # the REST read models at the start (lines before the first event)

    # timeline: (sim_s, priority, kind, payload); actions/chaos before the checkpoint at the same time
    timeline: list[tuple[float, int, str, dict[str, Any]]] = []
    for c in spec["chaos"]:
        timeline.append((hm(c["at"]), 0, "chaos", c))
    for a in spec["actions"]:
        timeline.append((hm(a["at"]), 0, "action", a))
    k = 1
    while t0 + k * CHECKPOINT_EVERY_S < t1:
        timeline.append((t0 + k * CHECKPOINT_EVERY_S, 1, "checkpoint", {}))
        k += 1
    timeline.append((t1, 2, "end", {}))
    timeline.sort(key=lambda x: (x[0], x[1]))

    out_actions: list[dict[str, Any]] = []
    out_chaos: list[dict[str, Any]] = []
    last_cp_seq = seq0

    for t, _, kind, p in timeline:
        w.advance_to(t)
        if kind == "chaos":
            d = mw.chaos(p["kind"], p["target"], 1.0, p["duration_min"])  # == POST /chaos (shadow fork -> chaos.cost)
            out_chaos.append({"at": p["at"], "kind": p["kind"], "target": d["target"], "severity": 1.0,
                              "duration_min": p["duration_min"], "disruption_id": d["id"], "after_seq": w.seq})  # fmt: skip
        elif kind == "action":
            rec: dict[str, Any] = {"at": p["at"], "kind": p["kind"]}
            if p["kind"] == "set_price":
                sku, price = pick_price_change(w)
                rec["payload"] = {"sku": sku, "price": price}
                rec["result"] = mw.act("set_price", rec["payload"])
            elif p["kind"] == "serve_order":
                # the first ready order at (or soon after) the scripted time
                scan_to = t + 15 * 60
                while not any(o.state == "ready" for o in w.orders.open.values()) and w.now < scan_to:
                    w.advance_to(w.now + 5)
                ready = sorted(o.order_no for o in w.orders.open.values() if o.state == "ready")
                if not ready:
                    raise RuntimeError("no ready order to serve")
                rec["payload"] = {"order_no": ready[0]}
                rec["served_at_s"] = round(w.now, 1)
                rec["result"] = mw.act("serve_order", rec["payload"])
            elif p["kind"] == "invest":
                rec["payload"] = {"catalog_key": p["key"]}
                rec["result"] = w.invest.buy(p["key"], by="owner")  # == POST /worlds/{id}/invest
            else:
                raise RuntimeError(p["kind"])
            w.advance_to(w.now)
            rec["after_seq"] = w.seq
            out_actions.append(rec)
        elif kind in ("checkpoint", "end"):
            if kind == "end" or w.seq != last_cp_seq:
                mw.refresh_costs()  # what GET /state does
                sink.lines.append(b'{"kind":"checkpoint","seq":%d,"data":' % w.seq + full_state(w) + b"}")
                last_cp_seq = w.seq
            if kind == "checkpoint":
                sink.lines.extend(rest.lines())
    rest.__exit__(None, None, None)
    meta = {
        "kind": "meta", "name": name, "seed": seed, "policy": "D", "start_date": START_DATE,
        "from_hhmm": spec["from"], "to_hhmm": spec["to"], "from_s": t0, "to_s": t1,
        "chaos": out_chaos, "actions": out_actions, "schema_sha256": schema_sha256(),
        "n_events": sink.n_events, "first_seq": seq0 + 1, "recorded_with": git,
    }  # fmt: skip
    return [dumps(meta), b'{"kind":"snapshot","data":' + snapshot + b"}", *sink.lines]


def write(name: str, out_dir: Path, git: str) -> Path:
    lines = record(name, git)
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{name}.jsonl"
    p.write_bytes(b"\n".join(lines) + b"\n")
    return p


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", choices=sorted(SCENARIOS), help="record one scenario")
    ap.add_argument("--all", action="store_true", help="record every scenario and refresh design/data/demo-stream.jsonl")
    ap.add_argument("--out-dir", default=str(FIXTURES))
    ap.add_argument("--recorded-with", default=None, help="value for meta.recorded_with (default: git rev-parse HEAD)")
    a = ap.parse_args(argv)
    if not a.name and not a.all:
        ap.error("give --name <scenario> or --all")
    git = a.recorded_with or git_sha()
    out = Path(a.out_dir)
    for name in sorted(SCENARIOS) if a.all else [a.name]:
        p = write(name, out, git)
        print(f"{p}  {p.stat().st_size / 1e6:.2f} MB", file=sys.stderr)
        if name == "morning_rush" and out.resolve() == FIXTURES.resolve():
            demo = repo_root() / "design" / "data" / "demo-stream.jsonl"
            shutil.copyfile(p, demo)
            print(f"{demo}  (copy)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
