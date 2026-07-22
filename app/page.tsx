"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";

type Station = { id:string; name:string; state:"CA"|"OR"|"WA"; lat:number; lng:number; type:"R"|"S" };
type Prediction = { t:string; v:number; type?:"H"|"L" };
type Point = Prediction & { date:string; minute:number };
type Day = { date:string; points:Point[]; lows:Point[]; highs:Point[]; sunrise:number; sunset:number; sun30Start:number|null; sun30End:number|null };
type WorkWindow = { start:number; end:number };

const TZ = "America/Los_Angeles";
const BUFFER = 30;
const STATES = { CA:"California", OR:"Oregon", WA:"Washington" };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const THRESHOLDS = Array.from({length:201},(_,i)=>Number((-5+i/10).toFixed(1)));
const MIN_WINDOWS = [0,30,60,90,120,180,240,360];
const NOAA_METADATA_API = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const NOAA_DATA_API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
type RangeMode = "7"|"14"|"30"|"month";
type WorkMode = "low"|"high";
const fmtDate = (d:Date) => d.toISOString().slice(0,10);
const addDays = (date:string,n:number) => { const d=new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return fmtDate(d); };
const compact = (s:string) => s.replaceAll("-","");
const today = () => { const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); const v=Object.fromEntries(p.map(x=>[x.type,x.value])); return `${v.year}-${v.month}-${v.day}`; };
const daysInMonth = (key:string) => { const [year,month]=key.split("-").map(Number); return new Date(Date.UTC(year,month,0)).getUTCDate(); };
const monthLabel = (key:string) => { const [year,month]=key.split("-").map(Number); return `${MONTHS[month-1]} ${year}`; };
const shiftMonthKey = (key:string,amount:number) => { const [year,month]=key.split("-").map(Number),d=new Date(Date.UTC(year,month-1+amount,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`; };
const clock = (m:number) => { m=((Math.round(m)%1440)+1440)%1440; const h=Math.floor(m/60), min=m%60; return `${h%12||12}:${String(min).padStart(2,"0")} ${h>=12?"PM":"AM"}`; };
const duration = (m:number) => { const r=Math.max(0,Math.round(m/5)*5), h=Math.floor(r/60), x=r%60; return h ? `${h} hr${x?` ${x} min`:""}` : `${x} min`; };
const labelDate = (s:string) => { const d=new Date(`${s}T12:00:00Z`); return { weekday:new Intl.DateTimeFormat("en-US",{weekday:"short",timeZone:"UTC"}).format(d), month:new Intl.DateTimeFormat("en-US",{month:"short",timeZone:"UTC"}).format(d), day:d.getUTCDate() }; };
const parse = (p:Prediction):Point => { const [date,time]=p.t.split(" "), [h,m]=time.split(":").map(Number); return {...p,date,minute:h*60+m}; };

async function loadStations():Promise<Station[]> {
  const response=await fetch(`${NOAA_METADATA_API}/stations.json?type=tidepredictions`);
  if(!response.ok)throw new Error("Unable to load NOAA tide-prediction stations.");
  const data=await response.json() as {stations?:Array<Record<string,unknown>>};
  return (data.stations??[])
    .filter(station=>station.state==="CA"||station.state==="OR"||station.state==="WA")
    .map(station=>({id:String(station.id),name:String(station.name),state:station.state as Station["state"],lat:Number(station.lat),lng:Number(station.lng),type:(station.type==="S"?"S":"R") as Station["type"]}))
    .sort((a,b)=>a.state.localeCompare(b.state)||a.name.localeCompare(b.name));
}

async function loadDatumAvailability(station:string):Promise<boolean> {
  const response=await fetch(`${NOAA_METADATA_API}/stations/${encodeURIComponent(station)}/datums.json?units=english`);
  if(!response.ok)return false;
  const data=await response.json() as {OrthometricDatum?:string;datums?:Array<{name?:string}>};
  return data.OrthometricDatum==="NAVD88"&&Boolean(data.datums?.some(item=>item.name==="NAVD88"));
}

async function requestPredictions(station:string,begin:string,end:string,datum:"MLLW"|"NAVD",interval:"6"|"hilo"):Promise<Prediction[]|null> {
  const params=new URLSearchParams({product:"predictions",application:"DaylightTideFinder",begin_date:begin,end_date:end,datum,station,time_zone:"lst_ldt",units:"english",interval,format:"json"});
  const response=await fetch(`${NOAA_DATA_API}?${params}`);
  if(!response.ok)return null;
  const data=await response.json() as {predictions?:Array<{t:string;v:string;type?:"H"|"L"}>;error?:unknown};
  return data.predictions?.length&&!data.error?data.predictions.map(prediction=>({...prediction,v:Number(prediction.v)})):null;
}

async function loadPredictions(station:string,begin:string,end:string,datum:"MLLW"|"NAVD") {
  const continuous=await requestPredictions(station,begin,end,datum,"6");
  if(continuous)return {predictions:continuous,sourceInterval:"6" as const};
  const highLow=await requestPredictions(station,begin,end,datum,"hilo");
  if(highLow)return {predictions:highLow,sourceInterval:"hilo" as const};
  throw new Error(datum==="NAVD"?"NAVD88 predictions are not available for this station.":"NOAA did not return predictions for this station.");
}

function solarMinute(date:string,lat:number,lng:number,sunrise:boolean,elevation=-.833) {
  const d=new Date(`${date}T12:00:00Z`), n=Math.floor((d.getTime()-Date.UTC(d.getUTCFullYear(),0,0))/86400000), lh=lng/15;
  const t=n+((sunrise?6:18)-lh)/24, M=.9856*t-3.289;
  let L=M+1.916*Math.sin(Math.PI*M/180)+.02*Math.sin(Math.PI*M/90)+282.634; L=(L%360+360)%360;
  let RA=180/Math.PI*Math.atan(.91764*Math.tan(Math.PI*L/180)); RA=(RA%360+360)%360; RA=(RA+Math.floor(L/90)*90-Math.floor(RA/90)*90)/15;
  const sd=.39782*Math.sin(Math.PI*L/180), cd=Math.cos(Math.asin(sd));
  const zenith=90-elevation,ch=(Math.cos(Math.PI*zenith/180)-sd*Math.sin(Math.PI*lat/180))/(cd*Math.cos(Math.PI*lat/180));
  if(ch < -1 || ch > 1) return null;
  const H=(sunrise?360-180/Math.PI*Math.acos(ch):180/Math.PI*Math.acos(ch))/15;
  const utc=((H+RA-.06571*t-6.622-lh)%24+24)%24, instant=new Date(`${date}T00:00:00Z`); instant.setUTCMinutes(Math.round(utc*60));
  const p=new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(instant), v=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return Number(v.hour)*60+Number(v.minute);
}

function interpolate(points:Point[]) {
  const out:Point[]=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[i], b=points[i+1], at=new Date(`${a.t.replace(" ","T")}:00`).getTime(), bt=new Date(`${b.t.replace(" ","T")}:00`).getTime(), steps=Math.max(1,Math.round((bt-at)/600000));
    for(let n=0;n<steps;n++){ const r=n/steps, e=(1-Math.cos(Math.PI*r))/2, x=new Date(at+r*(bt-at)), date=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`, minute=x.getHours()*60+x.getMinutes(); out.push({t:`${date} ${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`,v:a.v+(b.v-a.v)*e,date,minute}); }
  }
  return out;
}

