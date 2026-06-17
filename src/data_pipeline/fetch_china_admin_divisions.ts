// Data pipeline — STEP: fetch administrative divisions (SCALING STUB).
//
// The MVP ships a curated ~100-city anchor file (data/city_anchors.json). To
// scale toward the spec's 300-500 prefecture cities (and ultimately ~2800
// counties), this is where you ingest an authoritative source and emit anchors
// in the same shape the enricher consumes.
//
// Recommended real sources (kept as documentation, not hard dependencies):
//   * National Bureau of Statistics (NBS) division codes  — hierarchy
//   * GADM / GeoNames                                     — lat/lng/centroids
//   * SRTM / open DEM                                     — elevation
//   * Amap (高德) or self-hosted OSRM + tier-3A hospital POIs — hospital travel-time
//
// Output contract: write data/city_anchors.json as
//   { anchors: [{ id, name, name_en, province, lat, lng, altitude_m, tier,
//                 coastal?, remote?, med_access?, culture? }, ...] }
// then run `npm run enrich` to produce data/cities_china.json.
//
// This file intentionally does not call live APIs (keys / rate limits / repo
// reproducibility). It documents the contract and fails loudly if invoked, so
// nobody mistakes the MVP dataset for a completed national ingest.

function main(): void {
  console.log("ℹ fetch_china_admin_divisions is a documented scaling stub.");
  console.log("  The MVP uses curated anchors in data/city_anchors.json (~100 cities).");
  console.log("  Implement ingestion here to scale to 300-500 cities / 2800 counties,");
  console.log("  emit anchors in the documented shape, then run `npm run enrich`.");
  process.exitCode = 0;
}

main();
