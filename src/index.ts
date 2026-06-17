// Travel Life OS v4.0 — pipeline entrypoint.
//   load -> validate -> graph -> risk -> lifecycle routing -> finance MC
//   -> JSON outputs + HTML dashboard + Obsidian vault.
//
// Run: npm run simulate
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, systemConfig, thresholds } from "./config";
import { loadCities } from "./data_layer/loader";
import { validateDataset } from "./data_layer/validate";
import { buildGraph, isolatedNodes } from "./graph_layer/city_graph_builder";
import { rAge, trei, medicalRisk } from "./core_engine/trei_engine";
import { isHardBlocked, decide } from "./core_engine/constraint_engine";
import { runLifecycle } from "./core_engine/lifecycle_engine";
import { runFinance } from "./core_engine/finance_engine";
import { renderDashboard } from "./dashboard/visualization_generator";
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

  // 4. Lifecycle routing (ages 50 -> 80)
  const { plans, phases, costByAge } = runLifecycle(cities, graph, systemConfig.seed);
  writeJson("yearly_plan.json", plans);
  writeJson("full_30_year_route.json", phases);

  // 5. Finance Monte Carlo
  const finance = runFinance(costByAge, systemConfig.seed);
  writeJson("cashflow_report.json", finance);

  // 6. Dashboard + Obsidian
  const sampleAge = systemConfig.risk_heatmap_ages[Math.floor(systemConfig.risk_heatmap_ages.length / 2)] ?? 65;
  const treiSample = {
    age: sampleAge,
    values: riskAtAge(cities, sampleAge).filter((c) => c.decision !== "BLOCKED").map((c) => ({ name_en: c.name_en, TREI: c.TREI })),
  };
  writeFileSync(join(OUT, "dashboard.html"), renderDashboard({ plans, finance, treiSample, validation, seed: systemConfig.seed }), "utf8");
  const noteCount = exportObsidian({ plans, phases, finance, seed: systemConfig.seed }, OUT);

  // Summary — the two numbers the whole system exists to produce.
  const sample = plans.find((p) => p.age === 65) ?? plans[0];
  console.log("\n  ── results ─────────────────────────────────");
  console.log(`  P(capital survives to 80) : ${(finance.survival_probability * 100).toFixed(1)}%`);
  console.log(`  median bankruptcy age     : ${finance.median_bankruptcy_age ?? "—"}`);
  console.log(`  effective withdrawal rate : ${(finance.effective_withdrawal_rate * 100).toFixed(1)}%  (mean $${finance.mean_annual_cost_usd.toLocaleString()}/yr)`);
  console.log(`  median terminal portfolio : $${finance.p50_terminal.toLocaleString()}`);
  console.log(`  sample (age 65) itinerary : ${sample.cities.map((c) => c.name_en).join(", ")}`);
  console.log("  ────────────────────────────────────────────");
  console.log(`\n  outputs/  → 8 JSON files, dashboard.html, obsidian/ (${noteCount} notes)`);
  console.log("  open outputs/dashboard.html to explore.\n");
}

main();
