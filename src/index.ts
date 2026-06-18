// Travel Life OS v4.0 — pipeline entrypoint.
//   load -> validate -> graph -> risk -> lifecycle routing -> finance MC
//   -> JSON outputs + HTML dashboard + Obsidian vault.
//
// Run: npm run simulate
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, systemConfig, thresholds, routingProfiles } from "./config";
import { loadCities } from "./data_layer/loader";
import { validateDataset } from "./data_layer/validate";
import { buildGraph, isolatedNodes } from "./graph_layer/city_graph_builder";
import { rAge, trei, medicalRisk } from "./core_engine/trei_engine";
import { isHardBlocked, decide } from "./core_engine/constraint_engine";
import { runLifecycle } from "./core_engine/lifecycle_engine";
import { runFinance } from "./core_engine/finance_engine";
import { runScenarios } from "./simulation_engine/scenario_runner";
import { buildSchedule, toICS } from "./simulation_engine/monthly_scheduler";
import { runStrategies } from "./v41/strategy_engine";
import { renderDashboard } from "./dashboard/visualization_generator";
import { renderTimeline } from "./dashboard/timeline_generator";
import { exportObsidian } from "./dashboard/obsidian_exporter";
import { percentile } from "./lib/geo";
import type { ProcessedCity, Graph } from "./types";

const OUT = join(ROOT, "outputs");

