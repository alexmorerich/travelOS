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
import { annualMeanTemp, nightTemp, monthlyDiscomfort, NIGHT_FLOOR_C, NIGHT_CEIL_C } from "./climate_engine";
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

// Seasonal refuge rule (Bug 2 — routing layer). Comfort is judged on the OVERNIGHT
// low. A city can host deep winter only if its January night clears NIGHT_FLOOR_C;
// it can host peak summer only if its July night stays under NIGHT_CEIL_C. When a
// year's whole itinerary is too cold (frontier expeditions, interior cultural
// loops) we graft on a warm-south wintering base; when it is too hot (the southern
// comfort band) we graft on a cool-highland summering base. The scheduler then
// retreats to each in its season — the snowbird pattern, made explicit.
const WINTER_MONTHS = [12, 1, 2];
const SUMMER_MONTHS = [6, 7, 8];
const seasonNight = (c: ProcessedCity, month: number): number =>
  nightTemp(c.lat, c.altitude_m ?? 0, month, c.humidity_index ?? 55);
const seasonDiscomfort = (c: ProcessedCity, months: number[]): number =>
  months.reduce((s, m) => s + monthlyDiscomfort(c.lat, c.altitude_m ?? 0, m, c.humidity_index ?? 55), 0);

export interface YearContext {
  nodes: ProcessedCity[];
  graph: Graph;
  age: number;
  startCity: string;
  visitedRecent: Set<string>;
  visitedEver: Set<string>;
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
  winterRefuge?: boolean;          // a warm-south base grafted on for the cold months
  summerRefuge?: boolean;          // a cool-highland base grafted on for the hot months
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
  // Rural-discovery / coverage bonus: pull in county seats early, fade to ~0 by
  // the comfort phase (where hospital access matters more than novelty).
  const ruralTerm = city.county ? 1.6 * clamp(1 - band.hospital_bonus / 3.5, 0, 1) : 0;

  return cultureTerm - costTerm - travelTerm + zoneTerm + comfortTerm + hospitalTerm + ruralTerm;
}

