// Seasonal climate model.
//
// A deterministic monthly-temperature estimate from latitude + altitude, used
// to schedule WHEN to be WHERE within a year (snowbird logic: warm south in
// winter, cooler north/plateau in summer). This is an explicit model, not
// measured normals — tagged as an estimate like every other derived field.
//
//   mean(lat,alt)  = 28 − 0.7·(|lat|−18) − 0.0065·alt        (warm tropics, cold high/north)
//   amplitude(lat) = 6 + 0.45·(|lat|−18)                     (small near equator, large continental)
//   temp(month)    = mean − amplitude·cos(2π·(month−1)/12)   (Jan coldest, Jul warmest, N. hemisphere)
//
// Placement is driven by the OVERNIGHT temperature, not the daily mean: what
// matters for liveability is whether the night is warm enough in winter and
// cool enough in summer. Night ≈ mean − ½·diurnal-range, where the diurnal
// range widens in dry/high/continental air and narrows in humid/coastal air.

export function annualMeanTemp(lat: number, altitude: number): number {
  return 28 - 0.7 * (Math.abs(lat) - 18) - 0.0065 * altitude;
}

export function seasonalAmplitude(lat: number): number {
  return Math.max(3, 6 + 0.45 * (Math.abs(lat) - 18));
}

/** Estimated mean temperature (°C) for a given month (1–12). */
export function monthlyTemp(lat: number, altitude: number, month: number): number {
  const mean = annualMeanTemp(lat, altitude);
  const amp = seasonalAmplitude(lat);
  return mean - amp * Math.cos((2 * Math.PI * (month - 1)) / 12);
}

/** Estimated day↔night temperature spread (°C). Wide in dry/high/continental
 *  air (Tibet, Xinjiang), narrow on humid coasts (Hainan, Fujian). humidity is
 *  annual mean RH %; default 55 when unknown. */
export function diurnalRange(altitude: number, humidity = 55): number {
  let d = 9;
  d -= (humidity - 55) * 0.07; // muggy/coastal air damps the swing
  d += altitude * 0.0016;      // thin dry air at altitude widens it
  return Math.max(4, Math.min(18, d));
}

/** Estimated overnight low (°C) for a given month — the temperature you feel
 *  outdoors at night, which is what comfort below is judged on. */
export function nightTemp(lat: number, altitude: number, month: number, humidity = 55): number {
  return monthlyTemp(lat, altitude, month) - diurnalRange(altitude, humidity) / 2;
}

// Overnight comfort window: nights should be ≥10°C (warm enough to be outdoors
// in the cold season → stay south in winter) and ≤23°C (cool enough to sleep
// in the warm season → flee the heat in summer). Cold weighted a touch heavier
// than heat — chilly nights carry more health risk for 50–80yo.
export const NIGHT_FLOOR_C = 10;
export const NIGHT_CEIL_C = 23;

/** Discomfort score (0 = ideal) from an overnight low temperature. */
export function nightDiscomfort(nightC: number): number {
  if (nightC < NIGHT_FLOOR_C) return (NIGHT_FLOOR_C - nightC) * 0.7;
  if (nightC > NIGHT_CEIL_C) return (nightC - NIGHT_CEIL_C) * 0.6;
  return 0;
}

/** Monthly discomfort, judged on the estimated overnight low (see band above). */
export function monthlyDiscomfort(lat: number, altitude: number, month: number, humidity = 55): number {
  return nightDiscomfort(nightTemp(lat, altitude, month, humidity));
}
