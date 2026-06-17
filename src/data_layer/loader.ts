import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config";
import { enrichCity } from "../core_engine/trei_engine";
import type { RawCity, ProcessedCity } from "../types";

interface CitiesFile {
  _meta?: Record<string, unknown>;
  cities: RawCity[];
}

/** Load the MVP dataset and resolve static risk fields for every node. */
export function loadCities(): ProcessedCity[] {
  const path = join(ROOT, "data/cities_china.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as CitiesFile;
  return file.cities.map(enrichCity);
}
