// v4.1 — stochastic healthcare cost.
//
// Out-of-pocket medical spend rises with age and carries a rising-probability
// tail (a major event). Insurance dampens the tail but adds a fixed premium.
// Returns a sampler the finance Monte Carlo draws from each year, so healthcare
// shocks contribute to sequence-of-returns risk rather than being a flat line.
import { strategiesConfig } from "../config";
import type { Rng } from "../lib/rng";

export function makeHealthcareSampler(insured: boolean): (age: number, rng: Rng) => number {
  const h = strategiesConfig.healthcare;
  return (age: number, rng: Rng): number => {
    const base = h.base_oop_usd * Math.pow(h.growth, age - 50);
    let cost = base * (0.6 + 0.8 * rng.uniform()); // 0.6x .. 1.4x routine variation

    const tailProb = h.tail_prob_base + h.tail_prob_slope * (age - 50);
    if (rng.uniform() < tailProb) {
      const shock = h.tail_min_usd + rng.uniform() * (h.tail_max_usd - h.tail_min_usd);
      cost += shock * (insured ? h.insurance_tail_factor : 1);
    }
    if (insured) cost += h.insurance_premium_usd;
    return cost;
  };
}
