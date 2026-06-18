// Time layer — converts each yearly plan into a month-by-month residence
// calendar using the seasonal climate model, then rolls up to quarters and
// exports an importable .ics.
//
// Day counts come straight from the routing plan (so cost stays identical to
// the finance model); the scheduler only decides WHICH months each city gets,
// minimizing seasonal discomfort. The result is a natural snowbird pattern:
// warm-south months land in winter, cool-north/plateau months in summer.
import { systemConfig, ageBands } from "../config";
import { monthlyTemp, monthlyDiscomfort, nightTemp } from "../core_engine/climate_engine";
import type { ProcessedCity, YearPlan, ScheduleYear, ScheduleMonth, ScheduleBlock, ScheduleQuarter } from "../types";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Months-per-city quota from the plan's day allocation, forced to sum to 12. */
function quotas(plan: YearPlan): number[] {
  const q = plan.cities.map((c) => Math.max(1, Math.round(c.days / 30.44)));
  let total = q.reduce((a, b) => a + b, 0);
  while (total !== 12 && q.length > 0) {
    const i = total > 12 ? q.indexOf(Math.max(...q)) : q.indexOf(Math.min(...q));
    q[i] += total > 12 ? -1 : 1;
    if (q[i] < 1) q[i] = 1;
    total = q.reduce((a, b) => a + b, 0);
    if (q.every((x) => x === 1) && total < 12) { q[0] += 12 - total; break; }
  }
  return q;
}

function assignMonths(plan: YearPlan, byId: Map<string, ProcessedCity>): ScheduleMonth[] {
  const chosen = plan.cities;
  if (chosen.length === 0) return [];
  const quota = quotas(plan);

  const dis = (ci: number, m: number): number => {
    const c = byId.get(chosen[ci].id);
    return c ? monthlyDiscomfort(c.lat, c.altitude_m ?? 0, m, c.humidity_index ?? 55) : 5;
  };

  // Assign months by REGRET (gap between the best and 2nd-best city) high→low, so
  // a month that strongly needs one specific city claims it before quotas fill.
  // Deep winter has huge regret (the warm-south refuge scores ~0 vs −15°C frontier
  // nights) so Dec–Feb grab the refuge first; peak summer grabs the cool plateau;
  // low-regret shoulder months fill whatever remains. This is what pins the
  // snowbird retreat to the actual cold months instead of spending it on shoulders.
  const regret = (m: number): number => {
    const ds = chosen.map((_, ci) => dis(ci, m)).sort((x, y) => x - y);
    return (ds[1] ?? ds[0]) - ds[0];
  };
  const monthOrder = Array.from({ length: 12 }, (_, k) => k + 1).sort((a, b) => regret(b) - regret(a));

  const remaining = [...quota];
  const monthCity = new Array(13).fill(-1);
  for (const m of monthOrder) {
    let bestCi = -1, bestD = Infinity;
    for (let ci = 0; ci < chosen.length; ci++) {
      if (remaining[ci] <= 0) continue;
      const d = dis(ci, m);
      if (d < bestD) { bestD = d; bestCi = ci; }
    }
    if (bestCi < 0) {
      for (let ci = 0; ci < chosen.length; ci++) {
        const d = dis(ci, m);
        if (d < bestD) { bestD = d; bestCi = ci; }
      }
    }
    monthCity[m] = bestCi;
    if (remaining[bestCi] > 0) remaining[bestCi]--;
  }

  const months: ScheduleMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const ci = monthCity[m] >= 0 ? monthCity[m] : 0;
    const planCity = chosen[ci];
    const c = byId.get(planCity.id);
    const hum = c?.humidity_index ?? 55;
    months.push({
      month: m,
      city_id: planCity.id,
      name_en: planCity.name_en,
      name: planCity.name,
      temp_c: c ? Math.round(monthlyTemp(c.lat, c.altitude_m ?? 0, m) * 10) / 10 : 20,
      night_temp_c: c ? Math.round(nightTemp(c.lat, c.altitude_m ?? 0, m, hum) * 10) / 10 : 12,
      discomfort: c ? Math.round(monthlyDiscomfort(c.lat, c.altitude_m ?? 0, m, hum) * 10) / 10 : 0,
    });
  }
  return months;
}

function toBlocks(months: ScheduleMonth[], year: number, byId: Map<string, ProcessedCity>): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  let i = 0;
  while (i < months.length) {
    let j = i;
    while (j + 1 < months.length && months[j + 1].city_id === months[i].city_id) j++;
    const from = months[i].month, to = months[j].month;
    const c = byId.get(months[i].city_id);
    const span = months.slice(i, j + 1);
    blocks.push({
      from_month: from,
      to_month: to,
      city_id: months[i].city_id,
      name_en: months[i].name_en,
      name: months[i].name,
      province: c?.province ?? "",
      days: (to - from + 1) * 30,
      move_in: `${year}-${pad(from)}-01`,
      avg_temp_c: Math.round((span.reduce((s, m) => s + m.temp_c, 0) / span.length) * 10) / 10,
      avg_night_c: Math.round((span.reduce((s, m) => s + m.night_temp_c, 0) / span.length) * 10) / 10,
    });
    i = j + 1;
  }
  return blocks;
}

function toQuarters(months: ScheduleMonth[]): ScheduleQuarter[] {
  const out: ScheduleQuarter[] = [];
  for (let q = 1; q <= 4; q++) {
    const slice = months.slice((q - 1) * 3, q * 3);
    const counts = new Map<string, number>();
    for (const m of slice) counts.set(m.city_id, (counts.get(m.city_id) ?? 0) + 1);
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const pick = slice.find((m) => m.city_id === dominant)!;
    const avg = Math.round((slice.reduce((s, m) => s + m.temp_c, 0) / slice.length) * 10) / 10;
    const [lo, hi] = ageBands.comfort_celsius;
    out.push({
      quarter: q,
      city_id: dominant,
      name_en: pick.name_en,
      avg_temp_c: avg,
      comfort_ok: avg >= lo && avg <= hi,
    });
  }
  return out;
}

export function buildSchedule(plans: YearPlan[], cities: ProcessedCity[]): ScheduleYear[] {
  const byId = new Map(cities.map((c) => [c.id, c]));
  return plans.map((plan) => {
    const calendar_year = systemConfig.base_calendar_year + (plan.age - systemConfig.age_start);
    const months = assignMonths(plan, byId);
    return {
      age: plan.age,
      calendar_year,
      months,
      blocks: toBlocks(months, calendar_year, byId),
      quarters: toQuarters(months),
    };
  });
}

/** Build an importable .ics calendar: one all-day multi-day event per stay. */
export function toICS(schedule: ScheduleYear[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travel Life OS//v4.1//EN", "CALSCALE:GREGORIAN"];
  for (const yr of schedule) {
    for (const b of yr.blocks) {
      const startY = yr.calendar_year;
      const endMonth = b.to_month < 12 ? b.to_month + 1 : 1;
      const endY = b.to_month < 12 ? startY : startY + 1;
      const dtStart = `${startY}${pad(b.from_month)}01`;
      const dtEnd = `${endY}${pad(endMonth)}01`; // DTEND is exclusive
      lines.push(
        "BEGIN:VEVENT",
        `UID:travelos-${yr.age}-${b.from_month}-${b.city_id}@travelos`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:Age ${yr.age} · ${b.name_en} (${b.name}) ${MONTH_NAMES[b.from_month]}–${MONTH_NAMES[b.to_month]}`,
        `DESCRIPTION:${b.province} · ~${b.avg_temp_c}°C avg · nights ~${b.avg_night_c}°C`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
