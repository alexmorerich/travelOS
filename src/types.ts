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
  county?: boolean;                // county seat (vs prefecture/provincial seat)
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
  band: string;            // lifecycle phase label (Expedition / Cultural / Comfort)
  trei_cutoff: number;
  start_city: string;
  cities: YearPlanCity[];
  annual_cost_usd: number;
  total_days: number;
  provinces_visited: string[];
  frontier_share: number;  // fraction of days in frontier provinces this year
}

export interface RegionPhase {
  age: number;
  primary_region: string;
  cities: string[];
  annual_cost_usd: number;
}

// ---- monthly / quarterly schedule (time layer) ---------------------------

export interface ScheduleMonth {
  month: number;          // 1–12
  city_id: string;
  name_en: string;
  name: string;
  temp_c: number;         // estimated mean temp that month
  discomfort: number;
}

export interface ScheduleBlock {
  from_month: number;
  to_month: number;
  city_id: string;
  name_en: string;
  name: string;
  province: string;
  days: number;
  move_in: string;        // YYYY-MM-DD
  avg_temp_c: number;
}

export interface ScheduleQuarter {
  quarter: number;        // 1–4
  city_id: string;
  name_en: string;
  avg_temp_c: number;
  comfort_ok: boolean;    // quarterly "entropy audit": avg temp within comfort band
}

export interface ScheduleYear {
  age: number;
  calendar_year: number;
  months: ScheduleMonth[];
  blocks: ScheduleBlock[];
  quarters: ScheduleQuarter[];
}

export interface TrajectoryPoint {
  age: number;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

export interface FinanceResult {
  label?: string;
  initial_portfolio_usd: number;
  n_paths: number;
  survival_probability: number;
  median_bankruptcy_age: number | null;
  p10_terminal: number;
  p50_terminal: number;
  p90_terminal: number;
  median_terminal_net_worth: number;   // liquid + illiquid (property) at end
  mean_annual_cost_usd: number;
  effective_withdrawal_rate: number;
  trajectories: TrajectoryPoint[];
  bankruptcy_ages: number[];
}

// ---- routing profiles (Task 1: cost-minimizing mode) ---------------------

export interface RoutingWeights {
  tie_break_band: number;
  utility_eps: number;
  cost_weight: number;
  travel_weight: number;
  culture_pursuit: number;   // multiplier on the culture/(TREI+eps) term
}

export interface RoutingProfile {
  key: string;
  label: string;
  weights: RoutingWeights;
}

export interface ScenarioResult {
  key: string;
  label: string;
  survival_probability: number;
  median_bankruptcy_age: number | null;
  mean_annual_cost_usd: number;
  effective_withdrawal_rate: number;
  median_terminal_net_worth: number;
  sample_itinerary_age65: string[];
}

// ---- v4.1 strategies (housing + healthcare + tax coupling) ---------------

export interface StrategyConfig {
  key: string;
  label: string;
  routing: string;                 // routing profile key
  buy: boolean;
  settle_city?: string;            // required if buy
  buy_age?: number;                // required if buy
  jurisdiction: "onshore" | "offshore";
  insurance: boolean;              // dampens healthcare tail
}

export interface StrategyResult extends ScenarioResult {
  buy: boolean;
  settle_city: string | null;
  jurisdiction: string;
  property_price_usd: number;
}

// ---- config shapes -------------------------------------------------------

export interface SystemConfig {
  seed: number;
  age_start: number;
  age_end: number;
  base_calendar_year: number;
  base_city: string;
  radius_km: number;
  max_neighbors: number;
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

export interface RoutingProfilesConfig {
  primary: string;
  profiles: RoutingProfile[];
}

// ---- 30-year lifecycle matrix (age-band zone targeting) ------------------

export interface AgeBand {
  key: string;
  label: string;
  age_from: number;
  age_to: number;
  target_provinces: string[];   // zones favoured during this band
  zone_bonus: number;           // utility bonus for being in a target province
  comfort_bonus: number;        // weight on 18–25°C climate fit (grows with age)
  hospital_bonus: number;       // weight on tier-3A hospital access (grows with age)
  frontier_share_target: number;// intended share of frontier-province time (reporting)
  explore: boolean;             // true => prefer never-visited cities (broad coverage); false => allow settling
}

export interface AgeBandsConfig {
  comfort_celsius: [number, number];
  frontier_provinces: string[];
  bands: AgeBand[];
}

export interface HousingParams {
  rent_fraction: number;
  price_to_annual_rent: number;
  ownership_cost_rate: number;
  appreciation_real: number;
}

export interface HealthcareParams {
  base_oop_usd: number;
  growth: number;
  tail_prob_base: number;
  tail_prob_slope: number;
  tail_min_usd: number;
  tail_max_usd: number;
  insurance_tail_factor: number;
  insurance_premium_usd: number;
}

export interface TaxParams {
  onshore_return_drag: number;
  offshore_return_drag: number;
}

export interface StrategiesConfig {
  housing: HousingParams;
  healthcare: HealthcareParams;
  tax: TaxParams;
  strategies: StrategyConfig[];
}
