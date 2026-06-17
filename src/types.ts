// ---------------------------------------------------------------------------
// Shared types for Travel Life OS v4.0
// ---------------------------------------------------------------------------

export type Completeness = "VALID" | "PARTIAL" | "INVALID";
export type Decision = "ALLOWED" | "LOW_PRIORITY" | "BLOCKED";
export type EdgeMethod = "great_circle" | "road_api" | "estimated";

/** A city exactly as stored on disk in data/cities_china.json. */
export interface RawCity {
  id: string;
  name: string;        // 中文名
  name_en: string;
  province: string;
  lat: number;
  lng: number;
  altitude_m: number | null;
  tier3_hospital_minutes: number | null;
  avg_temp_range: number | null;   // annual temperature range, deg C
  humidity_index: number | null;   // annual mean relative humidity, %
  monthly_cost_usd: number | null;
  cultural_value: number | null;   // 0..10
  source?: Record<string, string>;
}

/** A city after enrichment: static (age-independent) risk fields are resolved. */
export interface ProcessedCity extends RawCity {
  cultural_value: number;          // null defaulted to config.culture_default
  altitude_score: number;
  climate_variance_score: number;
  humidity_score: number;
  env_risk: number;                // 0..10
  completeness: Completeness;
  missing: string[];
}

export interface EdgeInfo {
  distance_km: number;
  travel_time_hours: number;
  cost_index: number;              // USD proxy for one intercity hop
  method: EdgeMethod;
}

export interface Edge extends EdgeInfo {
  from: string;
  to: string;
}

export interface Graph {
  /** adj.get(fromId)!.get(toId) -> edge info, for nodes within radius_km. */
  adj: Map<string, Map<string, EdgeInfo>>;
  edges: Edge[];
}

/** Per-city slice of a yearly plan. */
export interface YearPlanCity {
  id: string;
  name: string;
  name_en: string;
  province: string;
  days: number;
  monthly_cost_usd: number;
  env_risk: number;
  medical_risk: number;
  TREI: number;
  utility: number;
  decision: Decision;
}

export interface YearPlan {
  age: number;
  seed: number;
  R_age: number;
  trei_cutoff: number;
  start_city: string;
  cities: YearPlanCity[];
  annual_cost_usd: number;
  total_days: number;
  provinces_visited: string[];
}

export interface RegionPhase {
  age: number;
  primary_region: string;
  cities: string[];
  annual_cost_usd: number;
}

export interface TrajectoryPoint {
  age: number;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

export interface FinanceResult {
  initial_portfolio_usd: number;
  n_paths: number;
  survival_probability: number;
  median_bankruptcy_age: number | null;
  p10_terminal: number;
  p50_terminal: number;
  p90_terminal: number;
  mean_annual_cost_usd: number;
  effective_withdrawal_rate: number;
  trajectories: TrajectoryPoint[];
  bankruptcy_ages: number[];
}

// ---- config shapes -------------------------------------------------------

export interface SystemConfig {
  seed: number;
  age_start: number;
  age_end: number;
  base_city: string;
  radius_km: number;
  max_cities_per_year: number;
  visited_window_years: number;
  days_per_year: number;
  routing: {
    tie_break_band: number;
    utility_eps: number;
    cost_weight: number;
    travel_weight: number;
  };
  risk_heatmap_ages: number[];
}

export interface NormalizationConfig {
  env_weights: { altitude: number; climate: number; humidity: number };
  curves: {
    altitude_score: { type: "piecewise"; points: number[][] };
    climate_variance_score: { type: "linear"; in: [number, number]; out: [number, number] };
    humidity_score: { type: "abs_distance"; center: number; scale: number; max: number };
    medical_risk: { type: "linear"; in: [number, number]; out: [number, number] };
  };
  penalties: { env_missing: number; medical_missing: number };
  culture_default: number;
}

export interface ThresholdsConfig {
  trei_percentile_cutoff: number;
  max_hospital_minutes: number;
  elderly_age: number;
  elderly_max_altitude_m: number;
  validation: { max_missing_geo_fraction: number; fail_on_geo_gap: boolean };
}

export interface FinanceConfig {
  initial_portfolio_usd: number;
  n_paths: number;
  mean_real_return: number;
  sd_real_return: number;
  recession_probability: number;
  recession_mean_return: number;
  recession_sd_return: number;
}