function writeJson(name: string, data: unknown): void {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

/** Per-age risk for every city + the percentile cutoff used that year. */
function riskAtAge(nodes: ProcessedCity[], age: number) {
  const R = rAge(age);
  const scored = nodes.map((c) => {
    const med = medicalRisk(c.tier3_hospital_minutes);
    const treiVal = trei(c.env_risk, med, R);
    const blocked = isHardBlocked(c, age);
    return { c, med, treiVal, blocked };
  });
  const cutoff = percentile(scored.filter((s) => !s.blocked).map((s) => s.treiVal), thresholds.trei_percentile_cutoff);
  return scored.map((s) => ({
    id: s.c.id,
    name_en: s.c.name_en,
    province: s.c.province,
    env_risk: Number(s.c.env_risk.toFixed(2)),
    medical_risk: Number(s.med.toFixed(2)),
    TREI: Number(s.treiVal.toFixed(2)),
    decision: decide(s.blocked, s.treiVal, cutoff),
  }));
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  console.log("🌍 Travel Life OS v4.0\n");

  // 1. Load + validate
  const cities = loadCities();
  const validation = validateDataset(cities);
  writeJson("invalid_nodes_report.json", validation);
  console.log(`  data: ${validation.total_nodes} nodes — ${validation.valid} VALID / ${validation.partial} PARTIAL / ${validation.invalid} INVALID`);
  for (const w of validation.warnings) console.log(`  ⚠ ${w}`);
  if (!validation.passed) {
    console.error("  ✖ validation failed (fatal). Aborting.");
    process.exit(1);
  }

  // 2. Graph
  const graph: Graph = buildGraph(cities);
  const isolated = isolatedNodes(cities, graph);
  console.log(`  graph: ${graph.edges.length} edges within ${systemConfig.radius_km}km${isolated.length ? `, ${isolated.length} isolated` : ""}`);
  writeJson("edges.json", graph.edges);

  // 3. Risk heatmap across representative ages
  const heatmap = systemConfig.risk_heatmap_ages.map((age) => ({ age, cities: riskAtAge(cities, age) }));
  writeJson("risk_heatmap.json", heatmap);

  // 4. Lifecycle routing (ages 50 -> 80) under the primary routing profile
  const primary = routingProfiles.profiles.find((p) => p.key === routingProfiles.primary) ?? routingProfiles.profiles[0];
  const { plans, phases, costByAge } = runLifecycle(cities, graph, systemConfig.seed, primary.weights);
  writeJson("yearly_plan.json", plans);
  writeJson("full_30_year_route.json", phases);

  // 5. Finance Monte Carlo (primary profile, rent-only baseline)
  const finance = runFinance(costByAge, systemConfig.seed, { label: primary.label });
  writeJson("cashflow_report.json", finance);

  // 5a. Task 1 — routing-profile comparison (isolates the routing lever)
  const scenarios = runScenarios(cities, graph, systemConfig.seed);
  writeJson("scenario_comparison.json", scenarios);

  // 5b. v4.1 — coupled life-strategy comparison (housing + healthcare + tax)
  const strategies = runStrategies(cities, graph, systemConfig.seed);
  writeJson("strategy_comparison.json", strategies);

  // 5c. Time layer — monthly/quarterly schedule + importable calendar
  const schedule = buildSchedule(plans, cities);
  writeJson("schedule.json", schedule);
  writeFileSync(join(OUT, "schedule.ics"), toICS(schedule), "utf8");

  // 6. Dashboard + Obsidian
  const sampleAge = systemConfig.risk_heatmap_ages[Math.floor(systemConfig.risk_heatmap_ages.length / 2)] ?? 65;
  const treiSample = {
    age: sampleAge,
    values: riskAtAge(cities, sampleAge).filter((c) => c.decision !== "BLOCKED").map((c) => ({ name_en: c.name_en, TREI: c.TREI })),
  };
  const dashboardHtml = renderDashboard({ plans, finance, treiSample, validation, scenarios, strategies, schedule, seed: systemConfig.seed });
  const timelineHtml = renderTimeline({ schedule, cities, finance, seed: systemConfig.seed });
  writeFileSync(join(OUT, "dashboard.html"), dashboardHtml, "utf8");
  writeFileSync(join(OUT, "timeline.html"), timelineHtml, "utf8");

  // Pages-ready copies under docs/ so the static demo can be hosted on GitHub
  // Pages (source: main /docs). index.html redirects to the interactive timeline.
  const DOCS = join(ROOT, "docs");
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(join(DOCS, "timeline.html"), timelineHtml, "utf8");
  writeFileSync(join(DOCS, "dashboard.html"), dashboardHtml, "utf8");
  writeFileSync(
    join(DOCS, "index.html"),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./timeline.html"><title>Travel Life OS</title><body style="background:#0c1320;color:#dfe6f1;font-family:sans-serif"><a href="./timeline.html" style="color:#4f8bff">Open the interactive timeline →</a></body>',
    "utf8",
  );

  const noteCount = exportObsidian({ plans, phases, finance, schedule, seed: systemConfig.seed }, OUT);

  // Summary — the numbers the whole system exists to produce.
  console.log("\n  ── primary run (experience-optimized) ──────");
  console.log(`  P(capital survives to 80) : ${(finance.survival_probability * 100).toFixed(1)}%`);
  console.log(`  median bankruptcy age     : ${finance.median_bankruptcy_age ?? "—"}`);
  console.log(`  effective withdrawal rate : ${(finance.effective_withdrawal_rate * 100).toFixed(1)}%  (mean $${finance.mean_annual_cost_usd.toLocaleString()}/yr)`);

  console.log("\n  ── routing lever (Task 1) ──────────────────");
  for (const s of scenarios) {
    console.log(`  ${s.label.padEnd(22)} survival ${(s.survival_probability * 100).toFixed(1).padStart(5)}%   $${s.mean_annual_cost_usd.toLocaleString()}/yr`);
  }

  console.log("\n  ── v4.1 strategy selector (ranked) ─────────");
  for (const s of strategies) {
    const nw = `$${Math.round(s.median_terminal_net_worth / 1000)}k`;
    console.log(`  ${s.label.padEnd(34)} survival ${(s.survival_probability * 100).toFixed(1).padStart(5)}%   net worth ${nw}`);
  }
  const sched = schedule.find((s) => s.age === 55) ?? schedule[0];
  if (sched && sched.months.length === 12) {
    const jan = sched.months[0], jul = sched.months[6];
    console.log("\n  ── seasonal schedule (age 55 sample) ───────");
    console.log(`  calendar ${sched.calendar_year}:  Jan → ${jan.name_en} ${jan.temp_c}°C   ·   Jul → ${jul.name_en} ${jul.temp_c}°C`);
    console.log(`  quarters: ${sched.quarters.map((q) => `Q${q.quarter} ${q.name_en}`).join("  ")}`);
  }

  console.log("\n  ── 30-year lifecycle matrix ────────────────");
  for (const b of ["Expedition", "Cultural deep-dive", "Climate & comfort"]) {
    const bp = plans.filter((p) => p.band === b);
    if (!bp.length) continue;
    const ages = `${bp[0].age}-${bp[bp.length - 1].age}`;
    const fshare = ((bp.reduce((s, p) => s + p.frontier_share, 0) / bp.length) * 100).toFixed(0);
    const provs = [...new Set(bp.flatMap((p) => p.provinces_visited))].slice(0, 5).join(", ");
    console.log(`  ${b.padEnd(20)} age ${ages.padEnd(6)} frontier ${fshare.padStart(3)}%  ${provs}`);
  }
  console.log("  ────────────────────────────────────────────");
  console.log(`\n  outputs/  → 9 JSON files, schedule.ics, dashboard.html, timeline.html, obsidian/ (${noteCount} notes)`);
  console.log("  open outputs/timeline.html  → interactive map: scrub the route, see city + cost over 30 years");
  console.log("  open outputs/dashboard.html → comparisons, survival curve, calendar.\n");
}

main();
