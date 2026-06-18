// Life Timeline OS — interaction-driven, scroll-as-time navigation.
//
// Not a slideshow and not an autoplay loop. The page itself is the timeline:
// you scroll through your life and the sticky map fills in your route footprint
// as you go. The 372 months collapse into city-stay *segments* (one card per
// place you live) — the low-entropy unit. Scroll position drives everything via
// IntersectionObserver; there is no setInterval, no fixed-speed playback.
//
// Cognitive system layered on top:
//   • Non-linear time — fast travel (short stays) expands, settling compresses,
//     so visual density ≈ cognitive density (--time-scale per segment).
//   • Seasonal colour — each segment is tagged with the season it begins in
//     (N. hemisphere), driving a crossfading background band + card accent.
//   • content-visibility:auto culls off-screen cards natively (real
//     virtualization at this scale; 163 nodes ≪ the ~1000 where JS windowing
//     would start to pay off).
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
// on arrival, not decoration — it maps to cognition: spring=start/planning,
// summer=peak activity, autumn=transition, winter=rest/low-entropy.
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

  // Pre-render the segment cards server-side (data-first: data.map -> node).
  // Each carries its --time-scale and data-season; client JS only toggles state.
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const cardsHtml = segments
    .map((s) => {
      const range =
        s.startY === s.endY && s.startM === s.endM
          ? `${MON[s.startM - 1]} ${s.startY}`
          : `${MON[s.startM - 1]} ${s.startY} – ${MON[s.endM - 1]} ${s.endY}`;
      const dur = s.months === 1 ? "1 month" : `${s.months} months`;
      return (
        `<article class="seg" id="seg${s.i}" data-i="${s.i}" data-season="${s.season}" style="--time-scale:${s.scale}">` +
        `<div class="seg__card">` +
        `<div class="seg__head"><span class="seg__season">${s.season}</span><span class="seg__date">${range} · ${dur}</span></div>` +
        `<div class="seg__city">${s.zh} · ${s.city}</div>` +
        `<div class="seg__meta">${s.prov} · age ${s.age} · ${s.band}</div>` +
        `<div class="seg__nums"><span>${usd(s.cost)}/mo</span><span>${s.temp}°C · nights ${s.night}°C</span></div>` +
        `</div></article>`
      );
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Travel Life OS — Life Timeline</title>
<style>
  :root {
    color-scheme: dark;
    --bg:#0c1320; --panel:#111a2b; --line:#1e2a40; --ink:#dfe6f1; --dim:#7c8aa5;
    /* Seasonal cognitive palette */
    --spring: hsl(140, 30%, 85%);
    --summer: hsl(30, 90%, 65%);
    --autumn: hsl(15, 60%, 50%);
    --winter: hsl(200, 40%, 80%);
  }
  * { box-sizing: border-box; }
  html { scroll-snap-type: y proximity; scroll-behavior: smooth; scroll-padding: 38vh 0; }
  @media (prefers-reduced-motion: reduce){ html{ scroll-behavior:auto; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }

  /* Crossfading seasonal background bands (subtle tint over the dark base). */
  .seasonbg{ position:fixed; inset:0; z-index:-1; background:var(--bg); }
  .seasonbg .sb{ position:absolute; inset:0; opacity:0; transition:opacity .8s ease; }
  .seasonbg .sb.on{ opacity:1; }
  .sb[data-season="spring"]{ background:radial-gradient(130% 90% at 28% 0%, color-mix(in srgb, var(--spring) 17%, var(--bg)), var(--bg) 62%); }
  .sb[data-season="summer"]{ background:radial-gradient(130% 90% at 72% 0%, color-mix(in srgb, var(--summer) 18%, var(--bg)), var(--bg) 60%); }
  .sb[data-season="autumn"]{ background:radial-gradient(130% 95% at 50% 5%, color-mix(in srgb, var(--autumn) 17%, var(--bg)), var(--bg) 60%); }
  .sb[data-season="winter"]{ background:radial-gradient(130% 95% at 50% 0%, color-mix(in srgb, var(--winter) 14%, var(--bg)), var(--bg) 64%); }

  .wrap { max-width:1100px; margin:0 auto; padding:26px 20px 0; }
  h1 { font-size:21px; margin:0 0 2px; }
  .sub { color:var(--dim); font-size:13px; margin:0 0 18px; }

  .osframe { display:grid; grid-template-columns:minmax(320px, 1fr) minmax(300px, 380px); gap:26px; align-items:start; }

  /* Sticky map + live readout — the cognitive anchor while you scroll. */
  .deck { position:sticky; top:18px; }
  .mapwrap { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:8px; }
  svg#map { width:100%; height:auto; display:block; }
  .lifebar { height:4px; background:var(--line); border-radius:999px; margin:12px 2px 14px; overflow:hidden; }
  .lifebar i { display:block; height:100%; width:0; background:linear-gradient(90deg,#4f8bff,#9fd0ff); border-radius:999px; transition:width .4s ease; }
  .readout { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
  .phase { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; padding:3px 10px; border-radius:999px; background:var(--line); color:#9fd0ff; margin-bottom:8px; }
  .date { color:var(--dim); font-size:13px; }
  .city { font-size:26px; font-weight:680; margin:3px 0 2px; }
  .meta { color:#9fb0cc; margin-bottom:14px; }
  .stats > div { display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; border-top:1px solid #1b2740; }
  .stats span { color:var(--dim); font-size:12.5px; }
  .stats b { font-size:17px; font-weight:650; }
  .legend { color:#5d6a85; font-size:11.5px; margin-top:14px; }
  @keyframes pulse { 0%{r:7;opacity:.5} 70%{r:15;opacity:0} 100%{opacity:0} }
  #halo { animation: pulse 1.7s ease-out infinite; }

  /* The timeline column: one card per stay, density-scaled, season-accented. */
  .timeline { padding-block: 38vh; display:flex; flex-direction:column; gap:10px; }
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
    width:100%; background:var(--panel); border:1px solid var(--line);
    border-left:3px solid color-mix(in srgb, var(--season-c) 65%, var(--line));
    border-radius:14px; padding:16px 18px; transition:box-shadow .45s ease, border-color .45s ease;
  }
  .seg.is-active{ opacity:1; }
  .seg.is-active .seg__card{
    border-color:color-mix(in srgb, var(--season-c) 45%, var(--line));
    box-shadow:0 0 0 1px color-mix(in srgb, var(--season-c) 30%, transparent), 0 16px 46px -18px color-mix(in srgb, var(--season-c) 70%, #000);
  }
  .seg[data-season="spring"]{ --season-c:var(--spring); }
  .seg[data-season="summer"]{ --season-c:var(--summer); }
  .seg[data-season="autumn"]{ --season-c:var(--autumn); }
  .seg[data-season="winter"]{ --season-c:var(--winter); }
  .seg__head{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px; }
  .seg__season{ font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:color-mix(in srgb, var(--season-c) 78%, #fff); }
  .seg__date{ color:var(--dim); font-size:12px; }
  .seg__city{ font-size:19px; font-weight:660; }
  .seg__meta{ color:#9fb0cc; font-size:12.5px; margin-top:1px; }
  .seg__nums{ display:flex; justify-content:space-between; color:var(--dim); font-size:12.5px; margin-top:9px; padding-top:9px; border-top:1px solid #1b2740; }

  @media (max-width:880px){
    .osframe{ grid-template-columns:1fr; gap:14px; }
    .deck{ top:0; z-index:5; background:linear-gradient(var(--bg) 78%, transparent); padding:8px 0 10px; }
    svg#map{ max-height:30vh; }
    .timeline{ padding-block:30vh; }
  }
</style></head>
<body>
<div class="seasonbg"><div class="sb" data-season="spring"></div><div class="sb" data-season="summer"></div><div class="sb" data-season="autumn"></div><div class="sb" data-season="winter"></div></div>
<div class="wrap">
  <h1>🗺️ Travel Life OS — Life Timeline</h1>
  <p class="sub">Scroll = time. ${segments.length} stays across ${months.length} months (${span}); the map fills in your route as you go. Fast travel expands, settling compresses. · seed ${input.seed}</p>

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
        <div class="legend">Faint dots = all ${input.cities.length} candidate cities. Each card is one stay; height ≈ pace (rapid travel taller, settled shorter). Colour = the season you arrive in. Portfolio is the median Monte-Carlo path. Planning model, not advice.</div>
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
function px(lng){ return P + ((lng-LNG0)/(LNG1-LNG0))*(W-2*P); }
function py(lat){ return P + ((LAT1-lat)/(LAT1-LAT0))*(H-2*P); }
function usd(n){ return "$"+Math.round(n).toLocaleString("en-US"); }

var nodes=[], active=-1;
var seasonLayers={};

function init(){
  // Faint candidate-city dots (the route's possibility space).
  var d="";
  for(var k=0;k<DATA.cities.length;k++){
    var c=DATA.cities[k];
    d+='<circle cx="'+px(c[0]).toFixed(1)+'" cy="'+py(c[1]).toFixed(1)+'" r="1.8" fill="#46618f" opacity="0.85"/>';
  }
  document.getElementById("dots").innerHTML=d;

  var sbs=document.querySelectorAll(".seasonbg .sb");
  for(var s=0;s<sbs.length;s++){ seasonLayers[sbs[s].getAttribute("data-season")]=sbs[s]; }

  nodes=[].slice.call(document.querySelectorAll(".seg"));

  // Reveal observer — cards fade/slide in as they enter (lazy, no work off-screen).
  var reveal=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting) e.target.classList.add("in"); });
  }, { rootMargin:"0px 0px -8% 0px", threshold:0.01 });
  nodes.forEach(function(n){ reveal.observe(n); });

  // Active observer — the card crossing the viewport centre band IS "now".
  // Scroll position alone drives time; no setInterval, no playback loop.
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
  var prev=active; active=i;
  var s=SEG[i];

  // Focus mode: highlight current, fade neighbours.
  for(var k=0;k<nodes.length;k++){ nodes[k].classList.remove("is-active","near"); }
  if(nodes[i]) nodes[i].classList.add("is-active");
  if(nodes[i-1]) nodes[i-1].classList.add("near");
  if(nodes[i+1]) nodes[i+1].classList.add("near");

  // Seasonal background crossfade.
  for(var key in seasonLayers){ seasonLayers[key].classList.toggle("on", key===s.season); }

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