function linePath(points:Point[],min:number,max:number,w=920,h=190) {
  const spread=Math.max(.2,max-min);
  return points.map((p,i)=>`${i?"L":"M"}${(p.minute/1440*w).toFixed(1)},${(12+(max-p.v)/spread*(h-24)).toFixed(1)}`).join(" ");
}

function tideWindows(points:Point[],threshold:number,mode:WorkMode):WorkWindow[] {
  if(points.length<2)return [];
  const inside=(point:Point)=>mode==="low"?point.v<=threshold:point.v>=threshold;
  const crossing=(a:Point,b:Point)=>a.v===b.v?(a.minute+b.minute)/2:a.minute+(threshold-a.v)/(b.v-a.v)*(b.minute-a.minute);
  const windows:WorkWindow[]=[];
  let start:number|null=inside(points[0])?points[0].minute:null;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],aInside=inside(a),bInside=inside(b);
    if(!aInside&&bInside)start=crossing(a,b);
    if(aInside&&!bInside&&start!==null){windows.push({start,end:crossing(a,b)});start=null;}
  }
  if(start!==null)windows.push({start,end:points.at(-1)!.minute});
  return windows.filter(window=>window.end>window.start);
}

function usableWindows(day:Day,threshold:number,mode:WorkMode,sun30:boolean,includeNight:boolean,minMinutes=0):WorkWindow[] {
  if(sun30&&(day.sun30Start===null||day.sun30End===null))return [];
  const lightStart=sun30?Math.max(day.sunrise+BUFFER,day.sun30Start!):includeNight?0:day.sunrise+BUFFER;
  const lightEnd=sun30?Math.min(day.sunset-BUFFER,day.sun30End!):includeNight?1440:day.sunset-BUFFER;
  return tideWindows(day.points,threshold,mode)
    .map(window=>({start:Math.max(window.start,lightStart),end:Math.min(window.end,lightEnd)}))
    .filter(window=>window.end>window.start&&window.end-window.start>=minMinutes);
}

function pointsInWindow(points:Point[],window:WorkWindow):Point[] {
  const sample=(minute:number)=>{
    const exact=points.find(point=>point.minute===minute);
    if(exact)return exact;
    const after=points.findIndex(point=>point.minute>minute);
    if(after<=0)return points[Math.max(0,after)];
    const a=points[after-1],b=points[after],ratio=(minute-a.minute)/(b.minute-a.minute);
    return {...a,minute,v:a.v+(b.v-a.v)*ratio};
  };
  return [sample(window.start),...points.filter(point=>point.minute>window.start&&point.minute<window.end),sample(window.end)];
}

function MiniCurve({points,threshold}:{points:Point[];threshold:number}) {
  if(points.length<2) return <span className="mini-empty">No curve</span>;
  const min=Math.min(...points.map(p=>p.v),threshold-.2), max=Math.max(...points.map(p=>p.v),threshold+.2), y=12+(max-threshold)/Math.max(.2,max-min)*18;
  return <svg className="mini-curve" viewBox="0 0 132 42" aria-hidden="true"><line x1="0" x2="132" y1={y} y2={y}/><path d={linePath(points,min,max,132,42)}/></svg>;
}

