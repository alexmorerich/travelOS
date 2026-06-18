# 📘 Travel Life OS — Operator & Developer Manual

The complete reference for running, configuring, extending, and reading every part of Travel Life OS v4.1.

> **Relationship to the [README](README.md):** the README is the *what & why* (concepts, headline results, the thesis). This manual is the *how, exactly* — every command, every config field, the data schemas, the module-level API, the outputs, and a full manual for the interactive **Life Timeline** UI. If you want to *change* something, this is the document.

> Travel Life OS is a **planning model, not financial advice.** Non-geographic fields are rule-based estimates (see [§16 Data honesty](#16-data-honesty--disclaimer)).

---

## Table of contents

1. [System requirements & install](#1-system-requirements--install)
2. [Command reference](#2-command-reference)
3. [End-to-end workflow](#3-end-to-end-workflow)
4. [Repository layout](#4-repository-layout)
5. [Configuration reference](#5-configuration-reference)
6. [Data model reference](#6-data-model-reference)
7. [Engine — module-by-module API](#7-engine--module-by-module-api)
8. [Formula quick-reference](#8-formula-quick-reference)
9. [Outputs reference](#9-outputs-reference)
10. [The Life Timeline UI](#10-the-life-timeline-ui)
11. [Database (SQLite / D1)](#11-database-sqlite--d1)
12. [Determinism & reproducibility](#12-determinism--reproducibility)
13. [Recipes (common tasks)](#13-recipes-common-tasks)
14. [Troubleshooting](#14-troubleshooting)
15. [Glossary](#15-glossary)
16. [Data honesty & disclaimer](#16-data-honesty--disclaimer)

---

## 1. System requirements & install

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** | Core engine. Uses ESM (`"type": "module"`). |
| **npm** | Ships with Node. |
| **python3 + network** | Only for `npm run anchors` (the GeoNames ingest). The committed dataset already contains its output, so this is optional. |
| **better-sqlite3** (optional) | Only for `npm run db`. Listed under `optionalDependencies`; the core sim has **no native dependencies**. |

```bash
git clone https://github.com/alexmorerich/travelOS && cd travelOS
npm install
npm run simulate      # the committed dataset is enough — go straight to a run
```

There is **no build step** and **no server**. TypeScript is executed directly with `tsx`. Outputs are static files you open from disk.

---

## 2. Command reference

All commands are npm scripts defined in `package.json`.

| Command | What it does | Prereqs | Produces |
|---|---|---|---|
| `npm run simulate` | **The main pipeline.** Load → validate → graph → risk → 30-year routing → Monte Carlo → scenarios → strategies → schedule → dashboards → Obsidian. | `data/cities_china.json` present (committed) | everything in `outputs/` + `docs/` |
| `npm start` | Alias of `simulate`. | — | — |
| `npm run anchors` | Ingest GeoNames → `data/city_anchors.json` (3,149 units: 2,348 cities + 801 districts). | python3 + network | `data/city_anchors.json` |
| `npm run enrich` | Apply rule-based estimates → `data/cities_china.json`. | `data/city_anchors.json` | `data/cities_china.json` |
| `npm run db` | Build a D1-compatible SQLite file from the JSON outputs. | `outputs/*.json` + `better-sqlite3` | `outputs/travel_os.db` |
| `npm run typecheck` | `tsc --noEmit` — type-check the whole project. | — | (none; CI gate) |
| `npm run clean` | Remove generated `outputs/*` (JSON, dashboard, obsidian, db). | — | — |

**Full rebuild from scratch** (regenerate the dataset too):

```bash
npm run anchors && npm run enrich && npm run simulate
```

Runtime: `simulate` completes in **< 3 s** on the committed 3,149-unit dataset (2,000 Monte Carlo paths). Everything is deterministic — same `(dataset, seed)` reproduces bit-for-bit.

---

## 3. End-to-end workflow

```
GeoNames ─▶ anchors ─▶ enrich ─▶ load ─▶ validate ─▶ weighted graph ─▶ TREI risk
   ─▶ routing walk (age 50→80) ─┬─▶ primary plan + dashboard + Obsidian + timeline
                                ├─▶ routing-profile comparison (the "routing lever")
                                ├─▶ v4.1 coupled strategy selector (housing+healthcare+tax)
                                └─▶ time layer: monthly schedule + quarters + .ics
   ─▶ Monte Carlo drawdown ─▶ survival probability
```

The orchestrator is [`src/index.ts`](src/index.ts) — read it top-to-bottom and the whole system is legible in ~160 lines. Each numbered step there maps to a module in [§7](#7-engine--module-by-module-api).

**To make a run about *you*:** edit a value in `config/`, then `npm run simulate`. The most common edits are in [§13 Recipes](#13-recipes-common-tasks).

---

## 4. Repository layout

```
travelOS/
├── config/                     # ALL tunables — JSON, no code (see §5)
├── data/
│   ├── city_anchors.json       # 3,149 units: REAL geo + tags (from GeoNames). Source of truth.
│   └── cities_china.json       # GENERATED by `npm run enrich` (anchors + estimates).
├── scripts/
│   └── build_anchors_from_geonames.py   # the admin-division ingest (npm run anchors)
├── database/schema.sql         # D1-compatible relational schema (see §11)
├── docs/                       # GitHub Pages site (index.html → timeline.html, dashboard.html)
├── outputs/                    # generated artifacts (see §9); safe to `npm run clean`
├── src/
│   ├── config.ts               # loads every config/*.json into typed singletons
│   ├── types.ts                # all shared TypeScript types
│   ├── index.ts                # pipeline entrypoint
│   ├── data_layer/             # loader, validate
│   ├── data_pipeline/          # enrich_estimates, fetch_china_admin_divisions
│   ├── graph_layer/            # edge_calculator, city_graph_builder
│   ├── core_engine/            # trei, constraint, routing, lifecycle, climate, finance
│   ├── simulation_engine/      # scenario_runner, monthly_scheduler
│   ├── v41/                    # housing, healthcare, tax, strategy
│   ├── dashboard/              # visualization_generator, timeline_generator, obsidian_exporter
│   ├── lib/                    # rng (seeded), geo (haversine, percentile, clamp)
│   └── scripts/build_db.ts     # JSON → SQLite
└── package.json
```

---

## 5. Configuration reference

Every behavior knob is a JSON value under `config/`. No tuning lives in code. Each file has a `_comment`/`_doc` describing intent; this section is the field-by-field spec. After any edit, re-run `npm run simulate`.

### 5.1 `system_config.json` — the person & the run

| Field | Default | Type | Effect |
|---|---|---|---|
| `seed` | `12345` | int | Master RNG seed. Changing it changes every Monte Carlo draw (and any seeded routing tie-break). |
| `age_start` | `50` | int | First simulated age. |
| `age_end` | `80` | int | Last simulated age (inclusive). 50→80 = 31 years = 372 months. |
| `base_calendar_year` | `2026` | int | Calendar year mapped to `age_start`. |
| `base_city` | `"CN-GD-SHENZHEN"` | city id | Where the route walk begins (age 50, month 0). |
| `radius_km` | `1500` | number | Max edge length when building the city graph. |
| `max_neighbors` | `40` | int | k-nearest cap per node — keeps the graph ~tens of thousands of edges even at thousands of nodes. |
| `max_cities_per_year` | `4` | int | Ceiling on cities visited in a year (actual count = `round(4·R_age)`, so it falls with age). |
| `visited_window_years` | `3` | int | "Recently visited" memory window used by non-explore (settling) routing to avoid immediate re-visits. |
| `days_per_year` | `365` | int | Days distributed across the year's cities (drives cost). |
| `winter_refuge_share` | `0.25` | 0–1 | Fraction of the year reserved for a warm-south wintering base (snowbird graft). |
| `summer_refuge_share` | `0.25` | 0–1 | Fraction reserved for a cool-highland summering base. |
| `routing.tie_break_band` | `0.05` | number | Utility band within which a deterministic tie-break applies. |
| `routing.utility_eps` | `0.5` | number | `eps` in the utility denominator `culture/(TREI+eps)` — guards divide-by-zero & damps low-TREI blow-ups. |
| `routing.cost_weight` | `0.8` | number | Default cost penalty (overridden per routing profile). |
| `routing.travel_weight` | `0.4` | number | Default travel-distance penalty (overridden per profile). |
| `risk_heatmap_ages` | `[50,60,70,78]` | int[] | Ages at which `risk_heatmap.json` is sampled; the middle one seeds the dashboard's TREI histogram. |

### 5.2 `age_bands.json` — the 30-year lifecycle matrix

Top-level:

| Field | Default | Effect |
|---|---|---|
| `comfort_celsius` | `[18, 25]` | The day-temperature comfort window used for the `comfort_bonus` fit. |
| `frontier_provinces` | 7 provinces | Provinces counted in the reported "frontier share." |
| `bands` | 3 bands | The age-band matrix (below). |

Each entry in `bands[]`:

| Field | Type | Effect |
|---|---|---|
| `key` / `label` | string | Identifier / display name (e.g. `expedition` / "Expedition"). |
| `age_from` / `age_to` | int | Inclusive age span the band governs. |
| `target_provinces` | string[] | Provinces that receive `zone_bonus` utility during the band. |
| `zone_bonus` | number | Utility added for being in a target province. |
| `comfort_bonus` | number | Weight on the 18–25°C climate fit. **Rises with age** (0 → 1 → 3.5). |
| `hospital_bonus` | number | Weight on tier-3A hospital access. **Rises with age** (0 → 1.5 → 3.5). |
| `frontier_share_target` | 0–1 | Intended frontier share — **reported, not hard-enforced**. |
| `explore` | bool | `true` → prefer never-visited cities (broad coverage); `false` → allow settling (comfort band). |

Defaults: **Expedition** (50–60, frontier, explore), **Cultural deep-dive** (61–70, interior, explore), **Climate & comfort** (71–80, coastal-south, settle).

### 5.3 `routing_profiles.json` — the routing lever

`primary` selects which profile drives the main plan (default `"experience"`). Each profile's `weights` plug into the utility function:

```
utility = culture_pursuit·culture/(TREI+eps) − cost_weight·(monthly_cost/1000) − travel_weight·(dist/1000)
```

| Profile | `cost_weight` | `culture_pursuit` | Character |
|---|---:|---:|---|
| `experience` | 0.8 | 1.0 | Pays for novelty. Default primary. |
| `balanced` | 2.5 | 1.0 | Middle ground. |
| `frugal` | 7.0 | 0.25 | Cost-minimized — same safety gates, just stops paying for experience. The survival-dominating lever. |

All three share `tie_break_band 0.05`, `utility_eps 0.5`, `travel_weight 0.4–0.6`.

### 5.4 `strategies.json` — v4.1 coupled selector

Three parameter blocks + a strategy list. The selector runs the **full Monte Carlo per strategy** and ranks by survival of liquid capital.

**`housing`** — `property_price ≈ monthly_cost · rent_fraction · 12 · price_to_annual_rent`. After buying, rent is removed and replaced by `ownership_cost_rate · price`. The home is illiquid: counted in terminal net worth, **not** in liquid survival.

| Field | Default |
|---|---|
| `rent_fraction` | `0.35` |
| `price_to_annual_rent` | `30` |
| `ownership_cost_rate` | `0.012` |
| `appreciation_real` | `0.0` |

**`healthcare`** — age-rising OOP drawn each year + a rising-probability tail; insurance dampens the tail for a premium.

| Field | Default |
|---|---|
| `base_oop_usd` | `1200` |
| `growth` | `1.06` (≈6%/yr) |
| `tail_prob_base` / `tail_prob_slope` | `0.02` / `0.004` |
| `tail_min_usd` / `tail_max_usd` | `12000` / `45000` |
| `insurance_tail_factor` | `0.3` |
| `insurance_premium_usd` | `3000` |

**`tax`** — annual drag subtracted from real return: `onshore_return_drag 0.006`, `offshore_return_drag 0.0`.

**`strategies[]`** — each: `key`, `label`, `routing` (profile key), `buy` (bool), optional `settle_city` + `buy_age` (required if `buy`), `jurisdiction` (`onshore`/`offshore`), `insurance` (bool). Defaults ship 5 strategies (Nomad·experience, Nomad·frugal, Buy&settle·Daya Bay, Buy&settle·Chengdu, Offshore+frugal+settle Chengdu).

### 5.5 `normalization.json` — the 0–10 risk curves

| Key | Type | Mapping |
|---|---|---|
| `env_weights` | weights | `env_risk = 0.4·altitude + 0.3·climate + 0.3·humidity`. |
| `curves.altitude_score` | piecewise | `[[0,0],[500,0],[1500,3],[2500,6],[3500,9],[5000,10]]` — flat ≤500 m, ramps through the hypoxia band. |
| `curves.climate_variance_score` | linear | annual temp range `10°C→0 … 45°C→10`. |
| `curves.humidity_score` | abs_distance | `\|humidity − 50\| / 5`, clamped to `max 10`. |
| `curves.medical_risk` | linear | minutes to tier-3A `0→0 … 150→10` (120 min → 8). |
| `penalties` | additive | missing env `+2`, missing medical `+3` (→ flagged PARTIAL — no silent optimism). |
| `culture_default` | `3` | fallback `cultural_value` when missing. |

### 5.6 `thresholds.json` — the feasibility gate

| Field | Default | Effect |
|---|---|---|
| `trei_percentile_cutoff` | `85` | Cities above this TREI percentile (of the year's feasible set) → `LOW_PRIORITY`. |
| `max_hospital_minutes` | `120` | Hard block above this (or unknown). |
| `elderly_age` | `70` | Age at which the altitude ceiling engages. |
| `elderly_max_altitude_m` | `2500` | After `elderly_age`, altitude above this (or unknown) → BLOCKED. |
| `validation.max_missing_geo_fraction` | `0.10` | Validation warns/fails if more than this fraction lacks geo. |
| `validation.fail_on_geo_gap` | `false` | Whether a geo gap is fatal. |

### 5.7 `finance.json` — Monte Carlo drawdown

All values are **real** (inflation-adjusted) USD; spending is constant in real terms, so survival % is directly meaningful.

| Field | Default | Effect |
|---|---|---|
| `initial_portfolio_usd` | `500000` | Starting liquid capital. |
| `n_paths` | `2000` | Monte Carlo paths. More = smoother survival %, slower. |
| `mean_real_return` / `sd_real_return` | `0.035` / `0.11` | Normal-year real return ~ N(3.5%, 11%). |
| `recession_probability` | `0.10` | Per-year chance of a recession draw. |
| `recession_mean_return` / `recession_sd_return` | `-0.18` / `0.10` | Recession-year return ~ N(−18%, 10%) — injects sequence-of-returns risk. |

---

## 6. Data model reference

### 6.1 `RawCity` — `data/city_anchors.json` (source of truth)

| Field | Source | Notes |
|---|---|---|
| `id` | curated | e.g. `CN-GD-SHENZHEN`. Primary key everywhere. |
| `name` / `name_en` | GeoNames | 中文名 / English. |
| `province` | GeoNames | English province name (joins to `age_bands` target lists). |
| `lat` / `lng` / `altitude_m` | **GeoNames (real)** | `altitude_m` may be null (or repaired from `-9999`). |
| `tier3_hospital_minutes` | estimate | minutes to nearest tier-3A hospital. |
| `avg_temp_range` | estimate | annual temperature range (°C). |
| `humidity_index` | estimate | annual mean RH %. |
| `monthly_cost_usd` | estimate | living cost. |
| `cultural_value` | estimate | 0–10. |
| `county` | tag | true = county seat (vs prefecture/provincial). |
| `district` / `parent` | tag | true = 市辖区, collapsed onto `parent` prefecture; counted but **not routed/plotted**. |
| `source` | provenance | per-field origin tags — keep these when replacing estimates with measured data. |

### 6.2 `ProcessedCity` — `data/cities_china.json` (generated)

Extends `RawCity` with resolved, age-independent fields: `cultural_value` (defaulted), `altitude_score`, `climate_variance_score`, `humidity_score`, `env_risk` (0–10), `completeness` (`VALID`/`PARTIAL`/`INVALID`), `missing` (string[] of absent inputs).

`PARTIAL` = some input was missing and a penalty was applied. `INVALID` = unusable (e.g. no geo). Validation aborts the run if it fails the gate in `thresholds.validation`.

---

## 7. Engine — module-by-module API

Signatures are the public surface; see each file for detail. Numbers in **(step N)** map to `src/index.ts`.

### `lib/` — primitives
- `rng.ts` — `makeRng(seed): Rng` (deterministic PRNG), `deriveSeed(base, salt)` (independent sub-streams), `Rng` interface. **All randomness routes through here** for reproducibility.
- `geo.ts` — `haversineKm(aLat,aLng,bLat,bLng)`, `percentile(values, p)`, `clamp(x, lo, hi)`.

### `data_layer/` — load & validate **(step 1)**
- `loader.ts` — `loadCities(): ProcessedCity[]` (routed cities only; districts collapsed), `loadAllCities()` (everything).
- `validate.ts` — `validateDataset(cities): ValidationReport` — completeness counts, warnings, `passed` gate.

### `graph_layer/` — the weighted city graph **(step 2)**
- `edge_calculator.ts` — `computeEdge(a, b): EdgeInfo` — great-circle distance, estimated travel time, cost index, tagged `method`.
- `city_graph_builder.ts` — `buildGraph(cities): Graph` (k-NN capped by `max_neighbors`, `radius_km`), `isolatedNodes(cities, graph): string[]`.

### `core_engine/` — risk, gate, routing, lifecycle, climate, finance
- `trei_engine.ts` — `altitudeScore`, `climateScore`, `humidityScore`, `medicalRisk`, `enrichCity(raw): ProcessedCity`, `rAge(age)`, `trei(envRisk, medRisk, R)`. The risk math (**step 3**).
- `constraint_engine.ts` — `isHardBlocked(city, age): boolean`, `decide(hardBlocked, treiValue, cutoff): Decision`. The hybrid gate.
- `routing_engine.ts` — `bandForAge(age): AgeBand`, `planYear(ctx: YearContext): YearPlan`. The profile-weighted greedy graph walk for one year.
- `lifecycle_engine.ts` — `runLifecycle(cities, graph, seed, weights): LifecycleResult` — the 30-year loop carrying visited-state; returns `{ plans, phases, costByAge }` (**step 4**).
- `climate_engine.ts` — `annualMeanTemp`, `seasonalAmplitude`, `monthlyTemp`, `diurnalRange`, `nightTemp`, `nightDiscomfort`, `monthlyDiscomfort`; constants `NIGHT_FLOOR_C = 10`, `NIGHT_CEIL_C = 23` (the overnight comfort window).
- `finance_engine.ts` — `runFinance(costByAge, seed, options): FinanceResult` — the Monte Carlo drawdown; `FinanceOptions` carries the v4.1 coupling hooks (**step 5**).

### `simulation_engine/`
- `scenario_runner.ts` — `runScenarios(cities, graph, baseSeed): ScenarioResult[]` — re-runs routing+finance per profile to isolate the routing lever (**step 5a**).
- `monthly_scheduler.ts` — `buildSchedule(plans, cities): ScheduleYear[]` (months → comfiest city, hardest-first, snowbird grafts), `toICS(schedule): string` (**step 5c**).

### `v41/` — coupled strategy stack **(step 5b)**
- `housing_engine.ts` — `buildHousingPlan(strategy, cities): HousingPlan`.
- `healthcare_engine.ts` — `makeHealthcareSampler(insured): (age, rng) => number`.
- `tax_engine.ts` — `jurisdictionDrag(jurisdiction): number`.
- `strategy_engine.ts` — `runStrategies(cities, graph, baseSeed): StrategyResult[]` — full coupled MC per strategy, ranked.

### `dashboard/` — renderers **(step 6)**
- `visualization_generator.ts` — `renderDashboard(input): string` — the self-contained `dashboard.html`.
- `timeline_generator.ts` — `renderTimeline(input): string` — the interactive `timeline.html` (see [§10](#10-the-life-timeline-ui)).
- `obsidian_exporter.ts` — `exportObsidian(input, outDir): number` — linked vault, returns note count.

---

## 8. Formula quick-reference

```
# Risk
env_risk = 0.4·altitude_score + 0.3·climate_score + 0.3·humidity_score      (+penalty if input missing)
R_age    = clamp(1 − ((age−40)/40)^1.5, 0.35, 1.0)                          (50→0.875, 80→0.35; NaN-safe)
TREI     = (env_risk · medical_risk) / (R_age · 10)                          (lower = safer)

# Feasibility gate
BLOCKED       hospital > 120 min OR hospital unknown
BLOCKED       age > 70 AND altitude > 2500 m (unknown altitude ⇒ unsafe)
LOW_PRIORITY  TREI > percentile_85(feasible set this year)
ALLOWED       otherwise

# Routing
utility       = culture_pursuit·culture/(TREI+eps) − cost_weight·(cost/1000) − travel_weight·(dist/1000)
cities/year   = round(4 · R_age)                                            (~4 at 50 → 1 by 70)

# Finance (real USD)
portfolio(t+1) = portfolio(t)·(1 + real_return − tax_drag) − living − healthcare(age) − lump(age)
real_return    ~ N(3.5%, 11%) normal  /  N(−18%, 10%) in a recession year (p=10%)

# Climate
mean(lat,alt)  = 28 − 0.7·(|lat|−18) − 0.0065·alt
amplitude(lat) = 6 + 0.45·(|lat|−18)
temp(month)    = mean − amplitude·cos(2π·(month−1)/12)                      (Jan coldest, Jul warmest)
# month placement judged on the overnight low vs the 10–23°C window
```

---

## 9. Outputs reference

Written to `outputs/` (and the two HTML files mirrored to `docs/` for GitHub Pages).

| File | Contents | Shape |
|---|---|---|
| `yearly_plan.json` | 31 yearly plans (primary profile) | `YearPlan[]` |
| `full_30_year_route.json` | compressed life-phase narrative | `RegionPhase[]` |
| `cashflow_report.json` | primary survival % + p10/50/90 trajectories | `FinanceResult` |
| `scenario_comparison.json` | survival per routing profile | `ScenarioResult[]` |
| `strategy_comparison.json` | survival per coupled strategy, ranked | `StrategyResult[]` |
| `schedule.json` | month-by-month residence + quarters | `ScheduleYear[]` |
| `schedule.ics` | importable 30-year residence calendar | iCalendar |
| `risk_heatmap.json` | per-city TREI + decision at sample ages | array keyed by age |
| `edges.json` | the weighted city graph | `Edge[]` |
| `invalid_nodes_report.json` | data-quality audit | `ValidationReport` |
| `timeline.html` | **interactive Life Timeline** (see §10) | self-contained HTML |
| `dashboard.html` | comparisons, survival curve, TREI histogram, calendar, route | self-contained HTML |
| `obsidian/` | linked vault — overview + one note/year | Markdown |
| `travel_os.db` | SQLite (D1-compatible) | see §11 |

All JSON shapes are defined in [`src/types.ts`](src/types.ts).

---

## 10. The Life Timeline UI

`outputs/timeline.html` (also served at the live demo). A self-contained, dependency-free **"scroll = time"** navigator — generated by [`src/dashboard/timeline_generator.ts`](src/dashboard/timeline_generator.ts).

### 10.1 Mental model

This is **not** a slideshow or an autoplay animation. The page *is* the timeline: you scroll through your life and the sticky map fills in your route footprint as you go. Scroll position alone drives every update — there is no `setInterval`, no play button, no fixed-speed playback.

### 10.2 Layout

- **Left (sticky):** the China map — faint dots for all candidate cities, a blue trail of your route so far, a pulsing marker on the current city — plus a live readout panel and a life-progress bar.
- **Right (scrolls):** one card per **stay** (a contiguous run of months in the same city). The active card glows in its season color; neighbors fade.
- **Mobile (<880px):** single column; the map docks to the top as a compact sticky banner.

### 10.3 The "stay" node

The 372 months are collapsed into **city-stay segments** (≈163 on the default run) — one card per place you actually live. This is the low-entropy unit: "city node = snap point," not "every month." Each card carries: season tag, date range + duration, city (中文 · English), province · age · lifecycle band, monthly cost, and day/night temps. Segments are pre-rendered server-side from the data (data-first; client JS only toggles state).

### 10.4 Controls

| Input | Action |
|---|---|
| **Scroll** | Move through time. The card crossing the viewport center becomes "now." |
| **↓ / → / ↑ / ←** | Jump to the next / previous stay (smooth-scrolls it to center). |
| **Scroll-snap** | `scroll-snap-type: y proximity` + `scroll-snap-align: center` — cards gently settle to center without trapping inertial scroll. |

### 10.5 Seasonal color system

Each stay is tagged with the **actual N-hemisphere season of its start month** (the season you arrive in) — not decoration:

| Months | Season | CSS variable | Cognitive meaning |
|---|---|---|---|
| 3–5 | spring | `--spring: hsl(140,30%,85%)` | start / planning |
| 6–8 | summer | `--summer: hsl(30,90%,65%)` | peak activity / travel density |
| 9–11 | autumn | `--autumn: hsl(15,60%,50%)` | reflection / transition |
| 12,1,2 | winter | `--winter: hsl(200,40%,80%)` | rest / low entropy |

The season drives (a) the card's left-border accent and season chip, and (b) one of four full-bleed background layers that **crossfade** (opacity transition) as the active season changes — smooth banding, no hard jumps.

### 10.6 Non-linear time scaling

Time is **not** visually linear — visual density ≈ cognitive density. Each card exposes a `--time-scale` driving its vertical footprint (`min-height` + `contain-intrinsic-size`):

```
--time-scale = clamp(1.6 − (months − 1)·0.25, 0.6, 1.6)
```

Short stays (rapid travel) expand toward **1.6**; long settles compress toward **0.6**. (Footprint is scaled rather than `transform: scaleY()` on the card so text never distorts — same density mapping, correct rendering.)

### 10.7 Performance

- `content-visibility: auto` + `contain-intrinsic-size` on every card — the browser skips rendering off-screen cards. This **is** native virtualization; at ≈163 nodes (≪ ~1000) no JS windowing is needed.
- Two `IntersectionObserver`s: a **reveal** observer fades/slides each card in as it enters; an **active** observer (center band `-46% 0 -46% 0`) marks the centered card and updates the map, readout, season background, and neighbor fade.
- `prefers-reduced-motion` disables smooth scrolling.

### 10.8 Customizing it

All in `src/dashboard/timeline_generator.ts`, then `npm run simulate`:

| Want to change | Where |
|---|---|
| Season colors | `:root` CSS variables (`--spring`…`--winter`). |
| Density curve | `scaleFor(months)`. |
| Season boundaries / hemisphere | `seasonOf(month)`. |
| Node granularity | the segment-collapse loop (group by something other than city). |
| Snap firmness | `scroll-snap-type` (`proximity` ↔ `mandatory`). |
| Active-card sensitivity | the active observer's `rootMargin`. |
| Readout fields | the `setActive()` DOM writes + the readout markup. |

Browser support: modern evergreen (Chrome/Edge/Firefox/Safari). Uses `content-visibility`, `color-mix()`, `IntersectionObserver`, CSS scroll-snap.

---

## 11. Database (SQLite / D1)

`npm run db` reads the JSON outputs and writes `outputs/travel_os.db` using the schema in [`database/schema.sql`](database/schema.sql) — plain SQLite DDL, **D1-compatible** (no engine-specific features).

Tables: `cities`, `edges`, `yearly_plan_cities`, `finance_summary` (single row), `scenario_results`, `strategy_results`, `schedule_months`. `cities.district`/`parent` capture collapsed 市辖区; `edges` carries the weighted graph with a `method` provenance check. To deploy on Cloudflare D1, apply `schema.sql`, then bulk-load from the same JSON.

---

## 12. Determinism & reproducibility

A given `(dataset, seed)` reproduces **bit-for-bit**. Guarantees:

- All randomness flows through `lib/rng.ts` (`makeRng` / `deriveSeed`) — no `Math.random()`.
- The Monte Carlo, routing tie-breaks, and scenario/strategy sub-runs derive independent seeds from the master `seed` via `deriveSeed`, so adding a scenario doesn't perturb others.
- Re-run `npm run simulate` after any config edit; diff the JSON outputs to see exactly what a change moved.

To explore sensitivity, sweep `seed` in `system_config.json` and compare `cashflow_report.json` survival across runs.

---

## 13. Recipes (common tasks)

**Change the person / starting point** → `system_config.json`: `base_city`, `age_start`, `age_end`, `base_calendar_year`.

**Change the money** → `finance.json`: `initial_portfolio_usd`, return regimes.

**Go frugal (watch survival jump)** → `routing_profiles.json`: set `"primary": "frugal"`. (Or compare all three in `scenario_comparison.json`, which always runs every profile.)

**Add or edit a strategy** → `strategies.json` `strategies[]`: add an object with `routing`, `buy`, `settle_city`+`buy_age` (if buying), `jurisdiction`, `insurance`. It appears ranked in `strategy_comparison.json`.

**Retune the lifecycle zones** → `age_bands.json`: edit `target_provinces`, `zone_bonus`, and the rising `comfort_bonus`/`hospital_bonus`.

**Tighten/loosen the safety gate** → `thresholds.json`: `max_hospital_minutes`, `elderly_max_altitude_m`, `trei_percentile_cutoff`.

**Add a real city** → add a `RawCity` to `data/city_anchors.json` (real `lat`/`lng`/`altitude_m`, estimates for the rest, with `source` tags) → `npm run enrich` → `npm run simulate`.

**Replace estimates with measured data** → edit `data_pipeline/enrich_estimates.ts` (or the anchors) to pull real hospital travel-time / climate normals; **keep the `source` tags** so approximations stay visible.

**Re-skin the timeline** → see [§10.8](#108-customizing-it).

**Reset generated files** → `npm run clean` (then `npm run simulate`).

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `validation failed (fatal). Aborting.` | Dataset missed the gate in `thresholds.validation`. Check `invalid_nodes_report.json`; loosen `max_missing_geo_fraction` or fix the data. |
| `npm run anchors` fails | Needs python3 + network. The committed `data/city_anchors.json` already has its output — you can skip it. |
| `npm run db` errors | `better-sqlite3` is an **optional** native dep; `npm install` it, or skip the DB step. |
| Survival % "looks too low" | That's the finding, not a bug — spend is the dominant lever. Try the `frugal` profile. |
| Timeline shows a stale route | Regenerate: `npm run simulate` (it rewrites both `outputs/` and `docs/`). |
| Live demo unchanged after a push | GitHub Pages serves `main /docs`; confirm `docs/timeline.html` was committed and Pages finished building. |
| Type errors | `npm run typecheck` — the project must stay green. |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **R_age** | Health factor, 1.0 (robust) → 0.35 (fragile), shrinking with age. |
| **TREI** | Travel Risk-Exposure Index — per-city, per-age safety score (lower = safer). |
| **env_risk** | 0–10 environmental risk from altitude + climate + humidity. |
| **The gate** | Hybrid feasibility filter: hard absolute ceilings + a relative percentile cut. |
| **Routing / profile** | The yearly value-for-money city selection and its weight preset. |
| **Band** | One of the three age phases (Expedition / Cultural deep-dive / Climate & comfort). |
| **Frontier share** | Reported fraction of days spent in frontier provinces. |
| **Snowbird graft** | Forced warm-winter / cool-summer bases so no month breaks the comfort window. |
| **Stay (segment)** | A contiguous run of months in one city — the timeline's node. |
| **Survival probability** | % of Monte Carlo paths where liquid capital lasts to `age_end`. |
| **市辖区 (district)** | Urban district collapsed onto its parent prefecture: counted, not routed. |

---

## 16. Data honesty & disclaimer

`lat`, `lng`, `altitude_m` come from **GeoNames (CC BY 4.0)** — real. `tier3_hospital_minutes`, `avg_temp_range`, `humidity_index`, `monthly_cost_usd`, `cultural_value`, and all monthly temperatures are **rule-based estimates** — good enough to exercise the engine, not authoritative. The `source` tags mark every field's origin; replace estimates via the data pipeline before treating any specific city result as real.

**This is a planning model, not financial advice.** It never trades or touches real money.

---

MIT © 2026 alexmorerich · city data © GeoNames (CC BY 4.0) · see [README](README.md) for the project overview (English · 中文)
