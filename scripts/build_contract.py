"""Regenerate design/contract.json: event type -> reducer(s) -> what it drives on screen.

    uv run python scripts/build_contract.py          # rewrite design/contract.json
    uv run python scripts/build_contract.py --check  # exit 1 if the file is out of date

The handler lists come from the JavaScript (``BrewStore.describe()``, loaded in headless Chromium: the JS is the source
of truth); the ``visual`` texts, ignore reasons and snapshot field lists below are curated here (backend.md 6.3 +
design/live/README.md DOM hooks). The frontend lead refines the visuals; tests/frontend/test_contract.py and
test_store.py assert the file stays consistent with the backend schema, the fixtures and the JS.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import sys
import threading
from pathlib import Path
from typing import Any

from brew.config.loader import repo_root

ROOT = Path(repo_root())
OUT = ROOT / "design" / "contract.json"

# ---- what each event drives (backend.md 6.3 right-hand column + the DOM hooks of design/live/README.md)
VISUALS: dict[str, str] = {
    "clock.tick": "HUD clock `#hud .clock .time`, open/closed sign, wall clock",
    "weather.changed": "sky + rain in the lobby window, HUD weather icon",
    "day.started": "day banner / intro card, counters reset (profit, walkouts, rescue sales)",
    "day.ended": "closing card with the day summary",
    "customer.arrived": "door opens, the party's doodles spawn (persona + appearance_seeds)",
    "customer.queued": "queue slot `#lobby [data-party] data-state=queued`",
    "customer.balked": "party turns away at the door",
    "customer.ordering": "party at the register, speech bubble",
    "customer.waiting": "pickup zone + patience ring (patience_s, patience_deadline_s)",
    "customer.patience": "patience ring colour at the 60/30/10 % thresholds",
    "customer.reneged": "grey cloud, huff, walks out",
    "customer.seated": "walk to table; merged tables push together",
    "customer.eating": "sip loop",
    "customer.lingering": "laptop opens / lingering pose",
    "customer.paying": "UPI / card bubble",
    "customer.left": "exit (happy or not); table turns dirty",
    "order.placed": "ticket slides onto the rail `#lobby [data-ticket=<order_no>]` (items, mods, note, channel stamp)",
    "order.accepted": "promise time on the ticket / clears the PAUSED stamp",
    "order.rejected": "ticket stamped REJECTED then torn off",
    "order.progress": "ticket wait bar + now-brewing board columns (brewing / almost / ready)",
    "rail.reordered": "FLIP reorder of the rail + batch paperclips",
    "batch.formed": "paperclip snaps onto the batched tickets ('batched x3 . saves 2m40s')",
    "batch.started": "paperclip turns solid; station card shows the batch",
    "order.ready": "READY stamp, pass bell",
    "order.served": "ticket torn off the rail; seated party waits for a table",
    "order.voided": "VOID tear",
    "bag.shelved": "delivery bag drops on the pickup shelf (slot, quality)",
    "rider.assigned": "rider tag on the bag, ETA countdown",
    "rider.arrived": "rider walks in / waits at the shelf",
    "rider.picked_up": "scooter leaves, bag removed from the shelf",
    "receipt.printed": "thermal receipt printer (lines, CGST/SGST, total, QR)",
    "payment.received": "cash / UPI fly-out",
    "review.posted": "star lands in the HUD rating (cracks at <= 2), review ticker",
    "price.changed": "menu book price strike + handwritten new price + reason; lectern `[data-lsku]`; combo prices",
    "menu.featured": "featured sticker on the menu book / lectern",
    "menu.hidden": "sold-out ribbon on the item (and on combos that contain it)",
    "menu.restored": "ribbon removed",
    "replate.listed": "rescue shelf spread in the menu book `[data-listing]`, fridge price tag",
    "replate.marked_down": "listing price rewritten deeper; fridge tag updates",
    "replate.sold": "rescue counter ticks, listing units drop",
    "replate.retired": "listing tag removed (donated / wasted / sold out)",
    "replate.mode": "rescue-shelf mode label",
    "stock.changed": "pastry fridge item counts + low tags; pantry stock bars",
    "lot.opened": "pantry lot tag flips sealed -> opened",
    "lot.expired": "pantry lot removed / marked bad",
    "lot.donated": "pantry lot removed (donation bag)",
    "po.created": "pantry 'next delivery' card",
    "po.received": "delivery arrives (lots appear), PO closed",
    "task.started": "station card timer + crew doodle walks to the station",
    "task.finished": "station card timer clears; crew row goes idle; a finished clean task frees a dirty table",
    "prep.started": "prep item cooking on its station card",
    "prep.ready": "prep item ready",
    "prep.expired": "prep item expired / discarded",
    "staff.clocked_in": "crew row appears (present)",
    "staff.clocked_out": "crew row greys out (off shift)",
    "staff.break_started": "crew row shows 'on break'",
    "staff.break_ended": "crew row back to work",
    "staff.absent": "crew row 'absent' (barista sick)",
    "staff.late": "crew row 'late'",
    "equipment.down": "station LED red `#kitchen .board .cell[data-station] .led.r`, chaos card, technician ETA",
    "equipment.up": "station LED green",
    "kpi.tick": "HUD profit `#hud .money .amt`, rating, load, open orders",
    "decision.made": "policy D decision card (latest 3-4 decisions with reasons)",
    "bottleneck.changed": "'what's limiting throughput?' card",
    "chaos.triggered": "kitchen chaos card: what's down, ETA, RL reaction",
    "chaos.resolved": "chaos card clears",
    "strategy.changed": "HUD policy chip",
    "policy.changed": "HUD policy chip",
    "throttle.changed": "aggregator throttle control state",
    "investment.delivered": "the bought item appears in the scene",
    "action.applied": "-",
    "station.load": "station board percentages + LED amber/green (pending backend)",
    "staff.status": "crew fatigue bars, break-due countdown (pending backend)",
    "chaos.cost": "'cost of chaos' figure on the chaos card (pending backend)",
}

IGNORED_REASONS: dict[str, str] = {
    "action.applied": "acknowledgement only: the state change arrives as its own events and the REST call already resolved",
}

REST_VISUALS: dict[str, str] = {
    "rest.inventory": "pantry stock board, days-of-cover board (GET /inventory)",
    "rest.lots": "pantry lot tags and hover cards (GET /inventory/{key}/lots)",
    "rest.forecast": "'morning rush . N orders/hr forecast' label, hover card P50/P90 (GET /forecast)",
    "rest.bottlenecks": "ranked bottleneck card (GET /bottlenecks)",
    "rest.advisor": "invest recommendations list (GET /advisor)",
    "rest.impact": "waste / impact numbers (GET /impact)",
    "rest.comparison": "profit component expands into D vs A/B/C (GET /policies/comparison, pending backend)",
    "rest.staff": "crew shift times, wage (GET /staff)",
    "rest.decision_explain": "decision card 'why' text (GET /decisions/{id}/explain)",
    "rest.purchasing": "proposed purchase order + approve (GET /purchasing, pending backend)",
    "client.status": "live dot `#hud [data-live]`, lagging state (client-side pseudo event)",
}

# ---- paths of GET /state that each room's hydrate reads ("[]" = every list element)
SNAPSHOT_FIELDS: dict[str, list[str]] = {
    "hud": [
        "world.id", "world.policy", "world.strategy", "world.status", "world.clock_mode", "world.lagging", "world.start_date",
        "world.kind", "world.scenario", "world.seed",
        "clock.day", "clock.hhmm", "clock.weekday", "clock.date", "clock.is_open", "clock.open_s", "clock.close_s", "clock.sim_s",
        "clock.t", "clock.speed",
        "weather.state", "weather.temp_c", "weather.rain_mm_h",
        "kpis.cash", "kpis.revenue_today", "kpis.profit_today", "kpis.rating", "kpis.rating_n", "kpis.load_pct",
        "kpis.open_orders", "kpis.walkouts_today",
        "policy.policy", "policy.strategy", "policy.preset", "policy.throttles",
        "disruptions[].id", "disruptions[].kind", "disruptions[].target", "disruptions[].severity", "disruptions[].start_s",
        "disruptions[].end_s", "disruptions[].source", "disruptions[].active", "last_seq",
    ],
    "lobby": [
        "menu[].sku", "menu[].name", "menu[].cat", "menu[].price", "menu[].base", "menu[].min_price", "menu[].max_price",
        "menu[].staple", "menu[].featured", "menu[].hidden", "menu[].hidden_reason", "menu[].chip", "menu[].desc",
        "menu[].temp", "menu[].allergens", "menu[].veg", "menu[].vegan", "menu[].station", "menu[].promo",
        "combos[].id", "combos[].sku", "combos[].name", "combos[].tagline", "combos[].skus", "combos[].price", "combos[].base",
        "combos[].list_price", "combos[].saving", "combos[].discount_pct", "combos[].available",
        "replate.mode", "replate.listings[].listing_id", "replate.listings[].sku", "replate.listings[].lot_id",
        "replate.listings[].units", "replate.listings[].made_at_s", "replate.listings[].use_by_s",
        "replate.listings[].discount_pct", "replate.listings[].price", "replate.kpis.replate_units_sold",
        "replate.kpis.replate_revenue",
        "rail.order_nos", "rail.batches[].id", "rail.batches[].order_nos",
        "rail.orders[].order_no", "rail.orders[].order_id", "rail.orders[].channel", "rail.orders[].persona",
        "rail.orders[].name", "rail.orders[].party_id", "rail.orders[].items[].sku", "rail.orders[].items[].qty",
        "rail.orders[].items[].mods", "rail.orders[].items[].unit_price", "rail.orders[].items[].replate",
        "rail.orders[].items[].combo", "rail.orders[].note", "rail.orders[].note_flags", "rail.orders[].placed_s",
        "rail.orders[].promised_s", "rail.orders[].ready_s", "rail.orders[].bumped", "rail.orders[].progress_state",
        "rail.orders[].progress", "rail.orders[].batch",
        "customers[].party_id", "customers[].customer_id", "customers[].name", "customers[].persona", "customers[].party_size",
        "customers[].channel", "customers[].state", "customers[].appearance_seeds", "customers[].laptop",
        "customers[].patience_s", "customers[].patience_left_s", "customers[].patience_frac", "customers[].tables",
        "customers[].order_nos", "customers[].arrived_s",
        "tables.tables[].id", "tables.tables[].seats", "tables.tables[].state", "tables.tables[].occupants",
        "tables.tables[].merged", "tables.tables[].turns",
        "shelf.slots", "shelf.bags[].order_no", "shelf.bags[].channel", "shelf.bags[].slot", "shelf.bags[].rider_eta_s",
        "shelf.bags[].quality", "shelf.waiting_for_slot",
    ],
    "kitchen": [
        "staff[].id", "staff[].name", "staff[].role", "staff[].present", "staff[].on_break", "staff[].absent",
        "staff[].station", "staff[].task", "staff[].fatigue", "staff[].shift", "staff[].wage_per_h", "staff[].skills",
        "equipment[].idx", "equipment[].key", "equipment[].station", "equipment[].slots", "equipment[].slots_in_use",
        "equipment[].status", "equipment[].down_until_s", "equipment[].condition",
    ],
    "pantry": [
        "fridge[].sku", "fridge[].key", "fridge[].qty", "fridge[].low", "fridge[].par", "fridge[].replate",
    ],
}

# ---- where the event-sourced state cannot equal hydrate(snapshot) (asserted, with these tags, by test_store.py)
KNOWN_GAPS: dict[str, str] = {
    "patience-coarse": "customer.patience only fires at the 60/30/10 % thresholds: patience_frac is a step function, not the live fraction (use patience_deadline_s with BrewLive.now() for a smooth ring)",
    "fatigue": "staff fatigue is not streamed until staff.status (pending backend); hydrate/GET /staff carry it",
    "staff-task": "a person with several concurrent tasks: the sim reports the latest started group, the store the most recent task.started",
    "weather-temp": "temp_c / rain_mm_h drift hourly but weather.changed only fires when the weather state changes",
    "coldbrew": "cold-brew concentrate is not a finished good: its fridge row only updates when the low flag flips",
    "replate-units": "a rescue lot also sells at full price and is pre-made / consumed without events, so listing.units can only be >= the snapshot's",
    "fridge-replate": "the fridge row's replate tag is the backend's first-lot heuristic; use replate.listings for the rescue shelf",
    "bag-quality": "bag quality decays on the shelf; only the value at shelving / pickup is streamed",
    "kpis": "kpis refresh only on kpi.tick (every 5 sim-min), the snapshot is live",
    "table-clean": "no 'table cleaned' event: dirty -> free is inferred from a finished pass/clean task (FIFO)",
    "bump": "order bumps (action bump_order) change rail order via rail.reordered but have no flag event",
}


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a: Any) -> None:
        pass


def js_describe() -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    handler = functools.partial(_Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            page = b.new_page()
            page.goto(f"http://127.0.0.1:{srv.server_address[1]}/design/live/harness.html")
            out = page.evaluate("() => BrewStore.describe()")
            b.close()
    finally:
        srv.shutdown()
    return out  # type: ignore[no-any-return]


def build() -> dict[str, Any]:
    d = js_describe()
    events: dict[str, Any] = {}
    for t in sorted(set(d["events"]) | set(d["ignored"])):
        if t in d["ignored"]:
            events[t] = {"ignored": d["ignored"][t]}
        else:
            e: dict[str, Any] = {"handlers": d["events"][t], "visual": VISUALS.get(t, "TODO")}
            if t in d["pending_backend"]:
                e["pending_backend"] = True
            events[t] = e
    rest = {t: {"handlers": d["rest"][t], "visual": REST_VISUALS.get(t, "TODO")} for t in sorted(d["rest"])}
    return {
        "_note": "generated by scripts/build_contract.py: handler lists come from BrewStore.describe() (the JS is the "
        "source of truth), visuals and snapshot_fields are curated in that script",
        "events": events,
        "all_events_handlers": d["all_events"],
        "rest": rest,
        "snapshot_fields": SNAPSHOT_FIELDS,
        "known_gaps": KNOWN_GAPS,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail when design/contract.json is out of date")
    a = ap.parse_args()
    text = json.dumps(build(), indent=1, ensure_ascii=False) + "\n"
    if a.check:
        if not OUT.exists() or OUT.read_text() != text:
            print("design/contract.json is stale: uv run python scripts/build_contract.py", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