function CoastMap({stations,selected,onSelect}:{stations:Station[];selected?:Station;onSelect:(s:Station)=>void}) {
  const containerRef=useRef<HTMLDivElement>(null),mapRef=useRef<LeafletMap|null>(null),leafletRef=useRef<typeof import("leaflet")|null>(null),markersRef=useRef<Map<string,LeafletMarker>>(new Map());
  const stationsRef=useRef(stations),selectedRef=useRef(selected?.id),onSelectRef=useRef(onSelect);
  useEffect(()=>{stationsRef.current=stations;},[stations]);
  useEffect(()=>{selectedRef.current=selected?.id;},[selected?.id]);
  useEffect(()=>{onSelectRef.current=onSelect;},[onSelect]);
  const icon=useCallback((L:typeof import("leaflet"),active:boolean)=>L.divIcon({className:"station-marker-wrap",html:`<span class="station-marker${active?" active":""}"></span>`,iconSize:[14,14],iconAnchor:[7,7]}),[]);
  const syncMarkers=useCallback((L:typeof import("leaflet"),map:LeafletMap,list:Station[])=>{
    markersRef.current.forEach(marker=>marker.remove());markersRef.current.clear();
    list.forEach(station=>{
      const marker=L.marker([station.lat,station.lng],{icon:icon(L,station.id===selectedRef.current),title:station.name,alt:station.name});
      const tip=document.createElement("span");tip.textContent=station.name;
      marker.bindTooltip(tip,{className:"station-tip",direction:"top",offset:[0,-6]});
      marker.on("click",()=>onSelectRef.current(station));marker.addTo(map);markersRef.current.set(station.id,marker);
    });
    if(list.length){const lats=list.map(s=>s.lat),lngs=list.map(s=>s.lng);map.fitBounds(L.latLngBounds([Math.min(...lats)-.4,Math.min(...lngs)-.4],[Math.max(...lats)+.4,Math.max(...lngs)+.4]));}
  },[icon]);
  useEffect(()=>{
    let disposed=false;
    const markerStore=markersRef.current;
    void import("leaflet").then(L=>{
      if(disposed||!containerRef.current)return;
      const map=L.map(containerRef.current,{zoomControl:true,scrollWheelZoom:false,attributionControl:true});
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:14,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
      mapRef.current=map;leafletRef.current=L;syncMarkers(L,map,stationsRef.current);setTimeout(()=>map.invalidateSize(),0);
    });
    return()=>{disposed=true;markerStore.clear();mapRef.current?.remove();mapRef.current=null;leafletRef.current=null;};
  },[syncMarkers]);
  useEffect(()=>{if(mapRef.current&&leafletRef.current)syncMarkers(leafletRef.current,mapRef.current,stations);},[stations,syncMarkers]);
  useEffect(()=>{const L=leafletRef.current;markersRef.current.forEach((marker,id)=>{marker.setIcon(icon(L!,id===selected?.id));marker.setZIndexOffset(id===selected?.id?1000:0);});},[selected?.id,icon]);
  const larger=selected?`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=12/${selected.lat}/${selected.lng}`:"https://www.openstreetmap.org/";
  return <div className="coast-map-wrap">
    <div ref={containerRef} className="coast-map" aria-label={`Interactive map with ${stations.length} NOAA tide prediction stations. Use the map buttons or double-click to zoom, and drag to pan.`}/>
    <div className="map-caption">{selected&&<><strong>{selected.name}</strong> · NOAA station {selected.id} · {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)} · </>}<a href={larger} target="_blank" rel="noreferrer">view larger map</a> · <span>click any marker to switch stations</span></div>
  </div>;
}

