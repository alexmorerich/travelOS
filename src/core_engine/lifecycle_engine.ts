// Ages 50 -> 80, carrying real state across years: the traveller continues from
// last year's final city, and a rolling visited-window discourages immediately
// re-staying somewhere. Produces the per-year plans and a compressed region
// narrative (national exploration -> regional loop -> single-city stabilisation).
import { systemConfig } from "../config";
import { makeRng, deriveSeed } from "../lib/rng";
import { planYear } from "./routing_engine";
import type { ProcessedCity, Graph, YearPlan, RegionPhase } from "../types";

export interface LifecycleResult {
  plans: YearPlan[];
  phases: RegionPhase[];
  costByAge: Map<number, number>;
}

export function runLifecycle(
  nodes: ProcessedCity[],
  graph: Graph,
  baseSeed: number,
): LifecycleResult {
  const plans: YearPlan[] = [];
  const history: { age: number; ids: string[] }[] = [];
  let current = systemConfig.base_city;

  for (let age = systemConfig.age_start; age <= systemConfig.age_end; age++) {
    const recent = new Set(
      history
        .filter((h) => age - h.age <= systemConfig.visited_window_years)
        .flatMap((h) => h.ids),
    );
    const seed = deriveSeed(baseSeed, age);
    const plan = planYear({
      nodes,
      graph,
      age,
      startCity: current,
      visitedRecent: recent,
      rng: makeRng(seed),
      seed,
    });
    plans.push(plan);
    if (plan.cities.length > 0) {
      current = plan.cities[plan.cities.length - 1].id;
      history.push({ age, ids: plan.cities.map((c) => c.id) });
    }
  }

  const costByAge = new Map<number, number>(plans.map((p) => [p.age, p.annual_cost_usd]));
  return { plans, phases: summarisePhases(plans), costByAge };
}

/** Collapse 31 yearly plans into readable life phases (one row per plan, with a
 *  dominant region label derived from the province holding the most days). */
function summarisePhases(plans: YearPlan[]): RegionPhase[] {
  return plans.map((p) => {
    const byProvince = new Map<string, number>();
    for (const c of p.cities) byProvince.set(c.province, (byProvince.get(c.province) ?? 0) + c.days);
    const primary = [...byProvince.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const label =
      p.cities.length >= 3 ? `${primary} + multi-region loop`
      : p.cities.length === 2 ? `${primary} dual-base`
      : `${primary} single-city`;
    return {
      age: p.age,
      primary_region: label,
      cities: p.cities.map((c) => c.name_en),
      annual_cost_usd: p.annual_cost_usd,
    };
  });
}
