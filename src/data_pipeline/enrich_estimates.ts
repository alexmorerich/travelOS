// Data pipeline — STEP: estimate enrichment.
//
// Turns real-geo anchors (data/city_anchors.json) into the full dataset
// (data/cities_china.json) by deriving the five estimate fields from
// DOCUMENTED, DETERMINISTIC rules keyed on geography + curated tags. This is
// deliberately rule-based rather than 500 hand-typed numbers: the rules are
// inspectable, uniform, and reproducible, and scaling to 300/2800 cities means
// adding anchors — not fudging cells.
//
// Replace these rules with measured data (hospital travel-time APIs, climate
// normals, cost-of-living indices) to graduate from MVP estimates to real data.
//
// Run: npm run enrich
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config";

interface Anchor {
  id: string; name: string; name_en: string; province: string;
  lat: number; lng: number; altitude_m: number;
  tier: 1 | 2 | 3;
  coastal?: boolean;
  remote?: boolean;
  county?: boolean;
  district?: boolean;
  parent?: string;
  med_access?: "none";
  culture?: number;
}

type ClimateZone =
  | "tropical" | "subtropical_humid" | "subtropical_mild"
  | "temperate_coastal" | "temperate_inland" | "cold_north"
  | "arid_northwest" | "plateau";

// Province -> base climate zone (altitude can override to plateau below).
const PROVINCE_ZONE: Record<string, ClimateZone> = {
  Hainan: "tropical",
  Guangdong: "subtropical_humid", Guangxi: "subtropical_humid", Fujian: "subtropical_humid",
  Zhejiang: "subtropical_humid", Jiangsu: "subtropical_humid", Shanghai: "subtropical_humid",
  Hunan: "subtropical_humid", Hubei: "subtropical_humid", Jiangxi: "subtropical_humid",
  Anhui: "subtropical_humid", Chongqing: "subtropical_humid", Sichuan: "subtropical_humid",
  Yunnan: "subtropical_mild", Guizhou: "subtropical_mild",
  Shandong: "temperate_coastal",
  Beijing: "temperate_inland", Tianjin: "temperate_inland", Hebei: "temperate_inland",
  Henan: "temperate_inland", Shanxi: "temperate_inland", Shaanxi: "temperate_inland",
  Liaoning: "cold_north", Jilin: "cold_north", Heilongjiang: "cold_north",
  "Inner Mongolia": "arid_northwest", Ningxia: "arid_northwest", Gansu: "arid_northwest",
  Xinjiang: "arid_northwest",
  Qinghai: "plateau", Tibet: "plateau",
};

const ZONE_TEMP_RANGE: Record<ClimateZone, number> = {
  tropical: 8, subtropical_humid: 25, subtropical_mild: 14,
  temperate_coastal: 26, temperate_inland: 31, cold_north: 42,
  arid_northwest: 35, plateau: 24,
};
const ZONE_HUMIDITY: Record<ClimateZone, number> = {
  tropical: 82, subtropical_humid: 78, subtropical_mild: 66,
  temperate_coastal: 70, temperate_inland: 58, cold_north: 64,
  arid_northwest: 48, plateau: 50,
};

const TIER_HOSPITAL_MIN: Record<number, number> = { 1: 13, 2: 20, 3: 28 };
const TIER_COST_USD: Record<number, number> = { 1: 3200, 2: 1800, 3: 1300 };
const TIER_CULTURE: Record<number, number> = { 1: 7, 2: 6, 3: 5 };

function zoneOf(a: Anchor): ClimateZone {
  if (a.altitude_m > 2000) return "plateau";
  return PROVINCE_ZONE[a.province] ?? "temperate_inland";
}

function tempRange(a: Anchor, zone: ClimateZone): number {
  let r = ZONE_TEMP_RANGE[zone];
  if (a.coastal) r -= 3; // maritime moderation
  return Math.round(r);
}

function hospitalMinutes(a: Anchor): number | null {
  if (a.med_access === "none") return null; // no tier-3A within range
  // County seats lean on the prefecture city's tier-3A hospital, so access is
  // worse; remote high-altitude county seats can exceed the 2h ceiling (BLOCKED).
  let m = a.county ? 50 : TIER_HOSPITAL_MIN[a.tier];
  if (a.remote) m += a.county ? 50 : 35;
  if (a.altitude_m > 2500) m += 30;
  return Math.min(m, a.county ? 170 : 115);
}

function monthlyCost(a: Anchor, zone: ClimateZone): number {
  let c = TIER_COST_USD[a.tier];
  if (a.county) c -= 200; // smaller rural towns are cheaper to live in
  if (a.coastal) c += 150;
  if (zone === "tropical") c += 200; // Hainan resort premium
  if (a.remote) c -= 150;
  if (a.province === "Tibet" || a.province === "Xinjiang") c += 100; // logistics
  return Math.max(700, Math.round(c / 50) * 50);
}

function enrichOne(a: Anchor) {
  const zone = zoneOf(a);
  return {
    id: a.id, name: a.name, name_en: a.name_en, province: a.province,
    lat: a.lat, lng: a.lng, altitude_m: a.altitude_m,
    tier3_hospital_minutes: hospitalMinutes(a),
    avg_temp_range: tempRange(a, zone),
    humidity_index: ZONE_HUMIDITY[zone],
    monthly_cost_usd: monthlyCost(a, zone),
    cultural_value: a.culture ?? TIER_CULTURE[a.tier],
    county: a.county ?? false,
    ...(a.district ? { district: true, parent: a.parent } : {}),
    source: { geo: "real_approx", estimates: "rule_based:enrich_estimates.ts", climate_zone: zone },
  };
}

function main(): void {
  const anchorsPath = join(ROOT, "data/city_anchors.json");
  const outPath = join(ROOT, "data/cities_china.json");
  const file = JSON.parse(readFileSync(anchorsPath, "utf8")) as { anchors: Anchor[] };

  const cities = file.anchors.map(enrichOne);
  const out = {
    _meta: {
      description: "Travel Life OS dataset — GENERATED by npm run enrich from data/city_anchors.json. Do not hand-edit; edit the anchors instead.",
      geo_source: "lat/lng/altitude_m are real approximate values.",
      estimated_fields: "tier3_hospital_minutes, avg_temp_range, humidity_index, monthly_cost_usd, cultural_value are rule-based estimates (src/data_pipeline/enrich_estimates.ts).",
      count: cities.length,
    },
    cities,
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  const partial = cities.filter((c) => c.tier3_hospital_minutes === null).length;
  console.log(`✔ enriched ${cities.length} cities -> data/cities_china.json`);
  console.log(`  ${partial} node(s) without tier-3A access (PARTIAL/BLOCKED), cost range $${Math.min(...cities.map((c) => c.monthly_cost_usd))}-$${Math.max(...cities.map((c) => c.monthly_cost_usd))}/mo`);
}

main();