function TideSignature({day,station,threshold,datum,approx,sun30,includeNight,minWindow,workMode}:{day?:Day;station?:Station;threshold:number;datum:"MLLW"|"NAVD";approx:boolean;sun30:boolean;includeNight:boolean;minWindow:number;workMode:WorkMode}) {
  const [hover,setHover]=useState<Point|null>(null);
  if(!day||day.points.length<2) return <div className="empty">Choose a date with available predictions.</div>;

  const rawMin=Math.min(...day.points.map(p=>p.v),threshold-.4),rawMax=Math.max(...day.points.map(p=>p.v),threshold+.4),rawSpread=Math.max(.2,rawMax-rawMin);
  const tickStep=[.1,.2,.5,1,2,5,10].find(step=>rawSpread/step<=5)??10,min=Math.floor(rawMin/tickStep)*tickStep,max=Math.ceil(rawMax/tickStep)*tickStep,spread=Math.max(.2,max-min);
  const LEFT=66,RIGHT=904,TOP=12,BOTTOM=190,xFor=(minute:number)=>LEFT+minute/1440*(RIGHT-LEFT),yFor=(value:number)=>TOP+(max-value)/spread*(BOTTOM-TOP);
  const pathFor=(values:Point[])=>values.map((p,i)=>`${i?"L":"M"}${xFor(p.minute).toFixed(1)},${yFor(p.v).toFixed(1)}`).join(" ");
  const yTicks=Array.from({length:Math.round((max-min)/tickStep)+1},(_,i)=>Number((min+i*tickStep).toFixed(2))),extrema=workMode==="low"?day.lows:day.highs,ty=yFor(threshold),sun30Available=day.sun30Start!==null&&day.sun30End!==null;
  const lightStart=sun30&&sun30Available?Math.max(day.sunrise+BUFFER,day.sun30Start!):includeNight?0:day.sunrise+BUFFER,lightEnd=sun30&&sun30Available?Math.min(day.sunset-BUFFER,day.sun30End!):includeNight?1440:day.sunset-BUFFER;
  const windows=usableWindows(day,threshold,workMode,sun30,includeNight,minWindow),total=windows.reduce((n,w)=>n+w.end-w.start,0),d=labelDate(day.date);
  const datumLabel=datum==="NAVD"?"NAVD88":"MLLW",modeLabel=workMode==="low"?"Low tide work":"High tide work",thresholdLabel=`${workMode==="low"?"Maximum ≤":"Minimum ≥"} ${threshold.toFixed(1)} ft`,minimumWindowLabel=minWindow?`At least ${duration(minWindow)}`:"Any length",sunFilterLabel=sun30?"Applied · sun ≥30°":"Not applied";
  const activeHover=hover?.date===day.date?hover:null,hx=activeHover?xFor(activeHover.minute):0,hy=activeHover?yFor(activeHover.v):0,boxW=154,boxH=58,boxX=activeHover?(hx>RIGHT-boxW-22?hx-boxW-14:hx+14):0,boxY=activeHover?Math.max(TOP+4,Math.min(BOTTOM-boxH-4,hy-boxH/2)):0;
  const updateHover=(event:ReactPointerEvent<SVGSVGElement>)=>{const rect=event.currentTarget.getBoundingClientRect(),svgX=(event.clientX-rect.left)/rect.width*920,target=Math.max(0,Math.min(1440,(svgX-LEFT)/(RIGHT-LEFT)*1440));let nearest=day.points[0];for(const point of day.points)if(Math.abs(point.minute-target)<Math.abs(nearest.minute-target))nearest=point;setHover(nearest);};

  return <div className="signature">
    <header className="signature-summary">
      <div className="signature-title"><p className="eyebrow">Selected field-planning criteria</p><h2>Tide signature · {d.weekday}, {d.month} {d.day}</h2></div>
      <div className="criteria-grid" aria-label="Options used to create this tide signature">
        <span className="criteria-item"><small>Work mode</small><strong>{modeLabel}</strong></span>
        <span className="criteria-item station"><small>NOAA tide station</small><strong>{station?`${station.name} · ${station.id}`:"Station unavailable"}</strong></span>
        <span className="criteria-item"><small>Tide threshold</small><strong>{thresholdLabel}</strong></span>
        <span className="criteria-item"><small>Elevation datum</small><strong>{datumLabel}</strong></span>
        <span className="criteria-item"><small>Minimum work window</small><strong>{minimumWindowLabel}</strong></span>
        <span className="criteria-item"><small>30° sun-angle filter</small><strong>{sunFilterLabel}</strong></span>
      </div>
    </header>
    <section className="work-window-panel" aria-label="Qualifying work window times">
      <div className="work-window-heading"><p className="eyebrow">Qualifying work {windows.length===1?"window":"windows"}</p><span>{workMode==="low"?"Tide at or below":"Tide at or above"} {threshold.toFixed(1)} ft · {datumLabel}</span></div>
      <div className="window-time-list">{windows.length?windows.map((window,index)=><div className="window-time-card" key={index}><small>Window {index+1}</small><div><strong>{clock(window.start)}</strong><i aria-hidden="true">→</i><strong>{clock(window.end)}</strong></div><b>{duration(window.end-window.start)}</b></div>):<div className="no-window prominent">{sun30&&!sun30Available?"The sun does not reach 30° on this date.":minWindow?`No ${workMode}-tide work window lasts at least ${duration(minWindow)}.`:`No usable period ${workMode==="low"?"below":"above"} this threshold.`}</div>}</div>
      <div className="window-total"><span>Total qualifying time</span><strong>{total?duration(total):"None"}</strong></div>
    </section>
    <div className="chart"><svg viewBox="0 0 920 230" role="img" aria-label={`Interactive tide curve for ${day.date}. Move the pointer across the chart for time and elevation.`} onPointerMove={updateHover} onPointerDown={updateHover} onPointerLeave={()=>setHover(null)}>
      <rect x={xFor(day.sunrise)} width={xFor(day.sunset)-xFor(day.sunrise)} y={TOP} height={BOTTOM-TOP} className="sun-band"/>{(!includeNight||sun30)&&(!sun30||sun30Available)&&<rect x={xFor(lightStart)} width={xFor(lightEnd)-xFor(lightStart)} y={TOP} height={BOTTOM-TOP} className="day-band"/>}
      {yTicks.map(tick=><g key={tick}><line x1={LEFT} x2={RIGHT} y1={yFor(tick)} y2={yFor(tick)} className="chart-grid horizontal"/><text x={LEFT-9} y={yFor(tick)+3} textAnchor="end" className="axis-label">{tick.toFixed(tickStep<1?1:0)}</text></g>)}
      {[0,360,720,1080,1440].map(m=><g key={m}><line x1={xFor(m)} x2={xFor(m)} y1={TOP} y2={BOTTOM} className="chart-grid"/><text x={xFor(m)} y="217" textAnchor={m===0?"start":m===1440?"end":"middle"}>{m===0||m===1440?"12a":m===720?"noon":`${m/60}${m<720?"a":"p"}`}</text></g>)}
      <line x1={LEFT} x2={LEFT} y1={TOP} y2={BOTTOM} className="axis-line"/><text x="17" y={(TOP+BOTTOM)/2} transform={`rotate(-90 17 ${(TOP+BOTTOM)/2})`} textAnchor="middle" className="axis-title">Elevation (ft · {datum==="NAVD"?"NAVD88":"MLLW"})</text>
      <line x1={LEFT} x2={RIGHT} y1={ty} y2={ty} className="threshold-line"/><text x={RIGHT-6} y={Math.max(TOP+10,ty-7)} textAnchor="end" className="threshold-text">{workMode==="low"?"≤":"≥"} {threshold.toFixed(1)} ft</text><path d={pathFor(day.points)} className="tide-line"/>{windows.map((window,i)=><path key={i} d={pathFor(pointsInWindow(day.points,window))} className="work-line"/>)}{extrema.map(point=><circle key={point.t} cx={xFor(point.minute)} cy={yFor(point.v)} r="5"/>)}
      {activeHover&&<g className="chart-hover" pointerEvents="none"><line x1={hx} x2={hx} y1={TOP} y2={BOTTOM} className="hover-guide"/><line x1={LEFT} x2={hx} y1={hy} y2={hy} className="hover-guide horizontal"/><circle cx={hx} cy={hy} r="6" className="hover-point"/><g className="chart-tooltip"><rect x={boxX} y={boxY} width={boxW} height={boxH} rx="8"/><text x={boxX+12} y={boxY+21}><tspan className="tooltip-time">{clock(activeHover.minute)}</tspan><tspan x={boxX+12} dy="21" className="tooltip-level">{activeHover.v.toFixed(2)} ft · {datum==="NAVD"?"NAVD88":"MLLW"}</tspan></text></g></g>}
    </svg><div className="chart-footer"><div className="chart-legend" aria-label="Tide chart legend"><span><i className="legend-swatch daylight"/>Orange shade: daylight</span><span className={includeNight&&!sun30?"inactive":""}><i className="legend-swatch allowed"/>{sun30?"Green shade: sun ≥30°":includeNight?"Green shade: working-light filter off":"Green shade: buffered working daylight"}</span><span><i className="legend-stroke"/>Orange curve: qualifying work window</span></div><div className="chart-hint">Move your pointer across the tide line for the predicted time and elevation.</div></div></div>
    <div className="signature-light-note">{sun30?(sun30Available?`☼ Sun ≥30° from ${clock(day.sun30Start!)} to ${clock(day.sun30End!)}`:"☼ Sun stays below 30° all day"):includeNight?"☾ Daylight restriction is off; nighttime windows are included.":`☼ Sunrise ${clock(day.sunrise)} · sunset ${clock(day.sunset)} · 30-minute field buffer applied`}</div>
    {approx&&<p className="method-note">Subordinate-station curve estimated between NOAA-published high and low predictions; window times are approximate.</p>}
  </div>;
}

