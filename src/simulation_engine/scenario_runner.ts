// Task 1 — routing-profile comparison.
//
// Runs each routing objective (experience / balanced / frugal) through the SAME
// base finance model (rent-only, no v4.1 coupling) so the survival delta is
// attributable purely to the routing lever — i.e. "how much does survival move
// if I just stop paying for experience?".
import { routingProfiles } from "../config";
import { runLifecycle } from "../core_engine/lifecycle_engine";
import { runFinance } from "../core_engine/finance_engine";
import type { ProcessedCity, Graph, ScenarioResult } from "../types";

export function runScenarios(cities: ProcessedCity[], graph: Graph, baseSeed: number): ScenarioResult[] {
  const out: ScenarioResult[] = [];

  for (const profile of routingProfiles.profiles) {
    const { plans, costByAge } = runLifecycle(cities, graph, baseSeed, profile.weights);
    const fin = runFinance(costByAge, baseSeed, { label: profile.label });
    const sample = plans.find((p) => p.age === 65) ?? plans[0];
    out.push({
      key: profile.key,
      label: profile.label,
      survival_probability: fin.survival_probability,
      median_bankruptcy_age: fin.median_bankruptcy_age,
      mean_annual_cost_usd: fin.mean_annual_cost_usd,
      effective_withdrawal_rate: fin.effective_withdrawal_rate,
      median_terminal_net_worth: fin.median_terminal_net_worth,
      sample_itinerary_age65: sample.cities.map((c) => c.name_en),
    });
  }

  return out.sort((a, b) => b.survival_probability - a.survival_probability);
}
