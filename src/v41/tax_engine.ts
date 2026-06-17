// v4.1 — cross-border tax / custody drag.
//
// A simplified annual drag subtracted from the real return. Offshore (HK/SG)
// custody carries less friction than onshore for this profile. Deliberately
// light — the dominant v4.1 levers are housing and healthcare, not tax.
import { strategiesConfig } from "../config";

export function jurisdictionDrag(jurisdiction: "onshore" | "offshore"): number {
  return jurisdiction === "offshore"
    ? strategiesConfig.tax.offshore_return_drag
    : strategiesConfig.tax.onshore_return_drag;
}
