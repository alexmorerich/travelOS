// TREI = Travel Risk / Exposure Index.
//
// Design fixes carried in from the v3.x review cycle:
//   * Every sub-score is normalised to a common 0..10 scale (no raw Math.max
//     across incommensurable units).
//   * Missing inputs take an explicit additive penalty and flag the node
//     PARTIAL — they are never silently treated as "safe".
//   * R_age is guarded against NaN below age 40.
//   * The utility consumer divides by (TREI + eps), never by a bare TREI, so a
//     zero-risk city cannot produce an infinite score.
import { normalization } from "../config";
import { clamp } from "../lib/geo";
import type { ProcessedCity, RawCity, Completeness } from "../types";

function interpPiecewise(points: number[][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

function interpLinear(inRange: [number, number], outRange: [number, number], x: number): number {
  const [a, b] = inRange;
  const [c, d] = outRange;
  return clamp(c + ((x - a) / (b - a)) * (d - c), Math.min(c, d), Math.max(c, d));
}

export function altitudeScore(m: number): number {
  return clamp(interpPiecewise(normalization.curves.altitude_score.points, m), 0, 10);
}

export function climateScore(tempRange: number): number {
  const c = normalization.curves.climate_variance_score;
  return interpLinear(c.in, c.out, tempRange);
}

export function humidityScore(humidity: number): number {
  const c = normalization.curves.humidity_score;
  return clamp(Math.abs(humidity - c.center) / c.scale, 0, c.max);
}

export function medicalRisk(hospitalMinutes: number | null): number {
  if (hospitalMinutes === null) {
    return clamp(10 + normalization.penalties.medical_missing, 0, 10); // missing => max risk
  }
  const c = normalization.curves.medical_risk;
  return interpLinear(c.in, c.out, hospitalMinutes);
}

/** Resolve static (age-independent) env fields + completeness for a raw city. */
export function enrichCity(raw: RawCity): ProcessedCity {
  const missing: string[] = [];
  const w = normalization.env_weights;

  const altOk = raw.altitude_m !== null;
  const climOk = raw.avg_temp_range !== null;
  const humOk = raw.humidity_index !== null;

  const altS = altOk ? altitudeScore(raw.altitude_m as number) : 0;
  const climS = climOk ? climateScore(raw.avg_temp_range as number) : 0;
  const humS = humOk ? humidityScore(raw.humidity_index as number) : 0;

  let env = w.altitude * altS + w.climate * climS + w.humidity * humS;
  if (!altOk || !climOk || !humOk) {
    missing.push("env");
    env += normalization.penalties.env_missing;
  }
  if (raw.tier3_hospital_minutes === null) missing.push("medical");
  if (raw.cultural_value === null) missing.push("culture");

  let completeness: Completeness = "VALID";
  if (raw.lat === null || raw.lng === null) completeness = "INVALID";
  else if (missing.length > 0) completeness = "PARTIAL";

  return {
    ...raw,
    cultural_value: raw.cultural_value ?? normalization.culture_default,
    altitude_score: altS,
    climate_variance_score: climS,
    humidity_score: humS,
    env_risk: clamp(env, 0, 10),
    completeness,
    missing,
  };
}

/** Age physiology factor, bounded and NaN-safe. */
export function rAge(age: number): number {
  if (age <= 40) return 1.0;
  const base = (age - 40) / 40;
  const raw = 1 - Math.pow(base, 1.5);
  return clamp(raw, 0.35, 1.0);
}

/** TREI for a city at a given age. env_risk, medical_risk in [0,10]; R in [0.35,1]. */
export function trei(envRisk: number, medRisk: number, R: number): number {
  return (envRisk * medRisk) / (R * 10);
}
