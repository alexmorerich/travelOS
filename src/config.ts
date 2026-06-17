// Loads all config/*.json once, resolved relative to the project root so the
// engine runs the same way regardless of the current working directory.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  SystemConfig,
  NormalizationConfig,
  ThresholdsConfig,
  FinanceConfig,
  RoutingProfilesConfig,
  StrategiesConfig,
} from "./types";

const here = dirname(fileURLToPath(import.meta.url)); // .../src
export const ROOT = join(here, "..");

function load<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8")) as T;
}

export const systemConfig = load<SystemConfig>("config/system_config.json");
export const normalization = load<NormalizationConfig>("config/normalization.json");
export const thresholds = load<ThresholdsConfig>("config/thresholds.json");
export const financeConfig = load<FinanceConfig>("config/finance.json");
export const routingProfiles = load<RoutingProfilesConfig>("config/routing_profiles.json");
export const strategiesConfig = load<StrategiesConfig>("config/strategies.json");
