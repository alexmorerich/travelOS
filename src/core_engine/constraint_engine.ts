// Hybrid feasibility gate.
//
//   1. HARD absolute ceilings (safety floor that a percentile cut alone cannot
//      provide): no tier-3A hospital within 2h => BLOCKED; high altitude for an
//      elderly traveller => BLOCKED; unknown hospital access => BLOCKED (we do
//      not gamble on missing safety data).
//   2. RELATIVE percentile cut: within the still-feasible set, the riskiest
//      tail (above the configured TREI percentile) is demoted to LOW_PRIORITY
//      rather than deleted — this keeps geographic coverage from collapsing.
import { thresholds } from "../config";
import type { ProcessedCity, Decision } from "../types";

/** True if the city violates a hard absolute safety ceiling at this age. */
export function isHardBlocked(city: ProcessedCity, age: number): boolean {
  const hosp = city.tier3_hospital_minutes;
  if (hosp === null || hosp > thresholds.max_hospital_minutes) return true;
  if (age > thresholds.elderly_age) {
    // unknown altitude for an elderly traveller is treated as unsafe, not safe
    const alt = city.altitude_m ?? Number.POSITIVE_INFINITY;
    if (alt > thresholds.elderly_max_altitude_m) return true;
  }
  return false;
}

export function decide(hardBlocked: boolean, treiValue: number, cutoff: number): Decision {
  if (hardBlocked) return "BLOCKED";
  if (treiValue > cutoff) return "LOW_PRIORITY";
  return "ALLOWED";
}
