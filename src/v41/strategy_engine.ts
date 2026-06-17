// v4.1 — the optimal-retirement-strategy selector.
//
// Each strategy couples a routing profile (geography/cost) with a housing plan
// (rent vs buy), a tax jurisdiction, and a healthcare posture, then runs the
// full coupled Monte Carlo. Results are ranked by survival probability — the
// institutional-style output the spec was reaching for, now runnable.
import { routingProfiles, strategiesConfig } from "../config";
import { runLifecycle } from "../core_engine/lifecycle_engine";
import { runFinance } from "../core_engine/finance_engine";
import { buildHousingPlan } from "./housing_engine";
import { makeHealthcareSampler } from "./healthcare_engine";
import { jurisdictionDrag } from "./tax_engine";
import type { ProcessedCity, Graph, StrategyResult, RoutingWeights } from "../types";

function weightsFor(routingKey: string): RoutingWeights {
  const p = routingProfiles.profiles.find((x) => x.key === routingKey) ?? routingProfiles.profiles[0];
  return p.weights;
}

export function runStrategies(cities: ProcessedCity[], graph: Graph, baseSeed: number): StrategyResult[] {
  const results: StrategyResult[] = [];

  for (const s of strategiesConfig.strategies) {
    const { plans, costByAge } = runLifecycle(cities, graph, baseSeed, weightsFor(s.routing));
    const housing = buildHousingPlan(s, cities);
    const coupledCost = housing.modifyCost(costByAge);

    const fin = runFinance(coupledCost, baseSeed, {
      label: s.label,
      returnTaxDrag: jurisdictionDrag(s.jurisdiction),
      oneTimeOutflows: housing.oneTimeOutflows,
      healthcare: makeHealthcareSampler(s.insurance),
      illiquidByAge: housing.illiquidByAge,
    });

    const sample = plans.find((p) => p.age === 65) ?? plans[0];
    results.push({
      key: s.key,
      label: s.label,
      survival_probability: fin.survival_probability,
      median_bankruptcy_age: fin.median_bankruptcy_age,
      mean_annual_cost_usd: fin.mean_annual_cost_usd,
      effective_withdrawal_rate: fin.effective_withdrawal_rate,
      median_terminal_net_worth: fin.median_terminal_net_worth,
      sample_itinerary_age65: sample.cities.map((c) => c.name_en),
      buy: s.buy,
      settle_city: s.settle_city ?? null,
      jurisdiction: s.jurisdiction,
      property_price_usd: housing.property_price,
    });
  }

  return results.sort((a, b) => b.survival_probability - a.survival_probability);
}
