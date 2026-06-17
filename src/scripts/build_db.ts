// Builds a local SQLite database (outputs/travel_os.db) from the dataset and the
// generated plan/finance outputs. The schema is D1-compatible, so the same DDL
// can seed a Cloudflare D1 instance.
//
// better-sqlite3 is an OPTIONAL dependency: the core simulation never needs it.
// If it isn't installed, this script explains how to enable it and exits 0.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config";
import { loadCities } from "../data_layer/loader";
import { buildGraph } from "../graph_layer/city_graph_builder";
import type { YearPlan, FinanceResult, ScenarioResult, StrategyResult, ScheduleYear } from "../types";

async function loadDriver(): Promise<any | null> {
  try {
    const mod = await import("better-sqlite3");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const Database = await loadDriver();
  if (!Database) {
    console.log("ℹ better-sqlite3 not installed — skipping SQLite build.");
    console.log("  Enable it with:  npm install better-sqlite3");
    console.log("  (The JSON outputs and dashboard do not require it.)");
    return;
  }

  const outDir = join(ROOT, "outputs");
  const planPath = join(outDir, "yearly_plan.json");
  const financePath = join(outDir, "cashflow_report.json");
  if (!existsSync(planPath) || !existsSync(financePath)) {
    console.error("✖ Run `npm run simulate` first to generate outputs/.");
    process.exit(1);
  }

  const dbPath = join(outDir, "travel_os.db");
  const db = new Database(dbPath);
  db.exec(readFileSync(join(ROOT, "database/schema.sql"), "utf8"));
  // Delete children before parents (cities is referenced by edges/plans).
  db.exec("DELETE FROM edges; DELETE FROM yearly_plan_cities; DELETE FROM finance_summary; DELETE FROM scenario_results; DELETE FROM strategy_results; DELETE FROM schedule_months; DELETE FROM cities;");

  const cities = loadCities();
  const graph = buildGraph(cities);
  const plans = JSON.parse(readFileSync(planPath, "utf8")) as YearPlan[];
  const finance = JSON.parse(readFileSync(financePath, "utf8")) as FinanceResult;
  const readOpt = <T>(p: string): T[] => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T[]) : []);
  const scenarios = readOpt<ScenarioResult>(join(outDir, "scenario_comparison.json"));
  const strategies = readOpt<StrategyResult>(join(outDir, "strategy_comparison.json"));
  const schedule = readOpt<ScheduleYear>(join(outDir, "schedule.json"));

  const insertCity = db.prepare(
    `INSERT INTO cities (id,name,name_en,province,lat,lng,altitude_m,tier3_hospital_minutes,avg_temp_range,humidity_index,monthly_cost_usd,cultural_value,env_risk,completeness)
     VALUES (@id,@name,@name_en,@province,@lat,@lng,@altitude_m,@tier3_hospital_minutes,@avg_temp_range,@humidity_index,@monthly_cost_usd,@cultural_value,@env_risk,@completeness)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO edges (from_id,to_id,distance_km,travel_time_hours,cost_index,method) VALUES (?,?,?,?,?,?)`,
  );
  const insertPlan = db.prepare(
    `INSERT INTO yearly_plan_cities (age,seq,city_id,days,monthly_cost_usd,env_risk,medical_risk,trei,utility,decision)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  const tx = db.transaction(() => {
    for (const c of cities) {
      insertCity.run({
        id: c.id, name: c.name, name_en: c.name_en, province: c.province,
        lat: c.lat, lng: c.lng, altitude_m: c.altitude_m,
        tier3_hospital_minutes: c.tier3_hospital_minutes, avg_temp_range: c.avg_temp_range,
        humidity_index: c.humidity_index, monthly_cost_usd: c.monthly_cost_usd,
        cultural_value: c.cultural_value, env_risk: c.env_risk, completeness: c.completeness,
      });
    }
    for (const e of graph.edges) insertEdge.run(e.from, e.to, e.distance_km, e.travel_time_hours, e.cost_index, e.method);
    for (const p of plans) {
      p.cities.forEach((c, i) =>
        insertPlan.run(p.age, i, c.id, c.days, c.monthly_cost_usd, c.env_risk, c.medical_risk, c.TREI, c.utility, c.decision),
      );
    }
    db.prepare(
      `INSERT INTO finance_summary (id,initial_portfolio_usd,n_paths,survival_probability,median_bankruptcy_age,effective_withdrawal_rate,p50_terminal)
       VALUES (1,?,?,?,?,?,?)`,
    ).run(
      finance.initial_portfolio_usd, finance.n_paths, finance.survival_probability,
      finance.median_bankruptcy_age, finance.effective_withdrawal_rate, finance.p50_terminal,
    );
    const insScenario = db.prepare(
      `INSERT INTO scenario_results (key,label,survival_probability,median_bankruptcy_age,mean_annual_cost_usd,effective_withdrawal_rate) VALUES (?,?,?,?,?,?)`,
    );
    for (const s of scenarios) insScenario.run(s.key, s.label, s.survival_probability, s.median_bankruptcy_age, s.mean_annual_cost_usd, s.effective_withdrawal_rate);
    const insStrategy = db.prepare(
      `INSERT INTO strategy_results (key,label,routing,buy,settle_city,jurisdiction,property_price_usd,survival_probability,median_bankruptcy_age,median_terminal_net_worth) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const s of strategies) insStrategy.run(s.key, s.label, null, s.buy ? 1 : 0, s.settle_city, s.jurisdiction, s.property_price_usd, s.survival_probability, s.median_bankruptcy_age, s.median_terminal_net_worth);
    const insSched = db.prepare(
      `INSERT INTO schedule_months (age,calendar_year,month,city_id,name_en,temp_c,discomfort) VALUES (?,?,?,?,?,?,?)`,
    );
    for (const yr of schedule) for (const m of yr.months) insSched.run(yr.age, yr.calendar_year, m.month, m.city_id, m.name_en, m.temp_c, m.discomfort);
  });
  tx();

  const n = db.prepare("SELECT COUNT(*) AS n FROM cities").get() as { n: number };
  const e = db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number };
  console.log(`✔ SQLite written: ${dbPath}`);
  console.log(`  cities=${n.n}  edges=${e.n}  plans=${plans.length}y  survival=${(finance.survival_probability * 100).toFixed(1)}%`);
  db.close();
}

main();
