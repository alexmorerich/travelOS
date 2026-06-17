// Monte Carlo retirement-drawdown engine.
//
// Works entirely in REAL (inflation-adjusted) USD: spending is constant in real
// terms and returns are real returns, so the survival probability is directly
// meaningful and free of inflation double-counting. A per-year recession draw
// injects sequence-of-returns risk — the dominant failure mode for a 30-year
// drawdown that a single deterministic path completely hides.
import { financeConfig } from "../config";
import { percentile } from "../lib/geo";
import { makeRng, deriveSeed } from "../lib/rng";
import type { FinanceResult, TrajectoryPoint, FinanceConfig } from "../types";
import type { Rng } from "../lib/rng";

function drawAnnualReturn(rng: Rng, cfg: FinanceConfig): number {
  if (rng.uniform() < cfg.recession_probability) {
    return rng.normal(cfg.recession_mean_return, cfg.recession_sd_return);
  }
  return rng.normal(cfg.mean_real_return, cfg.sd_real_return);
}

/** Run the drawdown over a fixed per-age cost schedule from the routing engine. */
export function runFinance(
  costByAge: Map<number, number>,
  baseSeed: number,
): FinanceResult {
  const cfg = financeConfig;
  const ages = [...costByAge.keys()].sort((a, b) => a - b);
  const perAge = new Map<number, number[]>(ages.map((a) => [a, []]));
  const terminals: number[] = [];
  const bankruptcyAges: number[] = [];
  let survivors = 0;

  for (let path = 0; path < cfg.n_paths; path++) {
    const rng = makeRng(deriveSeed(baseSeed ^ 0x5f3759df, path));
    let portfolio = cfg.initial_portfolio_usd;
    let bankruptAt: number | null = null;

    for (const age of ages) {
      if (bankruptAt === null) {
        const r = drawAnnualReturn(rng, cfg);
        portfolio = portfolio * (1 + r) - (costByAge.get(age) ?? 0);
        if (portfolio <= 0) {
          bankruptAt = age;
          portfolio = 0;
        }
      }
      perAge.get(age)!.push(Math.max(portfolio, 0));
    }

    if (bankruptAt === null) {
      survivors++;
      terminals.push(portfolio);
    } else {
      bankruptcyAges.push(bankruptAt);
      terminals.push(0);
    }
  }

  const trajectories: TrajectoryPoint[] = ages.map((age) => {
    const v = perAge.get(age)!;
    return {
      age,
      p10: Math.round(percentile(v, 10)),
      p50: Math.round(percentile(v, 50)),
      p90: Math.round(percentile(v, 90)),
      mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    };
  });

  const meanCost = ages.reduce((s, a) => s + (costByAge.get(a) ?? 0), 0) / ages.length;

  return {
    initial_portfolio_usd: cfg.initial_portfolio_usd,
    n_paths: cfg.n_paths,
    survival_probability: Number((survivors / cfg.n_paths).toFixed(4)),
    median_bankruptcy_age: bankruptcyAges.length ? Math.round(percentile(bankruptcyAges, 50)) : null,
    p10_terminal: Math.round(percentile(terminals, 10)),
    p50_terminal: Math.round(percentile(terminals, 50)),
    p90_terminal: Math.round(percentile(terminals, 90)),
    mean_annual_cost_usd: Math.round(meanCost),
    effective_withdrawal_rate: Number((meanCost / cfg.initial_portfolio_usd).toFixed(4)),
    trajectories,
    bankruptcy_ages: bankruptcyAges,
  };
}
