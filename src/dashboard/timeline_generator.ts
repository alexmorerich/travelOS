// Life Timeline OS — interaction-driven, scroll-as-time navigation + Season Engine.
//
// Not a slideshow and not an autoplay loop. The page itself is the timeline:
// you scroll through your life and the sticky map fills in your route footprint
// as you go. The 372 months collapse into city-stay *segments* (one card per
// place you live) — the low-entropy unit. Scroll position drives everything via
// IntersectionObserver; there is no setInterval, no fixed-speed playback.
//
// The Season Engine is an ADDITIVE chronobiology layer on top of the (unchanged)
// city scheduler. Its job is to restore the felt sense of annual rhythm even
// though city switching is climate-optimized: as the active stay changes, the
// whole UI eases between four seasonal palettes — Green → Blue → Orange → Gray —
// so the user perceives "living through years," not "hopping 2,348 cities."
//   • Global theme — live --sp/--ss/--sa (primary/secondary/accent) CSS vars,
//     registered with @property so they interpolate smoothly (~1.5s) at season
//     boundaries. Applied as accents + a subtle wash over the dark base, never
//     as raw backgrounds (readability first).
//   • Month bar — a compact Jan…Dec strip, color-coded by season, the active
//     stay's months highlighted: the annual clock.
//   • Season badge — fixed corner 🌱/🌊/🍂/❄ with a gentle breathe.
//   • Transition marks — a purple 🌈 interstitial between stays (chapters).
//   • Mood layer — season-appropriate activity suggestions (never forced).
//   • Non-linear time — fast travel expands, settling compresses (--time-scale).
//   • content-visibility:auto culls off-screen cards (native virtualization).
// Data is inlined so it opens straight from disk, no server, no CDN.
import { bandForAge } from "../core_engine/routing_engine";
import type { ScheduleYear, ProcessedCity, FinanceResult } from "../types";

export interface TimelineInput {
  schedule: ScheduleYear[];
  cities: ProcessedCity[];
  finance: FinanceResult;
  seed: number;
}

type Season = "spring" | "summer" | "autumn" | "winter";

interface MonthPoint {
  y: number; m: number; age: number;
  city: string; zh: string; prov: string;
  lng: number; lat: number; cost: number; temp: number; night: number; band: string;
}

/** A contiguous run of months in the same city — one scroll node. */
interface Segment {
  i: number;                     // segment index, 0-based
  city: string; zh: string; prov: string;
  lng: number; lat: number;
  age: number; band: string;
  startY: number; startM: number;
  endY: number; endM: number;
  months: number;                // duration
  cost: number;                  // monthly living cost (USD)
  spentEnd: number;              // cumulative spend through the end of this stay
  temp: number; night: number;   // mean day / overnight temp across the stay
  season: Season;                // season the stay begins in
  scale: number;                 // --time-scale: density-aware vertical footprint
}

