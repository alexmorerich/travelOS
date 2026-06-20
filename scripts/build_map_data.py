#!/usr/bin/env python3
"""
build_map_data.py — joins the engine outputs into ONE compact file the map fetches.

Inputs  (repo data, never hand-edited here):
  data/cities_china.json        3,149 enriched county units (coords, cost, climate)
  data/city_anchors.json        same units + tier (1|2|3)
  outputs/schedule.json         the real 30-yr route as time-ordered monthly stops
  outputs/full_30_year_route.json   per-age region label

Output:
  docs/map_data.json   { meta, counties[], trajectory[] }   <- published by Pages

Why a separate fetched file (not inlined / not hardcoded):
  - GitHub Pages serves /docs only, so the map must read data from inside /docs.
  - Keeping data OUT of the HTML means map.html stays small + editable, and the
    "dynamic loading" contract holds: the app renders whatever the API hands it,
    including scenic thumbnails (derived at runtime, never 3,149 hardcoded URLs).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)


def season_of(month):
    # Northern-hemisphere meteorological seasons — matches the timeline palette.
    return {12: "winter", 1: "winter", 2: "winter",
            3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer",
            9: "autumn", 10: "autumn", 11: "autumn"}[month]


def main():
    cities = {c["id"]: c for c in load("data/cities_china.json")["cities"]}
    tier_of = {a["id"]: a.get("tier") for a in load("data/city_anchors.json")["anchors"]}
    schedule = load("outputs/schedule.json")
    region_by_age = {r["age"]: r.get("primary_region", "") for r in load("outputs/full_30_year_route.json")}

    # ---- context layer: every county, minimal fields, coords rounded ----------
    counties = [{
        "id": c["id"],
        "n": c["name_en"],
        "z": c["name"],
        "p": c["province"],
        "t": tier_of.get(c["id"]) or 3,
        "lng": round(c["lng"], 4),
        "lat": round(c["lat"], 4),
    } for c in cities.values()]

    # ---- trajectory: 372 time-ordered monthly stops --------------------------
    trajectory = []
    t = 0
    for blk in schedule:
        age, year = blk["age"], blk["calendar_year"]
        region = region_by_age.get(age, "")
        for m in blk["months"]:
            c = cities[m["city_id"]]
            trajectory.append({
                "t": t,                       # global month index 0..371 (timeline axis)
                "age": age,
                "year": year,
                "month": m["month"],
                "season": season_of(m["month"]),
                "id": m["city_id"],
                "n": c["name_en"],
                "z": c["name"],
                "p": c["province"],
                "lng": round(c["lng"], 4),
                "lat": round(c["lat"], 4),
                "tier": tier_of.get(m["city_id"]) or 3,
                "temp": m.get("temp_c"),
                "night": m.get("night_temp_c"),
                "discomfort": m.get("discomfort"),
                "cost": c.get("monthly_cost_usd"),
                "region": region,
            })
            t += 1

    out = {
        "meta": {
            "generator": "scripts/build_map_data.py",
            "counties": len(counties),
            "trajectory_months": len(trajectory),
            "cities_visited": len({s["id"] for s in trajectory}),
            "age_span": [schedule[0]["age"], schedule[-1]["age"]],
            "year_span": [schedule[0]["calendar_year"], schedule[-1]["calendar_year"]],
        },
        "counties": counties,
        "trajectory": trajectory,
    }

    dst = os.path.join(ROOT, "docs", "map_data.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dst) / 1024
    print(f"wrote docs/map_data.json — {len(counties)} counties, "
          f"{len(trajectory)} monthly stops, {out['meta']['cities_visited']} cities visited "
          f"({kb:.0f} KB)")


if __name__ == "__main__":
    main()
