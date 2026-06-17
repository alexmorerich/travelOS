// Data pipeline — STEP: fetch administrative divisions.
//
// The real ingest is implemented in `scripts/build_anchors_from_geonames.py`
// (run via `npm run anchors`). It downloads the GeoNames China dump, filters to
// administrative seats (PPLC/PPLA = capitals, PPLA2 = prefecture seats), and
// emits data/city_anchors.json with REAL lat/lng/elevation + tier/coastal/remote
// tags — ~284 prefecture-level cities across all 31 mainland provinces.
//
// Anchor contract consumed by the enricher (`npm run enrich`):
//   { anchors: [{ id, name, name_en, province, lat, lng, altitude_m, tier,
//                 coastal?, remote?, med_access?, culture? }, ...] }
//
// Sources / next steps to graduate further:
//   * GeoNames (CC BY)                 — lat/lng/elevation  [USED]
//   * National Bureau of Statistics    — full hierarchy down to ~2800 counties
//   * Amap (高德) / self-hosted OSRM    — measured tier-3A hospital travel-time
//
// This TS entry documents the contract and points at the runnable ingest; the
// Python script is the reproducible implementation (no Node native unzip dep).

function main(): void {
  console.log("ℹ Admin-division ingest is implemented in Python for reproducibility.");
  console.log("  Run:  npm run anchors   (scripts/build_anchors_from_geonames.py)");
  console.log("  Then: npm run enrich    -> data/cities_china.json");
  console.log("  Current dataset: ~284 prefecture-level cities from GeoNames.");
  process.exitCode = 0;
}

main();
