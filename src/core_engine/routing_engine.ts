// Yearly routing = a constrained, utility-weighted greedy walk over the city
// graph (NOT a ranked list, NOT a knapsack).
//
//   * Starts from the traveller's current city.
//   * At each hop, considers only graph neighbours (within radius) that are
//     feasible (not hard-blocked) and not visited within the recent window —
//     this is the explicit guard against ping-pong oscillation.
//   * Ranks by utility = culture / (TREI + eps) - cost penalty - travel penalty.
//   * Breaks near-ties (within a 5% band) with the seeded RNG.
//   * Number of cities per year shrinks with age via R_age, so the itinerary
//     naturally collapses toward single-city stabilisation in late life.
import { systemConfig, thresholds, ageBands } from "../config";
import { clamp, percentile } from "../lib/geo";
import { rAge, trei, medicalRisk } from "./trei_engine";
import { annualMeanTemp } from "./climate_engine";
import { isHardBlocked, decide } from "./constraint_engine";
import type { ProcessedCity, Graph, YearPlan, YearPlanCity, Decision, RoutingWeights, AgeBand } from "../types";
import type { Rng } from "../lib/rng";

/** The lifecycle band (Expedition / Cultural / Comfort) covering a given age. */
export function bandForAge(age: number): AgeBand {
  return (
    ageBands.bands.find((b) => age >= b.age_from && age <= b.age_to) ??
    ageBands.bands[ageBands.bands.length - 1]
  );
}

/** How well a city's annual climate sits inside the comfort band (1 = ideal). */
function comfortFit(city: ProcessedCity): number {
  const [lo, hi] = ageBands.comfort_celsius;
  const t = annualMeanTemp(city.lat, city.altitude_m ?? 0);
  if (t >= lo && t <= hi) return 1;
  const dist = t < lo ? lo - t : t - hi;
  return clamp(1 - dist / 10, 0, 1);
}

export interface YearContext {
  nodes: ProcessedCity[];
  graph: Graph;
  age: number;
  startCity: string;
  visitedRecent: Set<string>;
  rng: Rng;
  seed: number;
  weights: RoutingWeights;
}

interface Scored {
  city: ProcessedCity;
  medical_risk: number;
  TREI: number;
  utility: number;
  decision: Decision;
}

function utilityOf(
  city: ProcessedCity,
  treiValue: number,
  travelKm: number,
  w: RoutingWeights,
  band: AgeBand,
  medRisk: number,
): number {
  const cultureTerm = w.culture_pursuit * (city.cultural_value / (treiValue + w.utility_eps));
  const costTerm = w.cost_weight * ((city.monthly_cost_usd ?? 2000) / 1000);
  const travelTerm = w.travel_weight * (travelKm / 1000);

  // 30-year lifecycle matrix: favour this band's target zones, and increasingly
  // weight climate comfort + hospital access as the bands progress with age.
  const zoneTerm = band.target_provinces.includes(city.province) ? band.zone_bonus : 0;
  const comfortTerm = band.comfort_bonus * comfortFit(city);
  const hospitalTerm = band.hospital_bonus * clamp(1 - medRisk / 10, 0, 1);

  return cultureTerm - costTerm - travelTerm + zoneTerm + comfortTerm + hospitalTerm;
}