export default function Home(){
  const [stations,setStations]=useState<Station[]>([]),[selectedId,setSelectedId]=useState("9414290"),[stateFilter,setStateFilter]=useState<"ALL"|"CA"|"OR"|"WA">("ALL");
  const [threshold,setThreshold]=useState(1),[rangeMode,setRangeMode]=useState<RangeMode>("month"),[includeNight,setIncludeNight]=useState(false),[datum,setDatum]=useState<"MLLW"|"NAVD">("MLLW"),[navd,setNavd]=useState(false);
  const [sun30,setSun30]=useState(false),[workMode,setWorkMode]=useState<WorkMode>("low"),[minWindow,setMinWindow]=useState(0);
  const [predictions,setPredictions]=useState<Prediction[]>([]),[interval,setInterval]=useState<"6"|"hilo">("6"),[selectedDate,setSelectedDate]=useState(today()),[view,setView]=useState<"calendar"|"list">("calendar"),[stationStatus,setStationStatus]=useState("Loading NOAA stations…"),[tideStatus,setTideStatus]=useState("Waiting for station data…");
  const currentDate=useMemo(()=>today(),[]),[monthKey,setMonthKey]=useState(currentDate.slice(0,7));
  const start=rangeMode==="month"?`${monthKey}-01`:currentDate,range=rangeMode==="month"?daysInMonth(monthKey):Number(rangeMode);
  const currentYear=Number(currentDate.slice(0,4)),yearOptions=Array.from({length:15},(_,i)=>currentYear-4+i);
  const selected=stations.find(s=>s.id===selectedId)??stations[0], visible=useMemo(()=>stations.filter(s=>stateFilter==="ALL"||s.state===stateFilter),[stations,stateFilter]);

  useEffect(()=>{let active=true;loadStations().then(stationList=>{if(!active)return;setStations(stationList);setStationStatus(`${stationList.length} NOAA prediction stations`);setSelectedId(current=>stationList.some(station=>station.id===current)?current:stationList[0]?.id??"");}).catch(()=>active&&setStationStatus("Station list unavailable."));return()=>{active=false};},[]);
  useEffect(()=>{if(!selected)return;let active=true;loadDatumAvailability(selected.id).then(navdAvailable=>{if(!active)return;setNavd(navdAvailable);if(!navdAvailable)setDatum("MLLW");}).catch(()=>active&&setNavd(false));return()=>{active=false};},[selected]);
  useEffect(()=>{if(!selected)return;let active=true;loadPredictions(selected.id,compact(addDays(start,-1)),compact(addDays(start,range)),datum).then(data=>{if(!active)return;setPredictions(data.predictions);setInterval(data.sourceInterval);setTideStatus("");}).catch((error:unknown)=>{if(!active)return;setPredictions([]);setTideStatus(error instanceof Error?error.message:"Prediction service unavailable");});return()=>{active=false};},[selected,start,range,datum]);

  const raw=predictions.map(parse), points=interval==="hilo"?interpolate(raw):raw;
  const lows=interval==="hilo"?raw.filter(p=>p.type==="L"):raw.filter((p,i)=>i>1&&i<raw.length-2&&p.v<=raw[i-1].v&&p.v<raw[i+1].v),highs=interval==="hilo"?raw.filter(p=>p.type==="H"):raw.filter((p,i)=>i>1&&i<raw.length-2&&p.v>=raw[i-1].v&&p.v>raw[i+1].v);
  const days:Day[]=selected?Array.from({length:range},(_,i)=>{const date=addDays(start,i);return {date,points:points.filter(p=>p.date===date),lows:lows.filter(p=>p.date===date),highs:highs.filter(p=>p.date===date),sunrise:solarMinute(date,selected.lat,selected.lng,true)??0,sunset:solarMinute(date,selected.lat,selected.lng,false)??1440,sun30Start:solarMinute(date,selected.lat,selected.lng,true,30),sun30End:solarMinute(date,selected.lat,selected.lng,false,30)};}):[];
  const chosen=days.find(d=>d.date===selectedDate)??days[0];
  const extremaFor=(day:Day)=>workMode==="low"?day.lows:day.highs;
  const windowsFor=(day:Day,minimum=minWindow)=>usableWindows(day,threshold,workMode,sun30,includeNight,minimum);
  const count=days.reduce((total,day)=>total+windowsFor(day).length,0);
  const choose=(s:Station)=>{setTideStatus("Loading tide predictions…");setNavd(false);setDatum("MLLW");setSelectedId(s.id);setSelectedDate(start);};
  const stepThreshold=(amount:number)=>setThreshold(value=>Math.max(-5,Math.min(15,Number((value+amount).toFixed(1)))));
  const selectMonth=(next:string)=>{setTideStatus("Loading tide predictions…");setMonthKey(next);setSelectedDate(`${next}-01`);};
  const leadingDays=rangeMode==="month"?new Date(`${start}T12:00:00Z`).getUTCDay():0;
  const periodLabel=rangeMode==="month"?monthLabel(monthKey):`${range} days`;

  return <main id="top">
    <header className="site-header"><a className="brand" href="#top" aria-label="Daylight Tide Finder home"><svg className="esa-mark" viewBox="0 0 48 48" role="img" aria-label="ESA"><rect className="tile" x="8" y="8" width="32" height="32" rx="8"/><g transform="translate(11.9,16.7) scale(0.297)" fill="#fff"><path d="M21.4039 0.955719H0V22.3521C1.10379 11.021 10.0724 2.05556 21.4039 0.955719Z"/><path d="M26.0003 48.3562H47.4023V26.956C46.3004 38.2879 37.3323 47.2552 26.0003 48.3562Z"/><path d="M30.6864 20.4844H32.9911V1.46747H30.6864V0.95572H47.4023V6.62047H46.8794V6.22451C46.8794 3.63214 44.9724 1.46747 41.5844 1.46747H37.4344V10.1822H39.4086C41.2576 10.1822 42.2269 9.12879 42.2269 6.42249V6.10311H42.7387V15.1073H42.2269V14.4518C42.2269 12.429 41.2576 10.6939 39.4086 10.6939H37.4344V20.4844H41.5433C46.2126 20.4844 46.8943 16.6108 46.8943 14.9859V14.5937H47.4098V21.0037H30.6864V20.4844ZM49.4213 13.4563H49.9331C50.6166 16.6743 52.7794 20.9439 56.6232 20.9439C59.0736 20.9439 60.7228 19.4367 60.7228 16.9302C60.7228 10.7219 49.3634 15.1951 49.3634 6.62047C49.3634 2.86078 51.868 0.5 55.6258 0.5C58.504 0.5 59.4154 2.03525 60.7004 2.03525C61.5558 2.03525 61.6137 1.28817 61.6137 0.927704H62.1273V7.33393H61.6137C60.9021 4.31385 59.3071 1.01175 55.7173 1.01175C53.5508 1.01175 51.9222 2.46483 51.9222 4.65751C51.9222 10.1542 63.4571 5.82483 63.4571 14.2818C63.4571 18.7232 60.9507 21.4575 56.9351 21.4575C54.4585 21.4575 52.1239 19.9783 50.9846 19.9783C50.2151 19.9783 49.9312 20.49 49.9312 21.0317H49.4194L49.4213 13.4563ZM62.3178 20.4844H62.6914C63.7728 20.4004 64.2882 19.7149 64.63 18.7736L71.2305 0.5H71.6601L79.2915 20.4844H80.6848V20.9981H72.1998V20.4844H74.4747L72.3997 14.5657H66.875L65.5079 18.5812C65.3914 18.8524 65.3237 19.142 65.308 19.4367C65.308 20.3705 66.1055 20.49 66.677 20.49H67.4727V21.0037H62.3178V20.4844ZM72.17 14.0483L69.6934 6.85019H69.6373L67.1029 14.0539L72.17 14.0483Z"/></g></svg><span><b>Daylight Tide Finder</b></span></a><nav><a href="#how">How it works</a><a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noreferrer">NOAA data ↗</a></nav></header>
    <section className="intro"><div><p className="eyebrow">California · Oregon · Washington</p><h1>Plan fieldwork around the tide and daylight.</h1></div><p>Scan upcoming dates, compare stations, and see how long the predicted tide stays below or above the elevation your fieldwork requires.</p></section>
    <section className="controls" aria-label="Tide search controls">
      <fieldset className={`work-mode-control ${workMode}`}><legend><b>01</b>Choose work-window mode</legend><div><button type="button" className={workMode==="low"?"active":""} aria-pressed={workMode==="low"} onClick={()=>setWorkMode("low")}><span>↓</span><strong>Low Tide Work Windows</strong><small>At or below the maximum elevation</small></button><button type="button" className={workMode==="high"?"active":""} aria-pressed={workMode==="high"} onClick={()=>setWorkMode("high")}><span>↑</span><strong>High Tide Work Windows</strong><small>At or above the minimum elevation</small></button></div></fieldset>
      <p className="step-label"><b>02</b>Set the field criteria</p>
      <div className={`sun-filter-control ${sun30?"active":""}`}><div><p className="eyebrow">Solar-angle filter</p><strong>Require the sun to be at least 30° above the horizon (drone-based imagery preference)</strong><small>When on, only tide windows that overlap this higher-angle working light are marked usable.</small></div><button type="button" className="sun-filter-toggle" aria-pressed={sun30} onClick={()=>setSun30(active=>{if(!active)setIncludeNight(false);return !active;})}><span>{sun30?"Filter on":"Filter off"}</span><b aria-hidden="true"><i/></b></button></div>
      <div className="control station-control"><label htmlFor="station">Station <span>{stationStatus}</span></label><select id="station" value={selectedId} onChange={e=>{const s=stations.find(x=>x.id===e.target.value);if(s)choose(s);}}>{(["CA","OR","WA"] as const).map(state=><optgroup key={state} label={STATES[state]}>{stations.filter(s=>s.state===state).map(s=><option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}</optgroup>)}</select></div>
      <fieldset className="control threshold"><legend>Threshold <span>{workMode==="low"?"maximum":"minimum"} elevation</span></legend><div className="threshold-stepper"><button type="button" aria-label="Decrease threshold by 0.1 feet" onClick={()=>stepThreshold(-.1)} disabled={threshold<=-5}>−</button><select id="threshold" aria-label={`${workMode==="low"?"Maximum":"Minimum"} tide elevation threshold`} value={threshold.toFixed(1)} onChange={e=>setThreshold(Number(e.target.value))}>{THRESHOLDS.map(v=><option key={v} value={v.toFixed(1)}>{v.toFixed(1)} ft</option>)}</select><button type="button" aria-label="Increase threshold by 0.1 feet" onClick={()=>stepThreshold(.1)} disabled={threshold>=15}>+</button></div></fieldset>
      <fieldset className="control datum"><legend>Elevation datum</legend><div className="segments"><button className={datum==="MLLW"?"active":""} onClick={()=>{setTideStatus("Loading tide predictions…");setDatum("MLLW")}}>MLLW</button><button disabled={!navd} className={datum==="NAVD"?"active":""} title={navd?"North American Vertical Datum of 1988":"NOAA does not publish NAVD88 for this station"} onClick={()=>{setTideStatus("Loading tide predictions…");setDatum("NAVD")}}>NAVD88</button></div><small className={navd?"available":""}>{navd?"NAVD88 published":"MLLW only here"}</small></fieldset>
      <div className="control duration-control"><label htmlFor="min-window">Minimum work window <span>continuous time</span></label><select id="min-window" value={minWindow} onChange={e=>setMinWindow(Number(e.target.value))}>{MIN_WINDOWS.map(minutes=><option key={minutes} value={minutes}>{minutes?`At least ${duration(minutes)}`:"Any length"}</option>)}</select></div>
      <div className="control window-control"><label htmlFor="range">Date window</label><div className={`window-controls ${rangeMode==="month"?"has-month":""}`}><select id="range" value={rangeMode} onChange={e=>{const next=e.target.value as RangeMode;setTideStatus("Loading tide predictions…");setRangeMode(next);setSelectedDate(next==="month"?`${monthKey}-01`:currentDate);}}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="month">Full month</option></select>{rangeMode==="month"&&<div className="month-selectors"><select aria-label="Month" value={monthKey.slice(5)} onChange={e=>selectMonth(`${monthKey.slice(0,4)}-${e.target.value}`)}>{MONTHS.map((month,i)=><option key={month} value={String(i+1).padStart(2,"0")}>{month}</option>)}</select><select aria-label="Year" value={monthKey.slice(0,4)} onChange={e=>selectMonth(`${e.target.value}-${monthKey.slice(5)}`)}>{yearOptions.map(year=><option key={year} value={year}>{year}</option>)}</select></div>}</div></div>
      <label className={`night ${sun30?"disabled":""}`} title={sun30?`Turn off the 30° sun filter to include nighttime ${workMode}s`:""}><input type="checkbox" checked={includeNight} disabled={sun30} onChange={e=>setIncludeNight(e.target.checked)}/><span><i/></span>Include nighttime {workMode}s</label>
    </section>
    <section className="workspace">
      <p className="step-label"><b>03</b>Inspect the window</p>
      <article className="card map-card"><header className="card-head"><div><p className="eyebrow">Station atlas</p><h2>Pacific Coast stations</h2></div><div className="state-tabs">{(["ALL","CA","OR","WA"] as const).map(s=><button key={s} className={stateFilter===s?"active":""} onClick={()=>setStateFilter(s)}>{s==="ALL"?"All":s}</button>)}</div></header><CoastMap stations={visible} selected={selected} onSelect={choose}/></article>
      <article className="card forecast"><header className="card-head forecast-head"><div><p className="eyebrow">Upcoming {workMode}-tide windows</p><h2>{selected?.name??"Choose a station"}</h2><small>{selected?`${STATES[selected.state]} · NOAA ${selected.id}`:""}</small></div><div className="summary"><strong>{count}</strong><span>usable windows<br/>{minWindow?`≥ ${duration(minWindow)} · `:""}{periodLabel}</span></div><div className="view-tabs"><button className={view==="calendar"?"active":""} onClick={()=>setView("calendar")}>Calendar</button><button className={view==="list"?"active":""} onClick={()=>setView("list")}>List</button></div></header>
        {rangeMode==="month"&&<div className="month-bar"><button type="button" aria-label="Previous month" onClick={()=>selectMonth(shiftMonthKey(monthKey,-1))}>‹</button><strong>{monthLabel(monthKey)}</strong><button type="button" aria-label="Next month" onClick={()=>selectMonth(shiftMonthKey(monthKey,1))}>›</button></div>}
        {tideStatus?<div className="loading"><i/>{tideStatus}</div>:view==="calendar"?
          <div className={`calendar ${rangeMode==="month"?"month-calendar":""}`}>
            {rangeMode==="month"&&WEEKDAYS.map(day=><span className="weekday-head" key={day}>{day}</span>)}
            {rangeMode==="month"&&Array.from({length:leadingDays},(_,i)=><span className="calendar-spacer" key={`blank-${i}`} aria-hidden="true"/>)}
            {days.map(day=>{
              const d=labelDate(day.date),extrema=extremaFor(day),windows=windowsFor(day),unfiltered=tideWindows(day.points,threshold,workMode),lightWindows=windowsFor(day,0),bestWindow=windows.reduce<WorkWindow|undefined>((best,window)=>!best||window.end-window.start>best.end-best.start?window:best,undefined);
              const matchingPoints=day.points.filter(point=>windows.some(window=>point.minute>=window.start&&point.minute<=window.end));
              const display=(matchingPoints.length?matchingPoints:extrema).reduce<Point|undefined>((best,point)=>!best||(workMode==="low"?point.v<best.v:point.v>best.v)?point:best,undefined),angleAvailable=day.sun30Start!==null&&day.sun30End!==null;
              const status=windows.length?`Workable · ${duration(bestWindow!.end-bestWindow!.start)}`:!unfiltered.length?(workMode==="low"?"Above limit":"Below minimum"):!lightWindows.length?"Outside light":minWindow?`Under ${duration(minWindow)}`:"No window";
              return <button key={day.date} className={`day ${chosen?.date===day.date?"selected":""} ${windows.length?"qualifies":""}`} onClick={()=>setSelectedDate(day.date)}><span className="day-date"><b>{d.weekday}</b><strong>{d.day}</strong><small>{d.month}</small></span><span className="sun-times">{sun30?(angleAvailable?`☼ 30° ${clock(day.sun30Start!).replace(" ","").toLowerCase()}–${clock(day.sun30End!).replace(" ","").toLowerCase()}`:"☼ below 30° all day"):includeNight?"☾ nighttime included":`☼ ${clock(day.sunrise).replace(" ","").toLowerCase()}–${clock(day.sunset).replace(" ","").toLowerCase()}`}</span><MiniCurve points={day.points} threshold={threshold}/>{display?<span className="low"><strong>{display.v.toFixed(1)} ft</strong><small>{clock(display.minute)}</small></span>:<span className="low muted">No {workMode}</span>}<span className={`tag ${windows.length?"":"muted"}`}>{status}</span></button>;
            })}
          </div>:
          <div className="list"><div className="list-head"><span>Date</span><span>Work window</span><span>Duration</span><span>{workMode==="low"?"Lowest":"Highest"} tide</span></div>{count?days.flatMap(day=>windowsFor(day).map(window=>{const d=labelDate(day.date),samples=day.points.filter(point=>point.minute>=window.start&&point.minute<=window.end),extreme=samples.reduce<Point|undefined>((best,point)=>!best||(workMode==="low"?point.v<best.v:point.v>best.v)?point:best,undefined);return <button key={`${day.date}-${window.start}`} className="qualifies" onClick={()=>setSelectedDate(day.date)}><span>{d.weekday}, {d.month} {d.day}</span><span>{clock(window.start)}–{clock(window.end)}</span><b>{duration(window.end-window.start)}</b><span>{extreme?`${extreme.v.toFixed(2)} ft`:"—"}</span></button>;})):<div className="list-empty">No work windows meet the current elevation, light, and duration filters.</div>}</div>}
      </article>
    </section>
    <section className="card signature-card"><TideSignature day={chosen} station={selected} threshold={threshold} datum={datum} approx={interval==="hilo"} sun30={sun30} includeNight={includeNight} minWindow={minWindow} workMode={workMode}/></section>
    <section className="method" id="how"><div><span>01</span><h3>Choose work-window mode</h3><p>Find windows at or below a low-tide maximum, or at or above a high-tide minimum.</p></div><div><span>02</span><h3>Set the field criteria</h3><p>Choose a station, elevation datum, threshold, and the minimum continuous time your work requires.</p></div><div><span>03</span><h3>Inspect the window</h3><p>Review only windows long enough for the job, using buffered daylight or the 30° sun filter for working light.</p></div></section>
    <footer><p>Predictions from <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noreferrer">NOAA Tides & Currents ↗</a>. Verify conditions and site safety before fieldwork.</p><p>{interval==="hilo"?"Subordinate station · interpolated high/low curve":"Harmonic station · 6-minute prediction curve"}</p></footer>
  </main>;
}
