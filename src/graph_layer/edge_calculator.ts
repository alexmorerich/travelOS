import { haversineKm } from "../lib/geo";
import type { ProcessedCity, EdgeInfo } from "../types";

// Door-to-door effective speed (km/h) blending high-speed rail / flight / road.
// This is an explicit approximation — edges are tagged "great_circle" so no
// consumer mistakes them for measured road-network times.
const EFFECTIVE_SPEED_KMH = 220;
const FIXED_OVERHEAD_HOURS = 1.5; // stations, transfers, last-mile
const USD_PER_KM = 0.08;

export function computeEdge(a: ProcessedCity, b: ProcessedCity): EdgeInfo {
  const distance = haversineKm(a.lat, a.lng, b.lat, b.lng);
  return {
    distance_km: Math.round(distance),
    travel_time_hours: Number((distance / EFFECTIVE_SPEED_KMH + FIXED_OVERHEAD_HOURS).toFixed(2)),
    cost_index: Math.round(distance * USD_PER_KM),
    method: "great_circle",
  };
}