// Northern-hemisphere calendar season (China). The *actual* season experienced
// on arrival, not decoration — it maps to cognition: spring=start/learning,
// summer=exploration, autumn=reflection, winter=rest/review.
function seasonOf(m: number): Season {
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

// Short stay = high churn = travel-dense -> expand; long residence -> compress.
// Stays here span 1–5 months, so the band lands ~0.6 (settled) … ~1.6 (rapid).
function scaleFor(months: number): number {
  return Math.round(Math.max(0.6, Math.min(1.6, 1.6 - (months - 1) * 0.25)) * 100) / 100;
}

// Season Engine palette + semantics (the v2 spec). Emoji + mood drive the badge,
// the card chips, and the suggestion layer; the hex palette lives in CSS.
const SEASON_EMOJI: Record<Season, string> = { spring: "🌱", summer: "🌊", autumn: "🍂", winter: "❄" };
const SEASON_WORD: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
const SEASON_MOOD: Record<Season, string[]> = {
  spring: ["Study", "Build", "Learn"],
  summer: ["Hiking", "Sports", "Exploration"],
  autumn: ["Writing", "Reading", "Long projects"],
  winter: ["Review", "Planning", "Recovery"],
};

export function renderTimeline(input: TimelineInput): string {
  const byId = new Map(input.cities.map((c) => [c.id, c]));
  const months: MonthPoint[] = input.schedule.flatMap((yr) =>
    yr.months.map((mm) => {
      const c = byId.get(mm.city_id);
      return {
        y: yr.calendar_year, m: mm.month, age: yr.age,
        city: mm.name_en, zh: mm.name, prov: c?.province ?? "",
        lng: c ? Number(c.lng.toFixed(2)) : 0,
        lat: c ? Number(c.lat.toFixed(2)) : 0,
        cost: c?.monthly_cost_usd ?? 0,
        temp: mm.temp_c,
        night: mm.night_temp_c,
        band: bandForAge(yr.age).label,
      };
    }),
  );

  // Collapse consecutive same-city months into stay segments, tracking the
  // running spend so each card can show "spent since age 50" at no client cost.
  type SegBuild = Segment & { tempSum: number; nightSum: number };
  const building: SegBuild[] = [];
  let spent = 0;
  let cur: SegBuild | null = null;
  for (const mp of months) {
    spent += mp.cost;
    const sameStay = cur && cur.city === mp.city && cur.prov === mp.prov;
    if (cur && sameStay) {
      cur.endY = mp.y; cur.endM = mp.m;
      cur.months += 1;
      cur.tempSum += mp.temp; cur.nightSum += mp.night;
      cur.spentEnd = spent;
    } else {
      if (cur) building.push(cur);
      cur = {
        i: building.length,
        city: mp.city, zh: mp.zh, prov: mp.prov,
        lng: mp.lng, lat: mp.lat,
        age: mp.age, band: mp.band,
        startY: mp.y, startM: mp.m, endY: mp.y, endM: mp.m,
        months: 1, cost: mp.cost, spentEnd: spent,
        temp: 0, night: 0, season: seasonOf(mp.m), scale: 1,
        tempSum: mp.temp, nightSum: mp.night,
      };
    }
  }
  if (cur) building.push(cur);
  const segments: Segment[] = building.map(({ tempSum, nightSum, ...rest }) => ({
    ...rest,
    temp: Math.round(tempSum / rest.months),
    night: Math.round(nightSum / rest.months),
    scale: scaleFor(rest.months),
  }));

  const data = {
    seed: input.seed,
    initial: input.finance.initial_portfolio_usd,
    cities: input.cities.map((c) => [Number(c.lng.toFixed(2)), Number(c.lat.toFixed(2))]),
    segments,
    portfolioByAge: Object.fromEntries(input.finance.trajectories.map((t) => [t.age, t.p50])),
  };

  const span = months.length ? `${months[0].y}–${months[months.length - 1].y}` : "";
  const firstSeason: Season = segments[0]?.season ?? "winter";

  // Pre-render the segment cards server-side (data-first: data.map -> node).
  // Each carries its --time-scale and data-season; client JS only toggles state.
  // A purple 🌈 Transition mark is interleaved between stays (chapter breaks).
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const cardsHtml = segments
    .map((s) => {
      const range =
        s.startY === s.endY && s.startM === s.endM
          ? `${MON[s.startM - 1]} ${s.startY}`
          : `${MON[s.startM - 1]} ${s.startY} – ${MON[s.endM - 1]} ${s.endY}`;
      const dur = s.months === 1 ? "1 month" : `${s.months} months`;
      const xfer =
        s.i > 0
          ? `<div class="xfer" aria-hidden="true"><span class="xfer__dot">🌈</span><span class="xfer__lab">Transition Week</span></div>`
          : "";
      return (
        xfer +
        `<article class="seg" id="seg${s.i}" data-i="${s.i}" data-season="${s.season}" style="--time-scale:${s.scale}">` +
        `<div class="seg__card">` +
        `<div class="seg__head"><span class="seg__season">${SEASON_EMOJI[s.season]} ${SEASON_WORD[s.season]}</span><span class="seg__date">${range} · ${dur}</span></div>` +
        `<div class="seg__city">${s.zh} · ${s.city}</div>` +
        `<div class="seg__meta">${s.prov} · age ${s.age} · ${s.band}</div>` +
        `<div class="seg__nums"><span>${usd(s.cost)}/mo</span><span>${s.temp}°C · nights ${s.night}°C</span></div>` +
        `</div></article>`
      );
    })
    .join("");

  // Month bar — the annual clock (DJF winter · MAM spring · JJA summer · SON autumn).
  const monthCells = MON.map((mn, idx) =>
    `<b data-season="${seasonOf(idx + 1)}" title="${mn}">${mn[0]}</b>`,
  ).join("");

  return `<!doctype html>
<html lang="en" data-season="${firstSeason}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Travel Life OS — Life Timeline</title>
<style>
  /* Registered so the live season vars INTERPOLATE (not snap) at boundaries. */
  @property --sp { syntax: "<color>"; inherits: true; initial-value: #CBD5E1; }
  @property --ss { syntax: "<color>"; inherits: true; initial-value: #94A3B8; }
  @property --sa { syntax: "<color>"; inherits: true; initial-value: #0F172A; }

  :root {
    color-scheme: dark;
    --bg:#0c1320; --panel:#111a2b; --line:#1e2a40; --ink:#dfe6f1; --dim:#7c8aa5;
    --sp:#CBD5E1; --ss:#94A3B8; --sa:#0F172A;     /* live season palette (winter default) */
  }
  /* The v2 seasonal palette — one rule, consumed by BOTH <html> (live/global,
     animated) and each .seg card (static, its own arrival season). */
  [data-season="spring"]{ --sp:#DFF5E3; --ss:#A8E6A3; --sa:#FFF7C2; }
  [data-season="summer"]{ --sp:#7DD3FC; --ss:#38BDF8; --sa:#FEF08A; }
  [data-season="autumn"]{ --sp:#F59E0B; --ss:#D97706; --sa:#92400E; }
  [data-season="winter"]{ --sp:#CBD5E1; --ss:#94A3B8; --sa:#0F172A; }

  * { box-sizing: border-box; }
  /* Smooth ~1.5s seasonal cross-interpolation on the global vars. */
  html { scroll-snap-type: y proximity; scroll-behavior: smooth; scroll-padding: 38vh 0;
         transition: --sp 1.5s ease, --ss 1.5s ease, --sa 1.5s ease; }
  @media (prefers-reduced-motion: reduce){ html{ scroll-behavior:auto; transition:none; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }

  /* Subtle full-bleed seasonal wash over the dark base — tracks the live var,
     so it eases Green→Blue→Orange→Gray as you scroll through the years. */
  .seasonbg{ position:fixed; inset:0; z-index:-1; background:var(--bg);
    background-image:radial-gradient(135% 95% at 50% -5%, color-mix(in srgb, var(--ss) 20%, var(--bg)), var(--bg) 60%); }

  /* Season badge — fixed corner, gentle breathe. Text stays white (readable on
     any season); the emoji + glow carry the color cue. */
  .seasonbadge{ position:fixed; top:14px; right:16px; z-index:20; display:flex; align-items:center; gap:7px;
    padding:7px 13px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.14em;
    color:#f4f8ff; background:color-mix(in srgb, var(--ss) 20%, rgba(12,19,32,.72)); backdrop-filter:blur(7px);
    border:1px solid color-mix(in srgb, var(--ss) 55%, var(--line));
    box-shadow:0 6px 24px -10px color-mix(in srgb, var(--ss) 80%, #000);
    transition:background 1.5s ease, border-color 1.5s ease, box-shadow 1.5s ease;
    animation:breathe 5s ease-in-out infinite; }
  @keyframes breathe { 0%,100%{ transform:scale(1); opacity:.92 } 50%{ transform:scale(1.035); opacity:1 } }

  .wrap { max-width:1100px; margin:0 auto; padding:26px 20px 0; }
  h1 { font-size:21px; margin:0 0 2px; }
  .sub { color:var(--dim); font-size:13px; margin:0 0 18px; }

  .osframe { display:grid; grid-template-columns:minmax(320px, 1fr) minmax(300px, 380px); gap:26px; align-items:start; }

  /* Sticky map + live readout — the cognitive anchor while you scroll. Borders
     pick up a faint season tint that eases with the global var. */
  .deck { position:sticky; top:18px; }
  .mapwrap { background:var(--panel); border:1px solid color-mix(in srgb, var(--ss) 24%, var(--line)); border-radius:14px; padding:8px;
    transition:border-color 1.5s ease; }
  svg#map { width:100%; height:auto; display:block; }

  /* Month bar — the annual clock. */
  .monthbar{ display:grid; grid-template-columns:repeat(12,1fr); gap:3px; margin:12px 2px 0; }
  .monthbar b{ font:600 10px/1 ui-monospace,Menlo,monospace; text-align:center; padding:5px 0; border-radius:5px;
    color:#0b1220; opacity:.34; transition:opacity .4s ease, box-shadow .4s ease, transform .4s ease; }
  .monthbar b[data-season="spring"]{ background:#A8E6A3; }
  .monthbar b[data-season="summer"]{ background:#38BDF8; }
  .monthbar b[data-season="autumn"]{ background:#D97706; }
  .monthbar b[data-season="winter"]{ background:#94A3B8; }
  .monthbar b.now{ opacity:.9; }
  .monthbar b.now-start{ opacity:1; transform:translateY(-1px); box-shadow:0 0 0 2px var(--bg), 0 0 0 3px #fff; }

  .lifebar { height:4px; background:var(--line); border-radius:999px; margin:12px 2px 14px; overflow:hidden; }
  .lifebar i { display:block; height:100%; width:0; background:linear-gradient(90deg, var(--ss), var(--sp)); border-radius:999px;
    transition:width .4s ease, background 1.5s ease; }
  .readout { background:var(--panel); border:1px solid color-mix(in srgb, var(--ss) 22%, var(--line)); border-radius:14px; padding:18px 20px;
    transition:border-color 1.5s ease; }
  .phase { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; padding:3px 10px; border-radius:999px; background:var(--line); color:#9fd0ff; margin-bottom:8px; }
  .date { color:var(--dim); font-size:13px; }
  .city { font-size:26px; font-weight:680; margin:3px 0 2px; }
  .meta { color:#9fb0cc; margin-bottom:14px; }
  .stats > div { display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; border-top:1px solid #1b2740; }
  .stats span { color:var(--dim); font-size:12.5px; }
  .stats b { font-size:17px; font-weight:650; }
  .mood { margin-top:13px; font-size:12px; color:color-mix(in srgb, var(--ss) 60%, var(--ink)); letter-spacing:.02em; transition:color 1.5s ease; }
  .legend { color:#5d6a85; font-size:11.5px; margin-top:10px; }
  @keyframes pulse { 0%{r:7;opacity:.5} 70%{r:15;opacity:0} 100%{opacity:0} }
  #halo { animation: pulse 1.7s ease-out infinite; }

  /* The timeline column: one card per stay, density-scaled, season-accented. */
  .timeline { padding-block: 38vh; display:flex; flex-direction:column; gap:4px; }

  /* Transition mark between stays — psychologically separates two chapters.
     Subtle by default; lights up (label appears) when its next stay is active. */
  .xfer{ display:flex; align-items:center; justify-content:center; gap:9px; min-height:24px; opacity:.45;
    transition:opacity .45s ease; }
  .xfer::before,.xfer::after{ content:""; height:1px; width:30px; }
  .xfer::before{ background:linear-gradient(90deg, transparent, #A855F7); }
  .xfer::after{ background:linear-gradient(90deg, #A855F7, transparent); }
  .xfer__dot{ font-size:13px; }
  .xfer__lab{ font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:#c4b5fd; opacity:0; transition:opacity .45s ease; white-space:nowrap; }
  .xfer.lit{ opacity:1; }
  .xfer.lit .xfer__lab{ opacity:1; }

  .seg {
    scroll-snap-align:center;
    min-height: calc(108px * var(--time-scale));     /* non-linear time scaling */
    content-visibility:auto;                          /* native off-screen culling */
    contain-intrinsic-size: auto calc(108px * var(--time-scale));
    display:flex; align-items:center;
    opacity:.42; transform:translateY(0);
    transition:opacity .45s ease, transform .45s ease;
  }
  .seg:not(.in){ opacity:0; transform:translateY(26px); }   /* lazy reveal on enter */
  .seg.near{ opacity:.7; }
  .seg__card{
    width:100%; background:color-mix(in srgb, var(--ss) 7%, var(--panel));   /* subtle seasonal tint */
    border:1px solid var(--line);
    border-left:3px solid color-mix(in srgb, var(--ss) 70%, var(--line));
    border-radius:14px; padding:16px 18px; transition:box-shadow .45s ease, border-color .45s ease;
  }
  .seg.is-active{ opacity:1; }
  .seg.is-active .seg__card{
    border-color:color-mix(in srgb, var(--ss) 45%, var(--line));
    box-shadow:0 0 0 1px color-mix(in srgb, var(--ss) 30%, transparent), 0 16px 46px -18px color-mix(in srgb, var(--ss) 70%, #000);
  }
  .seg__head{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px; }
  .seg__season{ font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:color-mix(in srgb, var(--ss) 78%, #fff); }
  .seg__date{ color:var(--dim); font-size:12px; }
  .seg__city{ font-size:19px; font-weight:660; }
  .seg__meta{ color:#9fb0cc; font-size:12.5px; margin-top:1px; }
  .seg__nums{ display:flex; justify-content:space-between; color:var(--dim); font-size:12.5px; margin-top:9px; padding-top:9px; border-top:1px solid #1b2740; }

  @media (max-width:880px){
    .osframe{ grid-template-columns:1fr; gap:14px; }
    .deck{ top:0; z-index:5; background:linear-gradient(var(--bg) 78%, transparent); padding:8px 0 10px; }
    svg#map{ max-height:30vh; }
    .timeline{ padding-block:30vh; }
    .seasonbadge{ top:auto; bottom:14px; }
  }
</style></head>
<body>
<div class="seasonbg"></div>
<div class="seasonbadge" id="seasonbadge" aria-live="polite">❄ WINTER</div>
<div class="wrap">
  <h1>🗺️ Travel Life OS — Life Timeline</h1>
  <p class="sub">Scroll = time. ${segments.length} stays across ${months.length} months (${span}); the map fills in your route and the whole UI eases through the seasons — 🌱 → 🌊 → 🍂 → ❄ — so you live through years, not 2,348 cities. · seed ${input.seed}</p>

  <div class="osframe">
    <div class="deck">
      <div class="mapwrap">
        <svg id="map" viewBox="0 0 620 470" preserveAspectRatio="xMidYMid meet">
          <g id="dots"></g>
          <polyline id="trail" fill="none" stroke="#4f8bff" stroke-width="2" stroke-opacity="0.55" stroke-linejoin="round" stroke-linecap="round"/>
          <g id="visited"></g>
          <circle id="halo" r="9" fill="#e0a13a"/>
          <circle id="marker" r="5.5" fill="#ffcf5a" stroke="#0c1320" stroke-width="1.6"/>
        </svg>
      </div>
      <div class="monthbar" id="monthbar" title="Annual clock — current stay's months are lit">${monthCells}</div>
      <div class="lifebar"><i id="lifefill"></i></div>
      <div class="readout">
        <div class="phase" id="phase"></div>
        <div class="date" id="date"></div>
        <div class="city" id="city"></div>
        <div class="meta" id="meta"></div>
        <div class="stats">
          <div><span>This month</span><b id="cost"></b></div>
          <div><span>Spent since age 50</span><b id="spent"></b></div>
          <div><span>Median portfolio left</span><b id="rem"></b></div>
        </div>
        <div class="mood" id="mood"></div>
        <div class="legend">Faint dots = all ${input.cities.length} candidate cities. Each card is one stay; height ≈ pace, colour = the season you arrive in. The whole UI eases between seasonal palettes as you scroll. Portfolio is the median Monte-Carlo path. Planning model, not advice.</div>
      </div>
    </div>

    <main class="timeline" id="timeline">${cardsHtml}</main>
  </div>
</div>
<script>
var DATA = ${JSON.stringify(data)};
var SEG = DATA.segments;
var W=620,H=470,P=26, LNG0=73,LNG1=135,LAT0=17,LAT1=54;
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var SEMOJI={spring:"🌱",summer:"🌊",autumn:"🍂",winter:"❄"};
var SWORD={spring:"Spring",summer:"Summer",autumn:"Autumn",winter:"Winter"};
var SMOOD={spring:["Study","Build","Learn"],summer:["Hiking","Sports","Exploration"],autumn:["Writing","Reading","Long projects"],winter:["Review","Planning","Recovery"]};
function px(lng){ return P + ((lng-LNG0)/(LNG1-LNG0))*(W-2*P); }
function py(lat){ return P + ((LAT1-lat)/(LAT1-LAT0))*(H-2*P); }
function usd(n){ return "$"+Math.round(n).toLocaleString("en-US"); }

var nodes=[], monthCells=[], active=-1, litXfer=null;

function init(){
  // Faint candidate-city dots (the route's possibility space).
  var d="";
  for(var k=0;k<DATA.cities.length;k++){
    var c=DATA.cities[k];
    d+='<circle cx="'+px(c[0]).toFixed(1)+'" cy="'+py(c[1]).toFixed(1)+'" r="1.8" fill="#46618f" opacity="0.85"/>';
  }
  document.getElementById("dots").innerHTML=d;

  nodes=[].slice.call(document.querySelectorAll(".seg"));
  monthCells=[].slice.call(document.querySelectorAll("#monthbar b"));

  // Reveal observer — cards fade/slide in as they enter (lazy, no work off-screen).
  var reveal=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting) e.target.classList.add("in"); });
  }, { rootMargin:"0px 0px -8% 0px", threshold:0.01 });
  nodes.forEach(function(n){ reveal.observe(n); });

  // Active observer — the card crossing the viewport centre band IS "now".
  // Scroll position alone drives time AND the season engine; no setInterval.
  var center=new IntersectionObserver(function(es){
    var best=null, bestRatio=0;
    es.forEach(function(e){ if(e.isIntersecting && e.intersectionRatio>=bestRatio){ bestRatio=e.intersectionRatio; best=e.target; } });
    if(best) setActive(+best.getAttribute("data-i"));
  }, { rootMargin:"-46% 0px -46% 0px", threshold:[0,0.5,1] });
  nodes.forEach(function(n){ center.observe(n); });

  // Optional focus nav: arrows jump stay-to-stay (still scroll, not autoplay).
  document.addEventListener("keydown", function(ev){
    if(ev.key==="ArrowDown"||ev.key==="ArrowRight"){ jump(1); ev.preventDefault(); }
    else if(ev.key==="ArrowUp"||ev.key==="ArrowLeft"){ jump(-1); ev.preventDefault(); }
  });

  setActive(0);
}

function jump(dir){
  var t=Math.max(0, Math.min(SEG.length-1, (active<0?0:active)+dir));
  var el=document.getElementById("seg"+t);
  if(el) el.scrollIntoView({ block:"center", behavior:"smooth" });
}

function setActive(i){
  if(i===active || !SEG[i]) return;
  active=i;
  var s=SEG[i];

  // ── Season Engine: ease the whole UI into this stay's season ──
  document.documentElement.setAttribute("data-season", s.season);
  var badge=document.getElementById("seasonbadge");
  badge.textContent = SEMOJI[s.season]+" "+SWORD[s.season].toUpperCase();
  document.getElementById("mood").textContent = SEMOJI[s.season]+" in season · "+SMOOD[s.season].join(" · ");
  // Annual clock: light the months this stay spans (start month strongest).
  for(var c=0;c<monthCells.length;c++){ monthCells[c].classList.remove("now","now-start"); }
  for(var k=0;k<s.months;k++){
    var mi=((s.startM-1)+k)%12, cell=monthCells[mi];
    if(cell){ cell.classList.add("now"); if(k===0) cell.classList.add("now-start"); }
  }
  // Transition mark: light the chapter break leading into this stay.
  if(litXfer){ litXfer.classList.remove("lit"); litXfer=null; }
  var prev=nodes[i] ? nodes[i].previousElementSibling : null;
  if(prev && prev.classList.contains("xfer")){ prev.classList.add("lit"); litXfer=prev; }

  // Focus mode: highlight current, fade neighbours.
  for(var n=0;n<nodes.length;n++){ nodes[n].classList.remove("is-active","near"); }
  if(nodes[i]) nodes[i].classList.add("is-active");
  if(nodes[i-1]) nodes[i-1].classList.add("near");
  if(nodes[i+1]) nodes[i+1].classList.add("near");

  // Route footprint up to here.
  var pts=[], vis="";
  for(var j=0;j<=i;j++){
    var x=px(SEG[j].lng), y=py(SEG[j].lat);
    pts.push(x.toFixed(1)+","+y.toFixed(1));
    vis+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2.6" fill="#4f8bff" opacity="0.45"/>';
  }
  document.getElementById("trail").setAttribute("points", pts.join(" "));
  document.getElementById("visited").innerHTML=vis;
  var cx=px(s.lng), cy=py(s.lat);
  document.getElementById("marker").setAttribute("cx",cx);
  document.getElementById("marker").setAttribute("cy",cy);
  document.getElementById("halo").setAttribute("cx",cx);
  document.getElementById("halo").setAttribute("cy",cy);

  // Live readout.
  var range = (s.startY===s.endY && s.startM===s.endM)
    ? MON[s.startM-1]+" "+s.startY
    : MON[s.startM-1]+" "+s.startY+" – "+MON[s.endM-1]+" "+s.endY;
  document.getElementById("phase").textContent = s.band;
  document.getElementById("date").textContent = range+"  ·  age "+s.age;
  document.getElementById("city").textContent = s.zh+" · "+s.city;
  document.getElementById("meta").textContent = s.prov+"  ·  "+s.temp+"°C · nights "+s.night+"°C";
  document.getElementById("cost").textContent = usd(s.cost)+" / mo";
  document.getElementById("spent").textContent = usd(s.spentEnd);
  var rem = DATA.portfolioByAge[s.age];
  var remEl=document.getElementById("rem");
  remEl.textContent = (rem!=null) ? usd(rem) : "—";
  remEl.style.color = (rem>200000) ? "#46b97a" : (rem>50000) ? "#e0a13a" : "#e0563a";
  document.getElementById("lifefill").style.width = (((i+1)/SEG.length)*100).toFixed(1)+"%";
}

if(document.readyState!=="loading") init();
else document.addEventListener("DOMContentLoaded", init);
</script>
</body></html>`;
}
