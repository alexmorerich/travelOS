// Interactive timeline demo (self-contained HTML, no server, no CDN).
//
// Scrub or play through all 372 months of the 30-year plan. At each step the
// map shows your route "footprint" growing across China, and the side panel
// shows exactly where you are, the monthly cost, total spent so far, and the
// median portfolio remaining. Data is inlined so it opens straight from disk.
import { bandForAge } from "../core_engine/routing_engine";
import type { ScheduleYear, ProcessedCity, FinanceResult } from "../types";

export interface TimelineInput {
  schedule: ScheduleYear[];
  cities: ProcessedCity[];
  finance: FinanceResult;
  seed: number;
}

interface MonthPoint {
  y: number; m: number; age: number;
  city: string; zh: string; prov: string;
  lng: number; lat: number; cost: number; temp: number; band: string;
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
        band: bandForAge(yr.age).label,
      };
    }),
  );

  const data = {
    seed: input.seed,
    initial: input.finance.initial_portfolio_usd,
    cities: input.cities.map((c) => [Number(c.lng.toFixed(2)), Number(c.lat.toFixed(2))]),
    months,
    portfolioByAge: Object.fromEntries(input.finance.trajectories.map((t) => [t.age, t.p50])),
  };

  const span = months.length
    ? `${months[0].y}–${months[months.length - 1].y}`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Travel Life OS — Interactive Timeline</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0c1320; color:#dfe6f1; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:1040px; margin:0 auto; padding:26px 20px 60px; }
  h1 { font-size:21px; margin:0 0 2px; }
  .sub { color:#7c8aa5; font-size:13px; margin:0 0 20px; }
  .stage { display:flex; gap:20px; flex-wrap:wrap; }
  .mapwrap { flex:1 1 560px; background:#111a2b; border:1px solid #1e2a40; border-radius:14px; padding:8px; }
  svg#map { width:100%; height:auto; display:block; }
  .panel { flex:1 1 280px; background:#111a2b; border:1px solid #1e2a40; border-radius:14px; padding:20px 22px; min-width:260px; }
  .phase { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; padding:3px 10px; border-radius:999px; background:#1e2a40; color:#9fd0ff; margin-bottom:9px; }
  .date { color:#7c8aa5; font-size:13px; letter-spacing:.03em; }
  .city { font-size:30px; font-weight:680; margin:4px 0 2px; }
  .meta { color:#9fb0cc; margin-bottom:18px; }
  .stats > div { display:flex; justify-content:space-between; align-items:baseline; padding:9px 0; border-top:1px solid #1b2740; }
  .stats span { color:#7c8aa5; font-size:12.5px; }
  .stats b { font-size:18px; font-weight:650; }
  .scrubber { display:flex; align-items:center; gap:14px; margin-top:22px; }
  #play { background:#1e2a40; color:#dfe6f1; border:1px solid #2a3a55; border-radius:8px; padding:8px 14px; font-size:14px; cursor:pointer; white-space:nowrap; }
  #play:hover { background:#26344f; }
  #scrub { flex:1; accent-color:#4f8bff; }
  #monthlabel { color:#7c8aa5; font-size:12px; min-width:128px; text-align:right; }
  .legend { color:#5d6a85; font-size:11.5px; margin-top:16px; }
  @keyframes pulse { 0%{r:7;opacity:.5} 70%{r:15;opacity:0} 100%{opacity:0} }
  #halo { animation: pulse 1.7s ease-out infinite; }
</style></head>
<body><div class="wrap">
  <h1>🗺️ Travel Life OS — Interactive Timeline</h1>
  <p class="sub">Scrub or ▶ Play across ${months.length} months (${span}). The trail is your route footprint; the panel shows where you are and what it costs. · seed ${input.seed}</p>

  <div class="stage">
    <div class="mapwrap">
      <svg id="map" viewBox="0 0 620 470" preserveAspectRatio="xMidYMid meet">
        <g id="dots"></g>
        <polyline id="trail" fill="none" stroke="#4f8bff" stroke-width="2" stroke-opacity="0.55" stroke-linejoin="round" stroke-linecap="round"/>
        <g id="visited"></g>
        <circle id="halo" r="9" fill="#e0a13a"/>
        <circle id="marker" r="5.5" fill="#ffcf5a" stroke="#0c1320" stroke-width="1.6"/>
      </svg>
    </div>
    <div class="panel">
      <div class="phase" id="phase"></div>
      <div class="date" id="date"></div>
      <div class="city" id="city"></div>
      <div class="meta" id="meta"></div>
      <div class="stats">
        <div><span>This month</span><b id="cost"></b></div>
        <div><span>Spent since age 50</span><b id="spent"></b></div>
        <div><span>Median portfolio left</span><b id="rem"></b></div>
      </div>
      <div class="legend">Faint dots = all ${input.cities.length} cities. The phase badge is the lifecycle band (Expedition → Cultural → Comfort). Cost is the city's monthly living cost; portfolio is the median Monte-Carlo path (incl. returns). Planning model, not advice.</div>
    </div>
  </div>

  <div class="scrubber">
    <button id="play">▶ Play</button>
    <input id="scrub" type="range" min="0" max="${Math.max(0, months.length - 1)}" value="0"/>
    <span id="monthlabel"></span>
  </div>
</div>
<script>
var DATA = ${JSON.stringify(data)};
var W=620,H=470,P=26, LNG0=73,LNG1=135,LAT0=17,LAT1=54;
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function px(lng){ return P + ((lng-LNG0)/(LNG1-LNG0))*(W-2*P); }
function py(lat){ return P + ((LAT1-lat)/(LAT1-LAT0))*(H-2*P); }
function usd(n){ return "$"+Math.round(n).toLocaleString("en-US"); }

function init(){
  var d="";
  for(var k=0;k<DATA.cities.length;k++){
    var c=DATA.cities[k];
    d+='<circle cx="'+px(c[0]).toFixed(1)+'" cy="'+py(c[1]).toFixed(1)+'" r="1.6" fill="#2a3a55"/>';
  }
  document.getElementById("dots").innerHTML=d;
  var s=document.getElementById("scrub");
  s.addEventListener("input", function(){ render(+s.value); });
  document.getElementById("play").addEventListener("click", toggle);
  render(0);
}

function render(i){
  var m=DATA.months[i];
  if(!m) return;
  var pts=[], vis="", last=null, spent=0;
  for(var k=0;k<=i;k++){
    var mm=DATA.months[k];
    spent+=mm.cost;
    var key=mm.city+mm.prov;
    if(key!==last){
      var x=px(mm.lng), y=py(mm.lat);
      pts.push(x.toFixed(1)+","+y.toFixed(1));
      vis+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2.6" fill="#4f8bff" opacity="0.45"/>';
      last=key;
    }
  }
  document.getElementById("trail").setAttribute("points", pts.join(" "));
  document.getElementById("visited").innerHTML=vis;
  var cx=px(m.lng), cy=py(m.lat);
  document.getElementById("marker").setAttribute("cx",cx);
  document.getElementById("marker").setAttribute("cy",cy);
  document.getElementById("halo").setAttribute("cx",cx);
  document.getElementById("halo").setAttribute("cy",cy);

  document.getElementById("phase").textContent = m.band;
  document.getElementById("date").textContent = MON[m.m-1]+" "+m.y+"  ·  age "+m.age;
  document.getElementById("city").textContent = m.zh+" · "+m.city;
  document.getElementById("meta").textContent = m.prov+"  ·  "+m.temp+"°C";
  document.getElementById("cost").textContent = usd(m.cost)+" / mo";
  document.getElementById("spent").textContent = usd(spent);
  var rem = DATA.portfolioByAge[m.age];
  var remEl=document.getElementById("rem");
  remEl.textContent = (rem!=null) ? usd(rem) : "—";
  remEl.style.color = (rem>200000) ? "#46b97a" : (rem>50000) ? "#e0a13a" : "#e0563a";
  document.getElementById("monthlabel").textContent = MON[m.m-1]+" "+m.y+" · "+(i+1)+"/"+DATA.months.length;
  document.getElementById("scrub").value=i;
}

var playing=null;
function toggle(){
  var btn=document.getElementById("play");
  if(playing){ clearInterval(playing); playing=null; btn.textContent="▶ Play"; return; }
  btn.textContent="⏸ Pause";
  playing=setInterval(function(){
    var v=(+document.getElementById("scrub").value)+1;
    if(v > DATA.months.length-1) v=0;
    render(v);
  }, 130);
}

init();
</script>
</body></html>`;
}
