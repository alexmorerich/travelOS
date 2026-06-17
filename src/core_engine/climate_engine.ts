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

/** Discomfort score (0 = ideal). Comfort band ~15–26°C; cold weighted slightly
 *  heavier than heat. Used to place months in the most comfortable city. */
export function discomfort(tempC: number): number {
  if (tempC < 15) return (15 - tempC) * 0.7;
  if (tempC > 26) return (tempC - 26) * 0.6;
  return 0;
}

export function monthlyDiscomfort(lat: number, altitude: number, month: number): number {
  return discomfort(monthlyTemp(lat, altitude, month));
}
