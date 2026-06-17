import { thresholds } from "../config";
import type { ProcessedCity } from "../types";

export interface ValidationReport {
  total_nodes: number;
  valid: number;
  partial: number;
  invalid: number;
  missing_geo: number;
  missing_geo_fraction: number;
  missing_medical: number;
  invalid_nodes: { id: string; name_en: string; completeness: string; missing: string[] }[];
  warnings: string[];
  passed: boolean;
}

/** Validate the dataset. Geo gaps are reported (and optionally fatal); other
 *  gaps downgrade a node to PARTIAL rather than killing the run. */
export function validateDataset(cities: ProcessedCity[]): ValidationReport {
  const total = cities.length;
  const missingGeo = cities.filter((c) => c.lat === null || c.lng === null).length;
  const missingGeoFrac = total === 0 ? 1 : missingGeo / total;
  const warnings: string[] = [];

  const report: ValidationReport = {
    total_nodes: total,
    valid: cities.filter((c) => c.completeness === "VALID").length,
    partial: cities.filter((c) => c.completeness === "PARTIAL").length,
    invalid: cities.filter((c) => c.completeness === "INVALID").length,
    missing_geo: missingGeo,
    missing_geo_fraction: Number(missingGeoFrac.toFixed(4)),
    missing_medical: cities.filter((c) => c.tier3_hospital_minutes === null).length,
    invalid_nodes: cities
      .filter((c) => c.completeness !== "VALID")
      .map((c) => ({
        id: c.id,
        name_en: c.name_en,
        completeness: c.completeness,
        missing: c.missing,
      })),
    warnings,
    passed: true,
  };

  if (missingGeoFrac > thresholds.validation.max_missing_geo_fraction) {
    const msg = `geo data missing for ${(missingGeoFrac * 100).toFixed(1)}% of nodes (limit ${(thresholds.validation.max_missing_geo_fraction * 100).toFixed(0)}%)`;
    warnings.push(msg);
    if (thresholds.validation.fail_on_geo_gap) report.passed = false;
  }
  if (report.partial > 0) {
    warnings.push(`${report.partial} node(s) PARTIAL (penalised, not optimistic).`);
  }

  return report;
}
