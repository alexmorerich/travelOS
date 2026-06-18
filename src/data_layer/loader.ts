import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config";
import { enrichCity } from "../core_engine/trei_engine";
import type { RawCity, ProcessedCity } from "../types";

interface CitiesFile {
  _meta?: Record<string, unknown>;
  cities: RawCity[];
}

/** Every administrative unit on disk, enriched — including 市辖区 districts.
 *  Use this for counts/DB/reporting where the full county-level total matters. */
export function loadAllCities(): ProcessedCity[] {
  const path = join(ROOT, "data/cities_china.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as CitiesFile;
  return file.cities.map(enrichCity);
}

/** The cities the engine routes/schedules over: distinct locations only.
 *  市辖区 districts are co-located with their parent prefecture, so they collapse
 *  out here (kept in the dataset for the count, excluded from graph/routing). */
export function loadCities(): ProcessedCity[] {
  return loadAllCities().filter((c) => !c.district);
}
