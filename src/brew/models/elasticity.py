"""Price elasticity: penalised Poisson GLM with log-price interactions and category shrinkage (12.2).

``log E[q] = a_sku + slot/dow/weather/flag effects + beta_sku * ln(price_ratio)`` fitted with
scikit-learn's ``PoissonRegressor``; ``beta`` is then shrunk toward the category mean:
``beta_hat = (n * beta_sku + k * beta_cat) / (n + k)`` with ``k = 200`` observations.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import PoissonRegressor

MIN_ELASTICITY = 0.1  # |beta| floor imposed by the negativity constraint


@dataclass
class ElasticityResult:
    beta: dict[str, float]
    se: dict[str, float]
    n: dict[str, int]
    raw_beta: dict[str, float]
    category_beta: dict[str, float]
    loss: dict[str, float] | None = None  # extra log-price coefficient above the reference price, per category
    beta_free: dict[str, float] | None = None  # shrunk estimates before the negativity constraint


class ElasticityModel:
    """Per-SKU log-price elasticity ``beta``; ``factor(sku, ratio)`` = demand multiplier ``ratio**beta``."""

    def __init__(self, result: ElasticityResult | None = None) -> None:
        self.result = result

    # --------------------------------------------------------------- training
    @classmethod
    def fit(
        cls,
        df: Any,
        cats: dict[str, str],
        *,
        alpha: float = 1e-6,
        shrink_k: float = 200.0,
        tau_floor: float = 0.05,
        ref_days: float = 7.0,
    ) -> ElasticityModel:
        """Fit on a dense demand frame (see :meth:`DemandLog.dense_frame`; optional ``day_id`` column).

        Rows are rolled up to hourly cells; cells where the item was hidden (86) are dropped - demand there
        is censored.  Day dummies absorb day-level shocks.  After the GLM, ``beta`` is shrunk toward its
        category mean twice: the spec's ``(n b + k b_cat)/(n + k)`` and an empirical-Bayes weight
        ``tau^2 / (tau^2 + se^2)`` (``tau^2`` = between-SKU variance of the raw estimates, floored).
        """
        import polars as pl

        if "day_id" not in df.columns:
            df = df.with_columns(pl.col("day").alias("day_id"))
        crn = "variant" in df.columns
        if crn:
            df = df.with_columns(pl.lit(1.0).alias("ref"))
        else:
            df = _with_reference(df, ref_days)
        d = (
            df.with_columns(
                (pl.col("slot") // 4).alias("hour"),
                (pl.col("price_ratio").clip(0.5, 2.0) / pl.col("ref")).log().alias("lp"),
            )
            .with_columns(pl.col("lp").clip(0.0, None).alias("lpos"))
            .group_by(["day_id", "hour", "sku", "channel_group", *(["variant"] if crn else [])])
            .agg(
                pl.col("qty").sum(), pl.col("lp").mean(), pl.col("lpos").mean(),
                pl.col("hidden").max().alias("hid"), pl.len().alias("expo"),
                pl.col("weekday").first(), pl.col("wx").first(), pl.col("temp_c").mean(),
                pl.col("holiday").first(), pl.col("cricket").first(), pl.col("exam").first(), pl.col("payday").first(),
            )
            .filter(pl.col("hid") == 0)
        )  # fmt: skip
        skus = sorted(set(d["sku"].to_list()))
        sidx = {s_: i for i, s_ in enumerate(skus)}
        S = len(skus)
        si = np.array([sidx[s_] for s_ in d["sku"].to_list()])
        lp = d["lp"].to_numpy()
        expo = d["expo"].to_numpy().astype(float)
        y = d["qty"].to_numpy().astype(float) / expo  # rate per slot; weights restore the exposure
        fg = (d["channel_group"].to_numpy() == "delivery").astype(int)
        wd = d["weekday"].to_numpy().astype(int)
        wx = d["wx"].to_numpy().astype(int)
        hour = d["hour"].to_numpy().astype(int)
        n = len(y)
        blocks = []
        sku_fg = np.zeros((n, S * 2))
        sku_fg[np.arange(n), si * 2 + fg] = 1.0
        blocks.append(sku_fg)
        hours = sorted(set(hour.tolist()))
        h1 = np.zeros((n, len(hours)))
        for k, h in enumerate(hours):
            h1[:, k] = hour == h
        blocks.append(h1 * (1 - fg)[:, None])
        blocks.append(h1 * fg[:, None])
        blocks.append((wd >= 5).astype(float)[:, None])
        wx1 = np.zeros((n, 5))
        wx1[np.arange(n), wx] = 1.0
        blocks.append(wx1)
        blocks.append(d.select(["holiday", "cricket", "exam", "payday"]).to_numpy().astype(float))
        blocks.append(((d["temp_c"].to_numpy() - 26.0) / 6.0)[:, None])
        fe_keys = [(a, b) for a, b in zip(d["day_id"].to_list(), hour.tolist(), strict=True)] if crn else d["day_id"].to_list()
        days = sorted(set(fe_keys))
        if 1 < len(days) <= 1500:
            didx = {x: i for i, x in enumerate(days)}
            dd = np.zeros((n, len(days)))
            dd[np.arange(n), [didx[x] for x in fe_keys]] = 1.0
            blocks.append(dd)
        inter = np.zeros((n, S))
        inter[np.arange(n), si] = lp
        cat_list = sorted({cats[s_] for s_ in skus})
        cidx = {c: i for i, c in enumerate(cat_list)}
        sku_cat = np.array([cidx[cats[s_]] for s_ in skus])
        loss = np.zeros((n, len(cat_list)))
        loss[np.arange(n), sku_cat[si]] = d["lpos"].to_numpy()
        blocks.append(loss)
        blocks.append(inter)
        X = np.hstack(blocks)
        glm = PoissonRegressor(alpha=alpha, max_iter=3000, tol=1e-7)
        glm.fit(X, y, sample_weight=expo)
        beta_raw = glm.coef_[-S:]
        loss_coef = glm.coef_[-S - len(cat_list) : -S]
        mu = np.exp(X @ glm.coef_ + glm.intercept_) * expo
        XtWX = (X * mu[:, None]).T @ X + alpha * expo.sum() * np.eye(X.shape[1])
        try:
            cov = np.linalg.inv(XtWX + 1e-9 * np.eye(X.shape[1]))
            se = np.sqrt(np.clip(np.diag(cov)[-S:], 0, None))
        except np.linalg.LinAlgError:
            se = np.full(S, 1.0)
        informative = np.abs(lp) > 0.01
        n_eff = np.array([int((informative & (si == i)).sum()) for i in range(S)])
        cat_beta: dict[str, float] = {}
        beta: dict[str, float] = {}
        for c in sorted({cats[s_] for s_ in skus}):
            idx = [i for i, s_ in enumerate(skus) if cats[s_] == c]
            b, sv = beta_raw[idx], np.maximum(se[idx], 1e-3)
            prec = 1.0 / sv**2
            bc = float(np.sum(prec * b) / np.sum(prec))
            tau2 = max(tau_floor, float(np.var(b, ddof=1) - np.mean(sv**2)) if len(idx) > 1 else tau_floor)
            cat_beta[c] = bc
            for j, i in enumerate(idx):
                w = tau2 / (tau2 + sv[j] ** 2)
                eb = w * b[j] + (1.0 - w) * bc
                beta[skus[i]] = float((n_eff[i] * eb + shrink_k * bc) / (n_eff[i] + shrink_k))
        beta_free = dict(beta)
        # demand cannot rise with price: keep the planner's elasticities strictly negative
        beta = {s_: min(b, -MIN_ELASTICITY) for s_, b in beta.items()}
        res = ElasticityResult(
            beta=beta, beta_free=beta_free, se={s_: float(se[i]) for i, s_ in enumerate(skus)}, n={s_: int(n_eff[i]) for i, s_ in enumerate(skus)},
            raw_beta={s_: float(beta_raw[i]) for i, s_ in enumerate(skus)}, category_beta=cat_beta,
            loss={c: float(loss_coef[cidx[c]]) for c in cat_list},
        )  # fmt: skip
        return cls(res)

    # --------------------------------------------------------------- queries
    def beta(self, sku: str, default: float = -1.0) -> float:
        if self.result is None:
            return default
        return self.result.beta.get(sku, default)

    def factor(self, sku: str, ratio: float) -> float:
        """Demand multiplier when the price moves to ``ratio`` x the current price."""
        return float(max(ratio, 1e-6) ** self.beta(sku))

    def signs_ok(self) -> bool:
        """True when every shrunk estimate is negative *before* the monotonicity constraint is applied."""
        if self.result is None:
            return False
        free = self.result.beta_free or self.result.beta
        return all(b < 0 for b in free.values())

    # ------------------------------------------------------------------- io
    def save(self, path: str | Path) -> Path:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        assert self.result is not None
        r = self.result
        (d / "elasticity.json").write_text(
            json.dumps(
                {
                    "beta": {
                        s: {"beta": r.beta[s], "se": r.se[s], "n": r.n[s], "raw": r.raw_beta[s],
                            "free": (r.beta_free or r.beta)[s]}
                        for s in r.beta
                    },
                    "category_beta": r.category_beta, "loss": r.loss,
                },
                indent=2,
            )
        )
        return d

    @classmethod
    def load(cls, path: str | Path) -> ElasticityModel:
        j = json.loads((Path(path) / "elasticity.json").read_text())
        b = j["beta"]
        return cls(
            ElasticityResult(
                beta={s: v["beta"] for s, v in b.items()}, se={s: v["se"] for s, v in b.items()},
                n={s: v["n"] for s, v in b.items()}, raw_beta={s: v["raw"] for s, v in b.items()},
                category_beta=j["category_beta"], loss=j.get("loss"), beta_free={s: v.get("free", v["beta"]) for s, v in b.items()},
            )  # fmt: skip
        )


def _with_reference(df: Any, ref_days: float) -> Any:
    """Add ``ref``: the fairness reference price ratio (EMA of end-of-day prices, as the simulator keeps it).

    Worlds are told apart by ``day_id // 1000`` when ``day_id >= 1000`` (else a single world).
    """
    import polars as pl

    last = int(df["slot"].max())
    end = (
        df.filter(pl.col("slot") == last)
        .group_by(["day_id", "sku"])
        .agg(pl.col("price_ratio").mean().alias("end"))
        .sort(["sku", "day_id"])
    )
    rows = []
    a = 1.0 / ref_days
    cur: dict[tuple[int, str], float] = {}
    for day_id, sku, e in end.iter_rows():
        world = day_id // 1000 if day_id >= 1000 else 0
        ref = cur.get((world, sku), 1.0)
        rows.append((day_id, sku, ref))
        cur[(world, sku)] = ref + a * (e - ref)
    refs = pl.DataFrame(rows, schema=["day_id", "sku", "ref"], orient="row")
    return df.join(refs, on=["day_id", "sku"], how="left").with_columns(pl.col("ref").fill_null(1.0))


def true_beta(cfg: Any) -> dict[str, float]:
    """The simulator's own demand elasticity of each SKU (log-log, at base prices).

    Computed from the choice model: weight personas by their expected demand, take the share elasticity
    ``beta_p * (1 - s_pj)`` of the MNL, weighted by each persona's volume of the item.
    """
    from brew.sim.arrivals import slot_rates
    from brew.sim.choice import ChoiceModel

    ch = ChoiceModel(cfg)
    out: dict[str, float] = {}
    num = np.zeros(ch.J)
    den = np.zeros(ch.J)
    for pk, per in cfg.personas.items():
        vol = float(slot_rates(per, "weekday").sum()) * sum(per.channels.values())
        for kind in ("drink", "food"):
            _p0, s = ch.probs(pk, kind, with_outside=(kind == "drink"))
            w = vol * s
            num += w * ch.beta[pk] * (1.0 - s)
            den += w
    for j, sku in enumerate(ch.skus):
        out[sku] = float(num[j] / den[j]) if den[j] > 0 else -1.0
    return out
