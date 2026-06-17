-- Travel Life OS v4.0 — relational schema.
-- D1-compatible (Cloudflare): plain SQLite DDL, no engine-specific features.
-- Build a local SQLite file with `npm run db`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cities (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  name_en                 TEXT NOT NULL,
  province                TEXT NOT NULL,
  lat                     REAL NOT NULL,
  lng                     REAL NOT NULL,
  altitude_m              REAL,
  tier3_hospital_minutes  REAL,
  avg_temp_range          REAL,
  humidity_index          REAL,
  monthly_cost_usd        REAL,
  cultural_value          REAL,
  env_risk                REAL NOT NULL,
  completeness            TEXT NOT NULL CHECK (completeness IN ('VALID','PARTIAL','INVALID'))
);

CREATE TABLE IF NOT EXISTS edges (
  from_id          TEXT NOT NULL REFERENCES cities(id),
  to_id            TEXT NOT NULL REFERENCES cities(id),
  distance_km      REAL NOT NULL,
  travel_time_hours REAL NOT NULL,
  cost_index       REAL NOT NULL,
  method           TEXT NOT NULL CHECK (method IN ('great_circle','road_api','estimated')),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);

CREATE TABLE IF NOT EXISTS yearly_plan_cities (
  age              INTEGER NOT NULL,
  seq              INTEGER NOT NULL,
  city_id          TEXT NOT NULL REFERENCES cities(id),
  days             INTEGER NOT NULL,
  monthly_cost_usd REAL NOT NULL,
  env_risk         REAL NOT NULL,
  medical_risk     REAL NOT NULL,
  trei             REAL NOT NULL,
  utility          REAL NOT NULL,
  decision         TEXT NOT NULL,
  PRIMARY KEY (age, seq)
);
CREATE INDEX IF NOT EXISTS idx_plan_age ON yearly_plan_cities(age);

CREATE TABLE IF NOT EXISTS finance_summary (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  initial_portfolio_usd     REAL NOT NULL,
  n_paths                   INTEGER NOT NULL,
  survival_probability      REAL NOT NULL,
  median_bankruptcy_age     INTEGER,
  effective_withdrawal_rate REAL NOT NULL,
  p50_terminal              REAL NOT NULL
);

-- Task 1: routing-profile comparison (rent-only baseline)
CREATE TABLE IF NOT EXISTS scenario_results (
  key                       TEXT PRIMARY KEY,
  label                     TEXT NOT NULL,
  survival_probability      REAL NOT NULL,
  median_bankruptcy_age     INTEGER,
  mean_annual_cost_usd      REAL NOT NULL,
  effective_withdrawal_rate REAL NOT NULL
);

-- v4.1: coupled life-strategy comparison
CREATE TABLE IF NOT EXISTS strategy_results (
  key                       TEXT PRIMARY KEY,
  label                     TEXT NOT NULL,
  routing                   TEXT,
  buy                       INTEGER NOT NULL,
  settle_city               TEXT,
  jurisdiction              TEXT NOT NULL,
  property_price_usd        REAL NOT NULL,
  survival_probability      REAL NOT NULL,
  median_bankruptcy_age     INTEGER,
  median_terminal_net_worth REAL NOT NULL
);

-- Time layer: month-by-month residence schedule
CREATE TABLE IF NOT EXISTS schedule_months (
  age            INTEGER NOT NULL,
  calendar_year  INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  city_id        TEXT NOT NULL,
  name_en        TEXT NOT NULL,
  temp_c         REAL NOT NULL,
  discomfort     REAL NOT NULL,
  PRIMARY KEY (age, month)
);
CREATE INDEX IF NOT EXISTS idx_sched_age ON schedule_months(age);