export function planYear(ctx: YearContext): YearPlan {
  const { nodes, graph, age, startCity, visitedRecent, rng, seed, weights } = ctx;
  const R = rAge(age);
  const band = bandForAge(age);

  // Per-age risk for every node, plus the feasible-set TREI distribution.
  const byId = new Map<string, { city: ProcessedCity; med: number; treiVal: number; blocked: boolean }>();
  const feasibleTrei: number[] = [];
  for (const city of nodes) {
    const med = medicalRisk(city.tier3_hospital_minutes);
    const treiVal = trei(city.env_risk, med, R);
    const blocked = isHardBlocked(city, age);
    byId.set(city.id, { city, med, treiVal, blocked });
    if (!blocked) feasibleTrei.push(treiVal);
  }
  const cutoff = percentile(feasibleTrei, thresholds.trei_percentile_cutoff);

  const nCities = clamp(Math.round(systemConfig.max_cities_per_year * R), 1, systemConfig.max_cities_per_year);

  const chosen: Scored[] = [];
  const usedThisYear = new Set<string>();
  let current = startCity;

  // Regional anchor: each year, migrate (one long-haul move) into the best
  // feasible city of this band's target zone, then explore locally from there.
  // This is what lets the Expedition band actually reach the far frontier that
  // a radius-limited walk from the south could never hop to.
  if (band.target_provinces.length > 0) {
    let bestRec: { city: ProcessedCity; med: number; treiVal: number } | null = null;
    let bestU = -Infinity;
    for (const city of nodes) {
      if (!band.target_provinces.includes(city.province) || visitedRecent.has(city.id)) continue;
      const rec = byId.get(city.id);
      if (!rec || rec.blocked) continue;
      const u = utilityOf(rec.city, rec.treiVal, 0, weights, band, rec.med); // no travel cost: it's a flight
      if (u > bestU) { bestU = u; bestRec = rec; }
    }
    if (bestRec) {
      chosen.push({
        city: bestRec.city, medical_risk: bestRec.med, TREI: bestRec.treiVal,
        utility: bestU, decision: decide(false, bestRec.treiVal, cutoff),
      });
      usedThisYear.add(bestRec.city.id);
      current = bestRec.city.id;
    }
  }

  for (let hop = chosen.length; hop < nCities; hop++) {
    const neighbours = graph.adj.get(current);
    if (!neighbours || neighbours.size === 0) break;

    const candidates: { scored: Scored; travelKm: number }[] = [];
    for (const [id, edge] of neighbours) {
      if (usedThisYear.has(id) || visitedRecent.has(id)) continue;
      const rec = byId.get(id);
      if (!rec || rec.blocked) continue;
      const u = utilityOf(rec.city, rec.treiVal, edge.distance_km, weights, band, rec.med);
      candidates.push({
        scored: {
          city: rec.city,
          medical_risk: rec.med,
          TREI: rec.treiVal,
          utility: u,
          decision: decide(false, rec.treiVal, cutoff),
        },
        travelKm: edge.distance_km,
      });
    }
    if (candidates.length === 0) break; // backtrack: no feasible neighbour -> stop early

    candidates.sort((a, b) => b.scored.utility - a.scored.utility);
    const best = candidates[0].scored.utility;
    const tieBand = weights.tie_break_band;
    const tied = candidates.filter(
      (c) => best - c.scored.utility <= Math.abs(best) * tieBand,
    );
    const pick = tied[Math.floor(rng.uniform() * tied.length)] ?? candidates[0];

    chosen.push(pick.scored);
    usedThisYear.add(pick.scored.city.id);
    current = pick.scored.city.id;
  }

  // If the walk found nothing feasible (e.g. boxed in), stay put for the year.
  if (chosen.length === 0) {
    const rec = byId.get(startCity);
    if (rec) {
      chosen.push({
        city: rec.city,
        medical_risk: rec.med,
        TREI: rec.treiVal,
        utility: 0,
        decision: decide(rec.blocked, rec.treiVal, cutoff),
      });
    }
  }

  return assemblePlan(ctx, R, band, cutoff, chosen);
}

function assemblePlan(ctx: YearContext, R: number, band: AgeBand, cutoff: number, chosen: Scored[]): YearPlan {
  const days = distributeDays(chosen, systemConfig.days_per_year);
  const cities: YearPlanCity[] = chosen.map((s, i) => ({
    id: s.city.id,
    name: s.city.name,
    name_en: s.city.name_en,
    province: s.city.province,
    days: days[i],
    monthly_cost_usd: s.city.monthly_cost_usd ?? 2000,
    env_risk: Number(s.city.env_risk.toFixed(2)),
    medical_risk: Number(s.medical_risk.toFixed(2)),
    TREI: Number(s.TREI.toFixed(2)),
    utility: Number(s.utility.toFixed(3)),
    decision: s.decision,
  }));

  const annualCost = cities.reduce(
    (sum, c) => sum + (c.days / 30.44) * c.monthly_cost_usd,
    0,
  );

  const frontierSet = new Set(ageBands.frontier_provinces);
  const totalDays = days.reduce((a, b) => a + b, 0) || 1;
  const frontierDays = cities.filter((c) => frontierSet.has(c.province)).reduce((s, c) => s + c.days, 0);

  return {
    age: ctx.age,
    seed: ctx.seed,
    R_age: Number(R.toFixed(3)),
    band: band.label,
    trei_cutoff: Number.isFinite(cutoff) ? Number(cutoff.toFixed(2)) : -1,
    start_city: ctx.startCity,
    cities,
    annual_cost_usd: Math.round(annualCost),
    total_days: days.reduce((a, b) => a + b, 0),
    provinces_visited: [...new Set(cities.map((c) => c.province))],
    frontier_share: Number((frontierDays / totalDays).toFixed(2)),
  };
}

/** Distribute the year's days across cities, weighted by positive utility. */
function distributeDays(chosen: Scored[], totalDays: number): number[] {
  if (chosen.length === 0) return [];
  if (chosen.length === 1) return [totalDays];
  const weights = chosen.map((s) => Math.max(s.utility, 0.1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const days = weights.map((w) => Math.floor((w / sum) * totalDays));
  let remainder = totalDays - days.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % days.length, remainder--) days[i]++;
  return days;
}
