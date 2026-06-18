// Exports an Obsidian-ready vault: one overview note (with frontmatter
// properties usable by Dataview/Bases) plus one linked note per year.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { YearPlan, RegionPhase, FinanceResult, ScheduleYear } from "../types";

export interface ObsidianInput {
  plans: YearPlan[];
  phases: RegionPhase[];
  finance: FinanceResult;
  schedule: ScheduleYear[];
  seed: number;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ageNoteName(age: number): string {
  return `Age-${age}`;
}

function scheduleSection(sched: ScheduleYear | undefined): string {
  if (!sched || sched.months.length === 0) return "";
  const rows = sched.months
    .map((m) => `| ${MON[m.month - 1]} | ${m.name_en} (${m.name}) | ${m.temp_c} | ${m.night_temp_c} | ${m.discomfort} |`)
    .join("\n");
  const q = sched.quarters.map((x) => `Q${x.quarter} ${x.name_en} (${x.avg_temp_c}°C)`).join(" · ");
  return `

## Monthly schedule — calendar ${sched.calendar_year}

> ${q}

| Month | City | Est °C | Night °C | Discomfort |
|-------|------|-------:|---------:|-----------:|
${rows}
`;
}

function yearNote(plan: YearPlan, sched: ScheduleYear | undefined, prev: number | null, next: number | null): string {
  const fm = [
    "---",
    `age: ${plan.age}`,
    `calendar_year: ${sched?.calendar_year ?? "null"}`,
    `r_age: ${plan.R_age}`,
    `annual_cost_usd: ${plan.annual_cost_usd}`,
    `cities: [${plan.cities.map((c) => `"${c.name_en}"`).join(", ")}]`,
    `provinces: [${plan.provinces_visited.map((p) => `"${p}"`).join(", ")}]`,
    `lead_trei: ${plan.cities[0]?.TREI ?? "null"}`,
    "tags: [travel-os, yearly-plan]",
    "---",
  ].join("\n");

  const rows = plan.cities
    .map(
      (c) =>
        `| ${c.name_en} (${c.name}) | ${c.province} | ${c.days} | ${c.monthly_cost_usd} | ${c.env_risk} | ${c.medical_risk} | ${c.TREI} | ${c.decision} |`,
    )
    .join("\n");

  const nav = [
    prev !== null ? `[[${ageNoteName(prev)}|← Age ${prev}]]` : "",
    next !== null ? `[[${ageNoteName(next)}|Age ${next} →]]` : "",
  ].filter(Boolean).join(" · ");

  return `${fm}

# Age ${plan.age}

> Physiology factor **R_age = ${plan.R_age}** · TREI cutoff ${plan.trei_cutoff} · annual cost **$${plan.annual_cost_usd.toLocaleString()}**

${nav}

## Itinerary

| City | Province | Days | $/mo | Env risk | Med risk | TREI | Decision |
|------|----------|-----:|-----:|---------:|---------:|-----:|----------|
${rows}
${scheduleSection(sched)}
Starts from \`${plan.start_city}\`. See [[Travel-OS-Overview]].
`;
}

function overviewNote(input: ObsidianInput): string {
  const { plans, phases, finance, seed } = input;
  const fm = [
    "---",
    "tags: [travel-os, overview]",
    `seed: ${seed}`,
    `survival_probability: ${finance.survival_probability}`,
    `median_bankruptcy_age: ${finance.median_bankruptcy_age ?? "null"}`,
    `effective_withdrawal_rate: ${finance.effective_withdrawal_rate}`,
    `initial_portfolio_usd: ${finance.initial_portfolio_usd}`,
    "---",
  ].join("\n");

  const phaseRows = phases
    .filter((p) => p.age % 5 === 0)
    .map((p) => `| ${p.age} | ${p.primary_region} | ${p.cities.join(", ")} | $${p.annual_cost_usd.toLocaleString()} |`)
    .join("\n");

  const yearLinks = plans.map((p) => `- [[${ageNoteName(p.age)}]] — ${p.cities.map((c) => c.name_en).join(", ")}`).join("\n");

  return `${fm}

# 🌍 Travel Life OS — 30-Year Plan

**Capital survives to 80:** \`${(finance.survival_probability * 100).toFixed(1)}%\` (${finance.n_paths.toLocaleString()} Monte Carlo paths)
**Median bankruptcy age:** \`${finance.median_bankruptcy_age ?? "—"}\`
**Effective withdrawal rate:** \`${(finance.effective_withdrawal_rate * 100).toFixed(1)}%\` on $${finance.initial_portfolio_usd.toLocaleString()}

## Life phases (every 5 years)

| Age | Region pattern | Cities | Annual cost |
|----:|----------------|--------|-------------|
${phaseRows}

## All years

${yearLinks}
`;
}

/** Write the vault to <outDir>/obsidian and return the file count. */
export function exportObsidian(input: ObsidianInput, outDir: string): number {
  const dir = join(outDir, "obsidian");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "Travel-OS-Overview.md"), overviewNote(input), "utf8");
  const schedByAge = new Map(input.schedule.map((s) => [s.age, s]));
  input.plans.forEach((plan, i) => {
    const prev = i > 0 ? input.plans[i - 1].age : null;
    const next = i < input.plans.length - 1 ? input.plans[i + 1].age : null;
    writeFileSync(join(dir, `${ageNoteName(plan.age)}.md`), yearNote(plan, schedByAge.get(plan.age), prev, next), "utf8");
  });
  return input.plans.length + 1;
}
