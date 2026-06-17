// Renders a single self-contained dark-theme HTML dashboard (inline SVG, no
// external/CDN dependencies) so it opens straight from disk.
import type { YearPlan, FinanceResult, ScenarioResult, StrategyResult, ScheduleYear } from "../types";
import type { ValidationReport } from "../data_layer/validate";

export interface DashboardInput {
  plans: YearPlan[];
  finance: FinanceResult;
  treiSample: { age: number; values: { name_en: string; TREI: number }[] };
  validation: ValidationReport;
  scenarios: ScenarioResult[];
  strategies: StrategyResult[];
  schedule: ScheduleYear[];
  seed: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tempColor(t: number): string {
  if (t <= 4) return "#3b6fd4";
  if (t <= 14) return "#4a9bd1";
  if (t <= 26) return "#46b97a";
  if (t <= 30) return "#e0a13a";
  return "#e0563a";
}

function scheduleStrip(schedule: ScheduleYear[]): string {
  // Show a few representative years as 12-month colour strips.
  const picks = [52, 60, 70].map((a) => schedule.find((s) => s.age === a)).filter(Boolean) as ScheduleYear[];
  const rows = picks.map((yr) => {
    const cells = yr.months.map((m) =>
      `<td title="${m.name_en} ${m.temp_c}°C" style="background:${tempColor(m.temp_c)};color:#0c1320;font-size:10px;padding:3px 2px;text-align:center;min-width:42px">
        <div style="font-weight:600">${MONTHS[m.month - 1]}</div><div>${m.name_en.slice(0, 7)}</div><div>${Math.round(m.temp_c)}°</div></td>`,
    ).join("");
    return `<tr><td style="padding-right:10px;color:#7c8aa5;white-space:nowrap">Age ${yr.age} · ${yr.calendar_year}</td>${cells}</tr>`;
  }).join("");
  return `<table style="border-collapse:separate;border-spacing:2px"><tbody>${rows}</tbody></table>`;
}

function pct(p: number): string {
  return (p * 100).toFixed(1) + "%";
}
function survBar(p: number): string {
  const color = p >= 0.8 ? "#46b97a" : p >= 0.5 ? "#e0a13a" : "#e0563a";
  return `<div style="background:#1b2740;border-radius:4px;overflow:hidden;height:16px;min-width:90px">
    <div style="width:${Math.max(2, p * 100).toFixed(0)}%;height:100%;background:${color}"></div></div>`;
}

function scenarioTable(scenarios: ScenarioResult[]): string {
  const rows = scenarios.map((s) => `<tr>
    <td>${s.label}</td>
    <td style="display:flex;gap:8px;align-items:center">${survBar(s.survival_probability)} ${pct(s.survival_probability)}</td>
    <td style="text-align:right">$${s.mean_annual_cost_usd.toLocaleString()}</td>
    <td style="text-align:right">${s.median_bankruptcy_age ?? "—"}</td>
  </tr>`).join("");
  return `<table><thead><tr><th>Routing objective</th><th>Survival to 80</th><th style="text-align:right">Mean $/yr</th><th style="text-align:right">Median bankruptcy</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function strategyTable(strategies: StrategyResult[]): string {
  const rows = strategies.map((s, i) => `<tr>
    <td>${i === 0 ? "🏆 " : ""}${s.label}</td>
    <td style="display:flex;gap:8px;align-items:center">${survBar(s.survival_probability)} ${pct(s.survival_probability)}</td>
    <td style="text-align:right">$${Math.round(s.median_terminal_net_worth / 1000)}k</td>
    <td style="text-align:right">${s.property_price_usd ? "$" + Math.round(s.property_price_usd / 1000) + "k" : "—"}</td>
    <td style="text-align:right">${s.median_bankruptcy_age ?? "—"}</td>
  </tr>`).join("");
  return `<table><thead><tr><th>Strategy</th><th>Survival to 80</th><th style="text-align:right">Median net worth</th><th style="text-align:right">Home</th><th style="text-align:right">Median bankruptcy</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const W = 860;

function fmtUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function survivalCurve(finance: FinanceResult): string {
  const t = finance.trajectories;
  const h = 280, padL = 70, padR = 20, padT = 20, padB = 40;
  const innerW = W - padL - padR, innerH = h - padT - padB;
  const ages = t.map((p) => p.age);
  const maxY = Math.max(finance.initial_portfolio_usd, ...t.map((p) => p.p90)) * 1.05;
  const x = (age: number) => padL + ((age - ages[0]) / (ages[ages.length - 1] - ages[0])) * innerW;
  const y = (v: number) => padT + innerH - (v / maxY) * innerH;

  const band =
    t.map((p) => `${x(p.age).toFixed(1)},${y(p.p90).toFixed(1)}`).join(" ") +
    " " +
    [...t].reverse().map((p) => `${x(p.age).toFixed(1)},${y(p.p10).toFixed(1)}`).join(" ");
  const median = t.map((p) => `${x(p.age).toFixed(1)},${y(p.p50).toFixed(1)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = f * maxY;
    return `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="#23304a"/>
      <text x="${padL - 8}" y="${y(v) + 4}" fill="#7c8aa5" font-size="11" text-anchor="end">${fmtUsd(v)}</text>`;
  }).join("");
  const xTicks = ages.filter((a) => a % 5 === 0).map((a) =>
    `<text x="${x(a)}" y="${h - padB + 18}" fill="#7c8aa5" font-size="11" text-anchor="middle">${a}</text>`,
  ).join("");

  const initLine = `<line x1="${padL}" y1="${y(finance.initial_portfolio_usd)}" x2="${W - padR}" y2="${y(finance.initial_portfolio_usd)}" stroke="#e0a13a" stroke-dasharray="4 4"/>`;

  return `<svg viewBox="0 0 ${W} ${h}" width="100%">
    ${yTicks}${xTicks}
    <polygon points="${band}" fill="#2f6df6" opacity="0.18"/>
    <polyline points="${median}" fill="none" stroke="#4f8bff" stroke-width="2.5"/>
    ${initLine}
    <text x="${W - padR}" y="${y(finance.initial_portfolio_usd) - 6}" fill="#e0a13a" font-size="10" text-anchor="end">initial $500k</text>
  </svg>`;
}

function treiHistogram(sample: DashboardInput["treiSample"]): string {
  const h = 240, padL = 40, padR = 20, padT = 20, padB = 40;
  const innerW = W - padL - padR, innerH = h - padT - padB;
  const vals = sample.values.map((v) => v.TREI);
  const maxV = Math.max(6, ...vals);
  const nBins = 12;
  const binW = maxV / nBins;
  const bins = new Array(nBins).fill(0);
  for (const v of vals) bins[Math.min(nBins - 1, Math.floor(v / binW))]++;
  const maxCount = Math.max(...bins);
  const bw = innerW / nBins;

  const bars = bins.map((c, i) => {
    const bh = (c / maxCount) * innerH;
    const xx = padL + i * bw;
    const yy = padT + innerH - bh;
    return `<rect x="${xx + 2}" y="${yy}" width="${bw - 4}" height="${bh}" fill="#46b97a"/>
      <text x="${xx + bw / 2}" y="${padT + innerH + 14}" fill="#7c8aa5" font-size="10" text-anchor="middle">${(i * binW).toFixed(0)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${h}" width="100%">
    <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#23304a"/>
    ${bars}
    <text x="${W / 2}" y="${h - 4}" fill="#7c8aa5" font-size="11" text-anchor="middle">TREI bucket (age ${sample.age})</text>
  </svg>`;
}

function routeTable(plans: YearPlan[]): string {
  const rows = plans.map((p) => {
    const cities = p.cities.map((c) => `${c.name_en} (${c.days}d)`).join(", ");
    return `<tr>
      <td>${p.age}</td><td>${p.R_age.toFixed(2)}</td>
      <td>${cities}</td>
      <td style="text-align:right">${fmtUsd(p.annual_cost_usd)}</td>
      <td style="text-align:right">${p.cities[0]?.TREI.toFixed(1) ?? "—"}</td>
    </tr>`;
  }).join("");
  return `<table>
    <thead><tr><th>Age</th><th>R_age</th><th>Cities (days)</th><th style="text-align:right">Annual cost</th><th style="text-align:right">Lead TREI</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

export function renderDashboard(d: DashboardInput): string {
  const surv = (d.finance.survival_probability * 100).toFixed(1);
  const survColor = d.finance.survival_probability >= 0.8 ? "#46b97a" : d.finance.survival_probability >= 0.5 ? "#e0a13a" : "#e0563a";
  const bankrupt = d.finance.median_bankruptcy_age ?? "—";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Travel Life OS v4.0 — Dashboard</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0c1320; color:#dfe6f1; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:900px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:#7c8aa5; margin:0 0 28px; font-size:13px; }
  .cards { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:28px; }
  .card { flex:1; min-width:170px; background:#121b2c; border:1px solid #1e2a40; border-radius:12px; padding:16px 18px; }
  .card .k { color:#7c8aa5; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:28px; font-weight:650; margin-top:6px; }
  .panel { background:#121b2c; border:1px solid #1e2a40; border-radius:12px; padding:18px 18px 10px; margin-bottom:22px; }
  .panel h2 { font-size:15px; margin:0 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th,td { padding:6px 8px; border-bottom:1px solid #1b2740; text-align:left; }
  th { color:#7c8aa5; font-weight:600; position:sticky; top:0; background:#121b2c; }
  .scroll { max-height:420px; overflow:auto; }
  .foot { color:#5d6a85; font-size:11.5px; margin-top:24px; }
</style></head>
<body><div class="wrap">
  <h1>🌍 Travel Life OS v4.0 — Life Trajectory Dashboard</h1>
  <p class="sub">Deterministic run · seed ${d.seed} · ${d.plans.length} years (age ${d.plans[0]?.age}–${d.plans[d.plans.length - 1]?.age}) · ${d.finance.n_paths.toLocaleString()} Monte Carlo paths</p>

  <div class="cards">
    <div class="card"><div class="k">P(capital survives to 80)</div><div class="v" style="color:${survColor}">${surv}%</div></div>
    <div class="card"><div class="k">Median bankruptcy age</div><div class="v">${bankrupt}</div></div>
    <div class="card"><div class="k">Effective withdrawal</div><div class="v">${(d.finance.effective_withdrawal_rate * 100).toFixed(1)}%</div></div>
    <div class="card"><div class="k">Median terminal</div><div class="v">${fmtUsd(d.finance.p50_terminal)}</div></div>
  </div>

  <div class="panel"><h2>🛣️ Routing lever — survival by objective (rent-only)</h2>${scenarioTable(d.scenarios)}
    <p class="foot" style="margin-top:6px">Same safety gates, same finance model — the only change is how much you pay for experience.</p></div>
  <div class="panel"><h2>🧠 v4.1 strategy selector — coupled housing + healthcare + tax (ranked)</h2>${strategyTable(d.strategies)}
    <p class="foot" style="margin-top:6px">Survival is on LIQUID capital; net worth includes an owned home. Buying lowers drawdown and floors net worth but shrinks the liquid buffer.</p></div>

  <div class="panel"><h2>💰 Portfolio survival curve — primary run (real USD · p10–p90 band, p50 line)</h2>${survivalCurve(d.finance)}</div>
  <div class="panel"><h2>🌡️ TREI risk distribution across cities</h2>${treiHistogram(d.treiSample)}</div>
  <div class="panel"><h2>📅 Seasonal residence calendar (sample years)</h2>${scheduleStrip(d.schedule)}
    <p class="foot" style="margin-top:6px">Colour = estimated monthly temperature (blue cold → red hot). Full month-by-month plan in <code>schedule.json</code>; importable calendar in <code>schedule.ics</code>.</p></div>
  <div class="panel"><h2>🗺️ 30-year route</h2><div class="scroll">${routeTable(d.plans)}</div></div>

  <p class="foot">Data: ${d.validation.total_nodes} nodes (${d.validation.valid} VALID, ${d.validation.partial} PARTIAL, ${d.validation.invalid} INVALID).
  Edges are great-circle approximations. Risk thresholds are hybrid (absolute hospital/altitude ceilings + relative TREI percentile).
  This is a planning model, not financial advice.</p>
</div></body></html>`;
}