export function planYear(ctx: YearContext): YearPlan {
  const { nodes, graph, age, startCity, visitedRecent, visitedEver, rng, seed, weights } = ctx;
  const R = rAge(age);
  const band = bandForAge(age);
  // Explore bands sweep new ground (avoid ever-visited); the comfort band may settle.
  const exclude = band.explore ? visitedEver : visitedRecent;

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

  // Regional anchor: each year, migrate (one long-haul move) into this band's
  // target zone, then explore locally. The focus province ROTATES year by year
  // so the Expedition band spreads across ALL of Xinjiang / Tibet / Inner
  // Mongolia / Heilongjiang instead of concentrating in whichever happens to
  // have the most cities. Falls back to the whole zone if the focus is infeasible.
  if (band.target_provinces.length > 0) {
    const focus = new Set([band.target_provinces[(age - band.age_from) % band.target_provinces.length]]);
    const zone = new Set(band.target_provinces);
    const pickAnchor = (provs: Set<string>, useExclude: boolean) => {
      let bestRec: { city: ProcessedCity; med: number; treiVal: number } | null = null;
      let bestU = -Infinity;
      for (const city of nodes) {
        if (!provs.has(city.province) || usedThisYear.has(city.id)) continue;
        if (useExclude && exclude.has(city.id)) continue;
        const rec = byId.get(city.id);
        if (!rec || rec.blocked) continue;
        const u = utilityOf(rec.city, rec.treiVal, 0, weights, band, rec.med); // no travel: it's a flight
        if (u > bestU) { bestU = u; bestRec = rec; }
      }
      return bestRec ? { rec: bestRec, u: bestU } : null;
    };
    // prefer a never-visited city in the rotating focus province; widen as needed
    const a = pickAnchor(focus, true) ?? pickAnchor(zone, true) ?? pickAnchor(focus, false) ?? pickAnchor(zone, false);
    if (a) {
      chosen.push({
        city: a.rec.city, medical_risk: a.rec.med, TREI: a.rec.treiVal,
        utility: a.u, decision: decide(false, a.rec.treiVal, cutoff),
      });
      usedThisYear.add(a.rec.city.id);
      current = a.rec.city.id;
    }
  }

  for (let hop = chosen.length; hop < nCities; hop++) {
    const neighbours = graph.adj.get(current);
    if (!neighbours || neighbours.size === 0) break;

    const buildCandidates = (useExclude: boolean) => {
      const out: { scored: Scored; travelKm: number }[] = [];
      for (const [id, edge] of neighbours) {
        if (usedThisYear.has(id)) continue;
        if (useExclude && exclude.has(id)) continue;
        const rec = byId.get(id);
        if (!rec || rec.blocked) continue;
        const u = utilityOf(rec.city, rec.treiVal, edge.distance_km, weights, band, rec.med);
        out.push({
          scored: {
            city: rec.city, medical_risk: rec.med, TREI: rec.treiVal,
            utility: u, decision: decide(false, rec.treiVal, cutoff),
          },
          travelKm: edge.distance_km,
        });
      }
      return out;
    };
    let candidates = buildCandidates(true);
    if (candidates.length === 0) candidates = buildCandidates(false); // fall back to visited if no new ground
    if (candidates.length === 0) break;

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

  // Seasonal refuges: if no chosen city can keep the deep-winter night >= floor,
  // graft the best warm-south wintering base; if none can keep the peak-summer
  // night <= ceiling, graft the best cool-highland summering base (each: lowest
  // in-season discomfort, mild culture tie-break, revisits allowed — a seasonal
  // home is meant to recur). distributeDays reserves each refuge its share and the
  // scheduler assigns the matching months there.
  const addRefuge = (
    need: boolean, share: number, season: "winter" | "summer",
    eligible: (c: ProcessedCity) => boolean, months: number[],
  ): void => {
    if (share <= 0 || !need || chosen.length === 0) return;
    let best: { city: ProcessedCity; med: number; treiVal: number } | null = null;
    let bestD = Infinity, bestCult = -1;
    for (const { city, med, treiVal, blocked } of byId.values()) {
      if (blocked || usedThisYear.has(city.id) || !eligible(city)) continue;
      const d = seasonDiscomfort(city, months);
      if (d < bestD || (d === bestD && city.cultural_value > bestCult)) {
        bestD = d; bestCult = city.cultural_value; best = { city, med, treiVal };
      }
    }
    if (!best) return;
    const sc: Scored = {
      city: best.city, medical_risk: best.med, TREI: best.treiVal,
      utility: 0, decision: decide(false, best.treiVal, cutoff),
    };
    if (season === "winter") sc.winterRefuge = true; else sc.summerRefuge = true;
    chosen.push(sc);
    usedThisYear.add(best.city.id);
  };

  const warmestWinterNight = Math.max(...chosen.map((s) => seasonNight(s.city, 1)));
  const coolestSummerNight = Math.min(...chosen.map((s) => seasonNight(s.city, 7)));
  addRefuge(warmestWinterNight < NIGHT_FLOOR_C, systemConfig.winter_refuge_share, "winter",
            (c) => seasonNight(c, 1) >= NIGHT_FLOOR_C, WINTER_MONTHS);
  addRefuge(coolestSummerNight > NIGHT_CEIL_C, systemConfig.summer_refuge_share, "summer",
            (c) => seasonNight(c, 7) <= NIGHT_CEIL_C, SUMMER_MONTHS);

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

/** Distribute the year's days across cities, weighted by positive utility. Any
 *  seasonal refuge first claims its fixed share (winter_/summer_refuge_share); the
 *  remainder is split by utility across the exploration cities. */
function distributeDays(chosen: Scored[], totalDays: number): number[] {
  if (chosen.length === 0) return [];
  if (chosen.length === 1) return [totalDays];

  const days = new Array(chosen.length).fill(0);
  const shareOf = (s: Scored): number =>
    s.winterRefuge ? systemConfig.winter_refuge_share
    : s.summerRefuge ? systemConfig.summer_refuge_share : 0;

  const refuges = chosen.map((_, i) => i).filter((i) => shareOf(chosen[i]) > 0);
  const others = chosen.map((_, i) => i).filter((i) => shareOf(chosen[i]) === 0);
  for (const i of refuges) days[i] = Math.round(totalDays * shareOf(chosen[i]));

  if (others.length === 0) { // refuges only — split remaining evenly among them
    let rem = totalDays - days.reduce((a, b) => a + b, 0);
    for (let k = 0; rem !== 0; k = (k + 1) % refuges.length, rem -= Math.sign(rem)) days[refuges[k]] += Math.sign(rem);
    return days;
  }
  const pool = Math.max(0, totalDays - refuges.reduce((s, i) => s + days[i], 0));
  const weights = others.map((i) => Math.max(chosen[i].utility, 0.1));
  const sum = weights.reduce((a, b) => a + b, 0);
  others.forEach((i, k) => { days[i] = Math.floor((weights[k] / sum) * pool); });
  let remainder = totalDays - days.reduce((a, b) => a + b, 0);
  for (let k = 0; remainder > 0; k = (k + 1) % others.length, remainder--) days[others[k]]++;
  return days;
}
