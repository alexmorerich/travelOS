# 🌍 Travel Life OS v4.0

**Deterministic geo-life planning + financial-constraint engine for China (ages 50–80).**

A constrained life-trajectory optimizer — *not* a travel planner. It loads real Chinese cities, scores each on medical / climate / altitude risk, walks a weighted city graph year by year under an age-physiology constraint, and runs a Monte Carlo drawdown of a US$500k portfolio to answer the one question that decides everything:

> **Does the money last to 80?**

*English · [中文](#-中文文档)*

---

## ⚡ Headline result (default config)

Running the shipped 50-city dataset with the default assumptions:

| Metric | Value |
|---|---|
| **P(capital survives to 80)** | **11.6%** |
| Median bankruptcy age | **68** |
| Effective withdrawal rate | 5.5% (≈ $27.8k/yr) |
| Median terminal portfolio | $0 |

**Read this honestly:** optimizing the itinerary for *experience + safety* lands on cities averaging ~$2,300/mo — a 5.5% withdrawal rate on $500k. At that rate, with a conservative 3.5% real-return assumption and sequence-of-returns risk, the plan goes broke around 68 in ~88% of simulated futures. The headline number is *supposed* to be uncomfortable: it tells you the real lever is **spend rate / city cost**, not itinerary polish. Lower the spend (cheaper cities, fewer tier-1 stops) or assume a higher real return in `config/finance.json`, and survival climbs. The point of the system is to make that trade-off explicit and quantified.

> This is a planning model, **not financial advice.** Non-geographic data fields are curated estimates (see [Data honesty](#data-honesty)).

---

## 🚀 Quickstart

```bash
npm install
npm run simulate        # runs the full pipeline -> outputs/
open outputs/dashboard.html   # self-contained HTML dashboard (no server needed)

npm run db              # optional: build a D1-compatible SQLite database
npm run typecheck       # strict TypeScript check
```

Requires Node ≥ 20. The core simulation has **no native dependencies**; `better-sqlite3` is optional and only used by `npm run db`.

---

## 🧭 What it does

```
load cities ─▶ validate ─▶ build weighted graph ─▶ score risk (TREI)
     ─▶ walk the graph year-by-year (age 50→80) ─▶ Monte Carlo drawdown
     ─▶ JSON outputs + HTML dashboard + Obsidian vault + SQLite
```

1. **Loads** real prefecture-level Chinese cities (MVP ships ~50 anchor cities; the pipeline scales to the 300–500 target unchanged).
2. **Normalizes** altitude / climate / humidity / medical access onto a common **0–10 risk scale** (explicit curves, no `max()` of mismatched units).
3. **Gates** each city with a **hybrid constraint**: hard absolute ceilings (≤2h to a tier-3A hospital; no high altitude when elderly) + a relative TREI percentile cut.
4. **Routes** a constrained, utility-weighted **greedy graph walk** with a visited-set (no ping-pong), where the number of cities per year shrinks with age.
5. **Simulates** a $500k portfolio across thousands of seeded return paths and reports **P(survive to 80)**.
6. **Exports** everything: JSON, an HTML dashboard, an Obsidian vault, and a SQLite/D1 database.

Everything is **deterministic**: a given `(dataset, seed)` reproduces bit-for-bit.

---

## 🏗️ Architecture

```
travelOS/
├── config/                      # all tunables — edit these, not the code
│   ├── system_config.json       # seed, age range, base city, radius, routing weights
│   ├── normalization.json       # the 0–10 risk curves (altitude/climate/humidity/medical)
│   ├── thresholds.json          # hybrid gate: percentile + hospital/altitude ceilings
│   └── finance.json             # Monte Carlo return regimes, portfolio, paths
├── data/
│   └── cities_china.json        # MVP dataset (real geo + tagged estimates)
├── database/
│   └── schema.sql               # D1-compatible relational schema
├── src/
│   ├── core_engine/
│   │   ├── trei_engine.ts        # normalization + env_risk + R_age + TREI
│   │   ├── constraint_engine.ts  # hybrid absolute + percentile gate
│   │   ├── routing_engine.ts     # yearly greedy graph walk (visited-set, seeded ties)
│   │   ├── lifecycle_engine.ts   # 30-year loop, state carry, region phases
│   │   └── finance_engine.ts     # Monte Carlo drawdown -> survival probability
│   ├── graph_layer/
│   │   ├── edge_calculator.ts    # great-circle edges (explicitly tagged)
│   │   └── city_graph_builder.ts # radius-limited weighted graph
│   ├── data_layer/{loader,validate}.ts
│   ├── dashboard/{visualization_generator,obsidian_exporter}.ts
│   ├── scripts/build_db.ts       # JSON -> SQLite
│   ├── lib/{geo,rng}.ts          # haversine, percentile, seeded PRNG + Gaussian
│   ├── config.ts · types.ts · index.ts
└── outputs/                      # generated artifacts (see below)
```

---

## 🧠 Data model

```ts
type CityNode = {
  id: string; name: string; name_en: string; province: string;
  lat: number; lng: number;
  altitude_m: number | null;
  tier3_hospital_minutes: number | null;   // minutes to nearest 三甲 hospital
  avg_temp_range: number | null;            // annual temp range, °C
  humidity_index: number | null;            // annual mean RH, %
  monthly_cost_usd: number | null;
  cultural_value: number | null;            // 0–10, explicit input (default 3 if null)
  // derived:
  env_risk: number;                         // 0–10
  completeness: "VALID" | "PARTIAL" | "INVALID";
};
```

---

## 🔬 The engine, exactly

### Risk normalization (the curves that every spec version was missing)

All defined in `config/normalization.json`:

| Sub-score | Mapping |
|---|---|
| `altitude_score` | piecewise: flat ≤500m, ramps through the 1500–3500m hypoxia band to 10 |
| `climate_variance_score` | linear: annual temp range 10°C→0 … 45°C→10 |
| `humidity_score` | `\|humidity − 50\| / 5`, clamped 0–10 (both arid & muggy extremes score up) |
| `medical_risk` | linear: minutes to tier-3A, 0→0 … 150→10 (the 120-min limit ≈ 8) |

```
env_risk = 0.4·altitude_score + 0.3·climate_variance_score + 0.3·humidity_score
```

**Missing data is never optimistic:** a missing env input adds a +2 penalty and flags the node `PARTIAL`; a missing hospital time forces max medical risk *and* a hard BLOCK.

### Age physiology (NaN-safe)

```
R_age(age) = clamp(1 − ((age − 40) / 40)^1.5, 0.35, 1.0)     // age ≤ 40 ⇒ 1.0
```
R_age(50)=0.875, R_age(65)=0.65, R_age(80)=0.35. It drives both risk and how many cities you can handle per year.

### TREI (Travel Risk / Exposure Index)

```
TREI = (env_risk · medical_risk) / (R_age · 10)
```
Bounded ~0–28. Higher = worse. Older travellers (smaller R_age) see the same place as riskier.

### Hybrid feasibility gate

```
BLOCKED       if hospital > 120 min  OR hospital unknown
BLOCKED       if age > 70 AND altitude > 2500m   (unknown altitude ⇒ unsafe)
LOW_PRIORITY  if TREI > percentile_85(feasible set this year)
ALLOWED       otherwise
```
The absolute ceilings keep *safety* meaningful; the percentile keeps *coverage* from collapsing. Neither alone is enough.

### Routing — a real graph walk

For each year: start from the current city; at each hop consider only graph neighbours (within `radius_km`) that are feasible and **not visited in the last 3 years**; rank by

```
utility = cultural_value / (TREI + 0.5) − 0.8·(monthly_cost/1000) − 0.4·(distance_km/1000)
```

pick the best (seeded RNG breaks near-ties within 5%), move there, repeat. Cities-per-year = `round(4 · R_age)`, so itineraries collapse from ~4 cities at 50 to a single stabilization city by 70. The `(TREI + 0.5)` denominator means a zero-risk city can't produce infinite utility.

### Finance — Monte Carlo drawdown

Works in **real (inflation-adjusted) USD**, so survival probability is directly meaningful:

```
portfolio(t+1) = portfolio(t) · (1 + real_return_t) − annual_cost(age_t)
real_return_t ~ N(3.5%, 11%)   normally
             ~ N(−18%, 10%)    in a recession year (10% annual probability)
```

`annual_cost` comes from the routing plan (geography → cost coupling). Thousands of seeded paths → `survival_probability`, `median_bankruptcy_age`, and p10/p50/p90 portfolio trajectories. A single deterministic path would hide sequence-of-returns risk — the dominant failure mode — so we sample.

---

## 📊 Outputs (`outputs/`)

| File | Contents |
|---|---|
| `yearly_plan.json` | 31 yearly plans: cities, days, per-city TREI/risk/utility/decision, cost |
| `full_30_year_route.json` | compressed life-phase narrative (region pattern per year) |
| `cashflow_report.json` | survival probability, bankruptcy distribution, p10/50/90 trajectories |
| `risk_heatmap.json` | per-city TREI + decision at representative ages (50/60/70/78) |
| `edges.json` | the weighted city graph |
| `invalid_nodes_report.json` | data-quality audit (VALID/PARTIAL/INVALID + reasons) |
| `dashboard.html` | self-contained dark-theme dashboard (survival curve, TREI histogram, route table) |
| `obsidian/` | linked Obsidian vault — overview + one note per year, with frontmatter |
| `travel_os.db` | SQLite (D1-compatible), built by `npm run db` |

---

## ⚙️ Tuning

Everything lives in `config/`. Common experiments:

- **Survive longer?** Lower city costs (route through cheaper provinces), reduce `max_cities_per_year`, or raise `mean_real_return` in `config/finance.json`.
- **More/less cautious?** Adjust `trei_percentile_cutoff`, `max_hospital_minutes`, `elderly_max_altitude_m` in `config/thresholds.json`.
- **Different person?** Change `base_city`, `age_start/end`, `seed` in `config/system_config.json`.
- **Reshape risk?** Edit the curves in `config/normalization.json` — no code changes.

---

## 📈 Scaling to 300–500 (and 2,800 counties)

The MVP ships ~50 anchor cities so the engine is inspectable end-to-end. To scale:

1. Append rows to `data/cities_china.json` (same schema). The loader, graph builder, and engines are size-agnostic.
2. The graph is O(n²) within `radius_km` — fine to a few thousand nodes in SQLite; beyond that, persist `edges` to D1 and query incrementally.
3. Replace estimated fields with measured data: tier-3A hospital travel-time (Amap/OSRM + hospital POIs), climate normals, cost-of-living indices. Keep the `method`/`source` tags so approximations stay visible.

---

## 🧪 Design decisions (what changed from the v3.x specs)

This codebase is the **calibrated** resolution of issues found across the spec review cycle:

- **No coverage collapse.** A fixed `TREI < 6` cutoff excluded almost all of China; replaced by a percentile + absolute hybrid.
- **Consistent units.** Raw `max()` over temp/humidity/altitude replaced by normalized 0–10 sub-scores with documented curves.
- **No silent null optimism.** Missing data → penalty + PARTIAL/BLOCK, never a free pass.
- **Real routing.** A ranked list became a graph walk with a visited-set and a start location.
- **Honest money.** A single accumulator became a Monte Carlo with sequence-of-returns risk and a survival probability.
- **No fake precision.** Travel times are great-circle approximations, explicitly tagged.

### Data honesty

`lat`, `lng`, `altitude_m` are real approximate geographic values. `tier3_hospital_minutes`, `avg_temp_range`, `humidity_index`, `monthly_cost_usd`, and `cultural_value` are **curated estimates** for the MVP — good enough to exercise the engine, not authoritative. Replace them via the data pipeline before treating any specific city result as real.

---

## 🗺️ Roadmap (v4.1)

Life + Real Estate + Tax coupling: rent-vs-buy optimization (e.g. Shenzhen vs Daya Bay vs Chengdu), healthcare-cost risk modeling, and cross-border (HK/SG) liquidity. **Deliberately deferred** until the base case is understood — there is no point optimizing real-estate tax efficiency on top of a plan that goes bankrupt at 68. Fix the spend lever first.

## License

MIT © 2026 alexmorerich

---
---

# 🌏 中文文档

# 🌍 Travel Life OS v4.0（旅居人生操作系统）

**面向中国、覆盖 50–80 岁的确定性「地理-人生」规划 + 金融约束引擎。**

这不是旅行规划器，而是一个**带约束的人生轨迹优化器**。它加载真实中国城市，对每座城市的医疗 / 气候 / 海拔风险打分，在年龄生理约束下逐年地在加权城市图上行走，并对 50 万美元资产组合做蒙特卡洛消耗模拟，回答那个决定一切的问题：

> **钱能撑到 80 岁吗？**

## ⚡ 核心结论（默认配置）

用内置的 50 城数据集 + 默认假设运行：

| 指标 | 数值 |
|---|---|
| **资产撑到 80 岁的概率** | **11.6%** |
| 中位破产年龄 | **68** |
| 有效提取率 | 5.5%（约 $27.8k/年）|
| 中位最终资产 | $0 |

**请诚实地理解这个结果：** 当路径以「体验 + 安全」为目标优化时，落点城市平均月成本约 $2,300——即 50 万美元上 5.5% 的提取率。在 3.5% 实际收益率的保守假设和「收益顺序风险」下，约 88% 的模拟未来里，这套计划会在 68 岁左右破产。这个数字**本就应该让人不安**：它告诉你真正的杠杆是**支出水平 / 城市成本**，而不是行程的精细打磨。降低支出（选更便宜的城市、减少一线城市停留），或在 `config/finance.json` 里假设更高的实际收益率，存活率就会上升。系统的价值，就是把这个权衡**显式化、量化**。

> 本系统是规划模型，**不构成投资建议**。非地理字段为人工估算值（见[数据诚实性](#数据诚实性)）。

## 🚀 快速开始

```bash
npm install
npm run simulate        # 运行完整管线 -> outputs/
open outputs/dashboard.html   # 自包含 HTML 仪表盘（无需服务器）

npm run db              # 可选：构建 D1 兼容的 SQLite 数据库
npm run typecheck       # 严格 TypeScript 检查
```

需要 Node ≥ 20。核心模拟**无原生依赖**；`better-sqlite3` 为可选项，仅 `npm run db` 使用。

## 🧭 它做什么

1. **加载**真实地级市（MVP 内置约 50 座锚点城市；管线可无改动扩展到 300–500 城目标）。
2. **归一化**海拔 / 气候 / 湿度 / 医疗可达性到统一的 **0–10 风险刻度**（显式曲线，不再对量纲不一致的值取 `max()`）。
3. **混合约束门控**每座城市：硬性绝对上限（三甲医院 ≤2 小时；高龄不去高海拔）+ 相对 TREI 百分位裁剪。
4. **路由**为带约束、按效用加权的**贪心图行走**，含已访问集合（杜绝来回横跳），每年城市数量随年龄递减。
5. **模拟** 50 万美元资产在数千条带种子收益路径上的演化，输出**撑到 80 岁的概率**。
6. **导出**全部结果：JSON、HTML 仪表盘、Obsidian 笔记库、SQLite/D1 数据库。

全流程**确定性**：相同 `(数据集, 种子)` 可逐字节复现。

## 🔬 引擎细节

### 风险归一化曲线（此前每版 spec 都缺失的量化内容）

全部定义在 `config/normalization.json`：

| 子分数 | 映射 |
|---|---|
| `altitude_score` | 分段：≤500m 平坦，1500–3500m 缺氧带爬升至 10 |
| `climate_variance_score` | 线性：年温差 10°C→0 … 45°C→10 |
| `humidity_score` | `\|湿度 − 50\| / 5`，截断 0–10（过干和过湿都加分）|
| `medical_risk` | 线性：到三甲分钟数 0→0 … 150→10（120 分钟上限 ≈ 8）|

```
env_risk = 0.4·海拔 + 0.3·气候 + 0.3·湿度
```

**缺失数据绝不乐观处理**：缺环境输入 +2 惩罚并标记 `PARTIAL`；缺医院时间则强制最大医疗风险**并**硬性 BLOCK。

### 年龄生理因子（NaN 安全）

```
R_age(age) = clamp(1 − ((age − 40) / 40)^1.5, 0.35, 1.0)     // age ≤ 40 ⇒ 1.0
```
R_age(50)=0.875，R_age(65)=0.65，R_age(80)=0.35。它同时驱动风险和每年可承受的城市数量。

### TREI（旅居风险/暴露指数）

```
TREI = (env_risk · medical_risk) / (R_age · 10)
```
范围约 0–28，越高越差。越年长（R_age 越小），同一地点风险越高。

### 混合可行性门控

```
BLOCKED       医院 > 120 分钟  或  医院数据未知
BLOCKED       年龄 > 70 且 海拔 > 2500m（海拔未知 ⇒ 视为不安全）
LOW_PRIORITY  TREI > 当年可行集合的 85 百分位
ALLOWED       其他
```
绝对上限保住**安全**语义，百分位保住**覆盖率**，二者缺一不可。

### 路由——真正的图行走

每年从当前城市出发，每跳只考虑图中邻居（`radius_km` 内）、可行且**近 3 年未访问**的城市，按效用排序：

```
utility = cultural_value / (TREI + 0.5) − 0.8·(月成本/1000) − 0.4·(距离km/1000)
```

选最优（种子 RNG 打破 5% 以内的近似平局），移动过去，重复。每年城市数 = `round(4 · R_age)`，于是行程从 50 岁的约 4 城收敛到 70 岁的单城定居。`(TREI + 0.5)` 分母确保零风险城市不会产生无穷大效用（修复了除零）。

### 金融——蒙特卡洛消耗

以**实际（经通胀调整）美元**计算，使存活概率直接可解释：

```
组合(t+1) = 组合(t) · (1 + 实际收益_t) − 年度支出(年龄_t)
实际收益_t ~ N(3.5%, 11%)   正常年份
          ~ N(−18%, 10%)    衰退年份（年发生概率 10%）
```

`年度支出`来自路由计划（地理 → 成本耦合）。数千条种子路径 → `survival_probability`、`median_bankruptcy_age` 以及 p10/p50/p90 资产轨迹。单条确定性路径会掩盖「收益顺序风险」这一主要失败模式，因此必须采样。

## 📊 输出文件（`outputs/`）

| 文件 | 内容 |
|---|---|
| `yearly_plan.json` | 31 份年度计划：城市、天数、各城 TREI/风险/效用/决策、成本 |
| `full_30_year_route.json` | 压缩的人生阶段叙事（每年的区域模式）|
| `cashflow_report.json` | 存活概率、破产分布、p10/50/90 轨迹 |
| `risk_heatmap.json` | 代表年龄（50/60/70/78）下各城 TREI + 决策 |
| `edges.json` | 加权城市图 |
| `invalid_nodes_report.json` | 数据质量审计（VALID/PARTIAL/INVALID + 原因）|
| `dashboard.html` | 自包含暗色仪表盘（存活曲线、TREI 直方图、路线表）|
| `obsidian/` | 互链 Obsidian 笔记库——总览 + 每年一篇，带 frontmatter |
| `travel_os.db` | SQLite（D1 兼容），由 `npm run db` 生成 |

## ⚙️ 调参

全部在 `config/` 内：

- **想撑更久？** 降低城市成本（走更便宜的省份）、减小 `max_cities_per_year`，或在 `config/finance.json` 提高 `mean_real_return`。
- **更保守/激进？** 调整 `config/thresholds.json` 的 `trei_percentile_cutoff`、`max_hospital_minutes`、`elderly_max_altitude_m`。
- **换个人？** 改 `config/system_config.json` 的 `base_city`、`age_start/end`、`seed`。
- **重塑风险？** 编辑 `config/normalization.json` 的曲线——无需改代码。

## 📈 扩展到 300–500 城（乃至 2800 县）

MVP 内置约 50 城以便端到端审查。扩展步骤：

1. 向 `data/cities_china.json` 追加同结构行。加载器、建图、引擎均与规模无关。
2. 图在 `radius_km` 内为 O(n²)——数千节点在 SQLite 内无压力；再大则把 `edges` 落到 D1 增量查询。
3. 用实测数据替换估算字段：三甲医院通行时间（高德/OSRM + 医院 POI）、气候常年值、生活成本指数。保留 `method`/`source` 标签，让近似保持可见。

### 数据诚实性

`lat`、`lng`、`altitude_m` 为真实近似地理值。`tier3_hospital_minutes`、`avg_temp_range`、`humidity_index`、`monthly_cost_usd`、`cultural_value` 为 MVP 的**人工估算**——足以驱动引擎，但非权威数据。在把任何具体城市结果当真之前，请先通过数据管线替换为实测值。

## 🗺️ 路线图（v4.1）

人生 + 房产 + 税务耦合：租 vs 买优化（如深圳 vs 大亚湾 vs 成都）、医疗支出风险建模、跨境（港/新）流动性。**刻意延后**——在一套 68 岁就破产的计划之上优化房产税效毫无意义。先解决支出杠杆。

## 许可证

MIT © 2026 alexmorerich
