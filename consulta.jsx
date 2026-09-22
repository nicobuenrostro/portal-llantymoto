// consulta.jsx — Sección "CONSULTA DE LLANTAS" de LLANTY.APP.
// Buscador de medidas por vehículo (Moto / ATV-UTV) y búsqueda inversa
// por medida, sobre las 32,004 fichas de portal/catalog.gz.
//
// Va en la raíz del repo, junto a app.jsx. Se usa así dentro de Portal:
//   import ConsultaLlantas from "./consulta.jsx";
//   ...
//   {tab==="consulta"&&<ConsultaLlantas mob={mob}/>}
//
// Archivos estáticos que necesita (carpeta /public/consulta/ del repo):
//   catalog.gz                 base comprimida (gzip) con las fichas
//   Convertidor_LlantyMoto.html convertidor independiente (?a=medida&category=Moto|Offroad)
//
// Reglas conservadas del prototipo (Buscador_Motos_Unificado.html):
//   · Solo dos categorías: Moto y ATV / UTV (interno "Offroad"). Moto al abrir;
//     LIMPIAR conserva la categoría.
//   · 120/70-17 y 120 70 17 son la misma medida. R, ZR y B se conservan y la
//     coincidencia exacta o solo dimensional se avisa.
//   · No se inventan años, versiones ni la medida del otro eje.
//   · Fuentes, mercados, advertencias y fichas sin año siguen visibles.
//   · El convertidor es independiente: se abre en otra pestaña con la medida.
//
// El motor (consulta-engine.js) no toca el DOM; este archivo solo pinta.
// El catálogo se descarga y descomprime UNA vez por sesión (caché de módulo)
// y los índices se conservan aunque el usuario cambie de pestaña.

import { useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import E from "./consulta-engine.js";

// ── Rutas de los recursos ─────────────────────────────────────
// Vite sirve /public en la raíz del sitio; BASE_URL cubre un subdirectorio
// de despliegue si algún día lo hubiera.
const BASE_URL = ((import.meta.env&&import.meta.env.BASE_URL)||"/").replace(/\/?$/,"/");
const CATALOG_URL     = BASE_URL+"consulta/catalog.gz";
const CONVERTIDOR_URL = BASE_URL+"consulta/Convertidor_LlantyMoto.html";

// ── Paleta (misma que app.jsx) ────────────────────────────────
const OR="#FF5C1E", GRL="#818181", CD="#ffffff", BD="#EBEBEB", DK="#1A1A1A";

// ── Estado inicial ────────────────────────────────────────────
const DEFAULTS={q:"",category:"Moto",mode:"auto",brand:"",model:"",year:"",version:"",axis:"",construction:"auto"};
const PAGE=12;
const YEAR_RE=/\b(?:19|20)\d{2}\b/;
const EJEMPLOS=[["Italika FT150","Moto"],["Yamaha MT-07","Moto"],["Honda TRX","Offroad"],["Polaris RZR","Offroad"],["120/70-17","Moto"]];
// Campos del bloque excel que ya se muestran en otra parte de la ficha.
const EXCEL_OCULTOS=["Marca","Tipo","Año modelo","Versión","Línea","Llanta delantera","Llanta trasera","ID de registro","URL de ficha / fuente","URL de índice / catálogo","Fuentes complementarias","Observaciones","Verificación"];

// ── Carga del catálogo (una sola vez por sesión) ──────────────
let catalogPromise=null;
function cargarCatalogo(){
  if(!catalogPromise){
    catalogPromise=(async()=>{
      const r=await fetch(CATALOG_URL);
      if(!r.ok) throw new Error("No se pudo descargar el catálogo ("+r.status+"). Revisa que exista /public/consulta/catalog.gz.");
      const bytes=new Uint8Array(await r.arrayBuffer());
      let texto;
      if(bytes[0]===0x1f&&bytes[1]===0x8b){
        // Llegó gzip tal cual (lo normal). Se descomprime en el navegador.
        if(typeof DecompressionStream==="undefined") throw new Error("Este navegador no puede descomprimir el catálogo. Actualiza el navegador.");
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        texto=await new Response(stream).text();
      }else{
        // El servidor ya lo descomprimió (Content-Encoding: gzip). No se
        // descomprime dos veces.
        texto=new TextDecoder("utf-8").decode(bytes);
      }
      const registros=JSON.parse(texto);
      if(!Array.isArray(registros)||!registros.length) throw new Error("El catálogo está vacío o no tiene el formato esperado.");
      return E.create(registros);
    })().catch(e=>{catalogPromise=null;throw e;});
  }
  return catalogPromise;
}

// ── Utilidades ────────────────────────────────────────────────
const urlSegura=v=>{try{const u=new URL(v);return u.protocol==="https:"?u.href:"";}catch{return "";}};
const enCategoria=(d,category)=>!category||(category==="Offroad"&&["ATV","UTV"].includes(d.vehicle))||d.vehicle===category;
const fmt=n=>Number(n||0).toLocaleString("es-MX");

function abrirConvertidor(size="",category="Moto"){
  const u=CONVERTIDOR_URL+"?a="+encodeURIComponent(size)+"&category="+encodeURIComponent(category);
  window.open(u,"_blank","noopener");
}

function textoCopia(g){
  const d=g.d;
  return `${d.m} ${d.n}\nAños: ${E.yearsLabel(g.years)}\nDelantera: ${d.fd||"Sin dato confirmado"}\nTrasera: ${d.rd||"Sin dato confirmado"}\n${d.market||"Mercado no identificado"}\nConfirma versión y equipamiento antes de comprar.`;
}

async function copiar(texto){
  try{ await navigator.clipboard.writeText(texto); return true; }
  catch{
    try{
      const ta=document.createElement("textarea");ta.value=texto;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";
      document.body.append(ta);ta.select();const ok=document.execCommand("copy");ta.remove();return ok;
    }catch{return false;}
  }
}

// Filas de especificaciones (rin, ancho nominal, perfil, campos excel).
function especificaciones(d){
  const out=[];
  for(const ax of ["fd","rd"]){
    const t=ax==="fd"?d._front:d._rear, label=ax==="fd"?"Delantera":"Trasera";
    if(t) out.push([label+" · rin",t.rim+" pulgadas"],[label+" · designación",d[ax]]);
    if(t?.kind==="metric") out.push([label+" · ancho nominal",`${t.parts[0]} mm / ${t.parts[0]/10} cm / ${(t.parts[0]/25.4).toFixed(2)}″`],[label+" · perfil",t.parts[1]+" % del ancho"]);
    if(t?.kind==="flotation") out.push([label+" · diámetro nominal",`${t.parts[0]}″ / ${(t.parts[0]*25.4).toFixed(1)} mm / ${(t.parts[0]*2.54).toFixed(2)} cm`],[label+" · ancho nominal",`${t.parts[1]}″ / ${(t.parts[1]*25.4).toFixed(1)} mm`]);
  }
  for(const [k,v] of Object.entries(d.excel||{}))
    if(v!==null&&v!==""&&!EXCEL_OCULTOS.includes(k)&&!k.startsWith("URL")) out.push([k,String(v)]);
  return out;
}

// Sugerencias ortográficas: solo palabras del vocabulario real de marcas y
// modelos, y solo si la consulta corregida trae resultados. Nunca se aplica
// sola: el usuario la elige con un botón.
function sugerenciasOrtograficas(db,vocab,state){
  if(!state.q) return [];
  const words=state.q.trim().split(/\s+/), proposed=[];
  for(let i=0;i<words.length&&proposed.length<3;i++){
    const w=E.norm(words[i]);
    if(/\d/.test(w)||w.length<4) continue;
    for(const term of vocab){
      if(E.norm(term)===w) continue;
      if(E.nearWord(w,E.norm(term))){
        const copy=[...words];copy[i]=term;const q=copy.join(" ");
        if(db.query({...state,q}).total){proposed.push(q);if(proposed.length>=3)break;}
      }
    }
  }
  return [...new Set(proposed)];
}

// ── Estilos acotados a la sección (prefijo .cl-) ──────────────
// Se inyectan una vez. Ningún selector es global: todo cuelga de .cl-root.
const CSS=`
.cl-root{font-family:Arial,Helvetica,sans-serif;color:${DK};font-size:14px;line-height:1.45}
.cl-root *{box-sizing:border-box}
.cl-root button{font:inherit;cursor:pointer;touch-action:manipulation;border-radius:6px;min-height:40px}
.cl-root button:disabled{cursor:default;opacity:.55}
.cl-root button:focus-visible,.cl-root input:focus-visible,.cl-root select:focus-visible,.cl-root summary:focus-visible,.cl-root a:focus-visible{outline:3px solid ${OR};outline-offset:2px}
.cl-root a{color:#a63306;text-underline-offset:3px}
.cl-root input,.cl-root select{font:inherit;color:inherit;min-height:44px;border-radius:6px;border:1px solid #c9c9c9;background:#fff;width:100%;max-width:100%;padding:10px 12px}
.cl-root select{padding-right:30px}
.cl-btn{border:1px solid ${BD};background:#fff;padding:8px 14px;font-weight:700;font-size:12px;color:#333}
.cl-btn:hover{background:#f4eee9}
.cl-btn.on,.cl-btn[aria-pressed="true"]{background:${DK};color:#fff;border-color:${DK}}
.cl-primary{background:${OR};color:#fff;border:1px solid ${OR};padding:10px 20px;font-weight:800;letter-spacing:1px;font-size:12px}
.cl-primary:hover{background:#e84f14}
.cl-quiet{background:transparent;border:1px solid transparent;color:#555;font-weight:600;font-size:12px}
.cl-card{background:${CD};border:1px solid ${BD};border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.cl-search{border-top:3px solid ${OR};padding:16px}
.cl-line{position:relative;display:flex;gap:8px}
.cl-line input{font-size:17px;padding:12px 44px 12px 14px}
.cl-clear{position:absolute;right:104px;top:3px;border:0;background:transparent;font-size:22px;padding:0 10px;color:#666;min-height:38px}
.cl-row{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px}
.cl-row label,.cl-fs legend{font-size:11px;font-weight:700;letter-spacing:1px;color:${GRL};display:block;text-transform:uppercase}
.cl-row label{flex:1;min-width:160px}
.cl-row label select{margin-top:5px;font-size:14px}
.cl-help{font-size:12px;color:${GRL};margin:10px 0 0}
.cl-fs{border:0;padding:0;margin:0;min-width:0}
.cl-fs legend{margin-bottom:5px}
.cl-seg{display:flex;gap:4px;flex-wrap:wrap}
.cl-seg .cl-btn{font-size:12px;padding:7px 10px}
.cl-sizectl{margin-top:12px;display:flex;gap:15px;align-items:end;flex-wrap:wrap}
.cl-sizectl label{min-width:200px}
.cl-guided{border-top:1px solid #eee;margin-top:14px}
.cl-guided summary{cursor:pointer;padding:10px 0;font-weight:700;font-size:12px;letter-spacing:1px;color:#333;min-height:40px;list-style:none;display:flex;align-items:center;gap:8px}
.cl-guided summary::-webkit-details-marker{display:none}
.cl-guided summary::before{content:"▸";color:${OR};font-size:12px}
.cl-guided[open] summary::before{content:"▾"}
.cl-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.cl-chips .cl-btn{font-size:12px;padding:5px 10px;min-height:32px;border-radius:20px}
.cl-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0 10px}
.cl-count{font-weight:800;font-size:13px;color:${DK};margin:0;flex:1}
.cl-notice{border-left:4px solid ${OR};background:#fff7f3;padding:10px 12px;border-radius:0 6px 6px 0;font-size:13px;margin-bottom:10px}
.cl-sugg p,.cl-facets p{margin:0 0 6px;font-size:12px;color:${GRL};font-weight:700}
.cl-sugg,.cl-facets{margin-bottom:12px}
.cl-sugg .cl-btn,.cl-facets .cl-btn{margin:0 6px 6px 0}
.cl-results{display:grid;gap:12px}
.cl-result{padding:16px}
.cl-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.cl-brand{font-size:11px;font-weight:800;letter-spacing:2px;color:${OR};text-transform:uppercase}
.cl-result h3{font-size:19px;line-height:1.2;margin:2px 0 2px;letter-spacing:-.02em}
.cl-years{margin:0;font-size:12px;color:${GRL}}
.cl-tag{background:${DK};color:#fff;font-size:10px;font-weight:800;letter-spacing:1px;padding:5px 9px;border-radius:4px;white-space:nowrap}
.cl-warn{background:#fffbeb;border:1px solid #fde68a;color:#78350f;font-size:12px;padding:8px 10px;border-radius:6px;margin:10px 0 0}
.cl-tires{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.cl-tire,.cl-same{border:1px solid ${BD};border-radius:8px;padding:10px 12px;background:#fafafa}
.cl-tire.hit{border-color:${OR};background:#fff7f3}
.cl-same{background:#f3f4f6;margin-top:12px}
.cl-tlabel{font-size:10px;font-weight:800;letter-spacing:1.5px;color:${GRL}}
.cl-tire.hit .cl-tlabel{color:${OR}}
.cl-measure{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:2px 0;word-break:break-word}
.cl-tire small,.cl-same small{font-size:11px;color:${GRL}}
.cl-meta{font-size:12px;color:${GRL};margin:10px 0 0}
.cl-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.cl-evidence{border-top:1px solid ${BD};margin-top:12px;padding-top:12px;font-size:13px}
.cl-evidence details{border:1px solid ${BD};border-radius:6px;padding:0 12px;margin-top:8px}
.cl-evidence summary{cursor:pointer;padding:10px 0;font-weight:700;font-size:12px;min-height:40px}
.cl-evidence ul{padding-left:18px;margin:6px 0}
.cl-evidence li{margin-bottom:6px}
.cl-evidence dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 12px}
.cl-evidence dt{color:${GRL};font-size:12px}
.cl-evidence dd{margin:0}
.cl-empty{padding:28px 20px;text-align:center}
.cl-empty h3{margin:0 0 6px;font-size:18px}
.cl-empty p{color:${GRL};margin:0 0 14px;font-size:13px}
.cl-examples{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.cl-more{margin:14px auto 0;display:block}
.cl-cov{font-size:11px;color:${GRL};margin:18px 0 0;line-height:1.5}
.cl-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:${DK};color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:700;z-index:1200;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.cl-error{padding:24px;text-align:center}
.cl-error h3{margin:0 0 8px}
@media(max-width:600px){
  .cl-tires{grid-template-columns:1fr}
  .cl-line input{font-size:16px}
  .cl-clear{right:92px}
  .cl-primary{padding:10px 14px}
  .cl-evidence dl{grid-template-columns:1fr}
  .cl-result h3{font-size:17px}
  .cl-measure{font-size:20px}
}
`;
function useEstilos(){
  useEffect(()=>{
    if(document.getElementById("cl-styles")) return;
    const s=document.createElement("style");s.id="cl-styles";s.textContent=CSS;document.head.append(s);
  },[]);
}

// ── Componente principal ──────────────────────────────────────
export default function ConsultaLlantas({mob=false}){
  useEstilos();
  const [db,setDb]=useState(null);
  const [error,setError]=useState("");
  const [state,setState]=useState(DEFAULTS);
  const [limit,setLimit]=useState(PAGE);
  const [guiadoAbierto,setGuiadoAbierto]=useState(false);
  const [abiertas,setAbiertas]=useState(()=>new Set());  // fichas con evidencia desplegada
  const [toast,setToast]=useState("");
  const inputRef=useRef(null);
  const toastTimer=useRef(null);

  // Carga del catálogo. Si el componente se desmonta antes de terminar,
  // no se toca el estado (vivo=false).
  useEffect(()=>{
    let vivo=true;
    setError("");
    cargarCatalogo().then(d=>{if(vivo)setDb(d);}).catch(e=>{if(vivo)setError(e.message||String(e));});
    return()=>{vivo=false;clearTimeout(toastTimer.current);};
  },[]);

  const aviso=t=>{setToast(t);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3000);};

  // Cambios de estado con las mismas cascadas del prototipo.
  function set(campo,valor){
    setState(s=>{
      const n={...s,[campo]:valor};
      if(campo==="category"){n.brand="";n.model="";n.year="";n.version="";}
      if(campo==="brand"){n.model="";n.year="";n.version="";}
      if(campo==="model"){n.year="";n.version="";}
      if(campo==="year"){n.version="";}
      return n;
    });
    setLimit(PAGE);
  }
  function limpiar(){ setState(s=>({...DEFAULTS,category:s.category})); setLimit(PAGE); setGuiadoAbierto(false); inputRef.current?.focus(); }
  function ejemplo(q,category){ setState(s=>({...s,q,category:category||s.category,brand:"",model:"",year:"",version:""})); setLimit(PAGE); }

  // El texto se difiere para que teclear no bloquee la interfaz en móviles.
  const qDiferida=useDeferredValue(state.q);
  const estadoConsulta=useMemo(()=>({...state,q:qDiferida}),[state,qDiferida]);

  // Vocabulario para sugerencias (marcas y modelos con 4+ letras).
  const vocab=useMemo(()=>db?[...new Set(db.rows.flatMap(d=>(d.m+" "+d.n).split(/[^a-zA-ZÀ-ÿ]+/)).filter(w=>w.length>=4))]:[],[db]);

  // Opciones en cascada de los filtros guiados (marca → modelo → año → versión).
  const opciones=useMemo(()=>{
    if(!db) return {brands:[],models:[],years:[],versions:[]};
    const scoped=db.rows.filter(d=>enCategoria(d,state.category));
    const brands=[...new Set(scoped.map(d=>d.m))].sort((a,b)=>a.localeCompare(b));
    const branded=scoped.filter(d=>!state.brand||d.m===state.brand);
    const models=state.brand?[...new Set(branded.map(d=>d._family))].sort((a,b)=>a.localeCompare(b)):[];
    const modeled=branded.filter(d=>!state.model||d._family===state.model);
    const years=state.brand?[...[...new Set(modeled.map(d=>d.year).filter(Boolean))].sort((a,b)=>b-a).map(String),...(modeled.some(d=>!d.year)?["unknown"]:[])]:[];
    const yearly=modeled.filter(d=>!state.year||(state.year==="unknown"?!d.year:String(d.year)===state.year));
    const versions=state.model?[...new Set(yearly.map(d=>d.n))].sort((a,b)=>a.localeCompare(b)):[];
    return {brands,models,years,versions};
  },[db,state.category,state.brand,state.model,state.year]);

  // Si una opción elegida dejó de existir (p. ej. cambió la categoría),
  // se descarta igual que hacía el prototipo.
  useEffect(()=>{
    if(!db) return;
    const fix={};
    if(state.brand&&!opciones.brands.includes(state.brand)) fix.brand="";
    if(state.model&&!opciones.models.includes(state.model)) fix.model="";
    if(state.year&&!opciones.years.includes(state.year)) fix.year="";
    if(state.version&&!opciones.versions.includes(state.version)) fix.version="";
    if(Object.keys(fix).length) setState(s=>({...s,...fix}));
  },[db,opciones,state.brand,state.model,state.year,state.version]);

  const resultado=useMemo(()=>db?db.query(estadoConsulta):null,[db,estadoConsulta]);
  const grupos=resultado?resultado.groups:[];
  const activa=Boolean(estadoConsulta.q.trim()||state.brand||state.model||state.year||state.version||state.category==="Offroad");
  const filtrosActivos=["brand","model","year","version"].filter(k=>state[k]);
  const etiquetaFiltro=k=>state[k]==="unknown"?"Año no identificado":state[k];

  const sugerencias=useMemo(()=>(resultado&&activa&&!grupos.length&&!resultado.isSize)?sugerenciasOrtograficas(db,vocab,estadoConsulta):[],[db,vocab,resultado,activa,grupos.length,estadoConsulta]);

  // Facetas por marca cuando una medida trae muchas configuraciones.
  const facetas=useMemo(()=>{
    if(!resultado||!resultado.isSize||grupos.length<=12||state.brand) return [];
    const m=new Map();for(const g of grupos)m.set(g.d.m,(m.get(g.d.m)||0)+1);
    return [...m].sort((a,b)=>b[1]-a[1]).slice(0,8);
  },[resultado,grupos,state.brand]);

  // Sugerencias de autocompletado (datalist) para consultas por vehículo.
  const datalist=useMemo(()=>{
    if(!resultado||resultado.isSize||estadoConsulta.q.length<2) return [];
    const y=estadoConsulta.q.match(YEAR_RE)?.[0];
    return [...new Set(grupos.slice(0,8).map(g=>g.d.m+" "+g.d.n+(y?" "+y:"")))];
  },[resultado,grupos,estadoConsulta.q]);

  const cobertura=useMemo(()=>{
    if(!db) return "";
    const n=db.rows.length,moto=db.rows.filter(d=>d.vehicle==="Moto").length,atv=db.rows.filter(d=>d.vehicle==="ATV").length,utv=db.rows.filter(d=>d.vehicle==="UTV").length,sin=db.rows.filter(d=>!d.year).length;
    return `${fmt(n)} fichas: ${fmt(moto)} Moto, ${atv} ATV y ${utv} UTV. ${sin} sin año identificado. No es un catálogo de inventario: consulta existencias en CATÁLOGO.`;
  },[db]);

  function toggleEvidencia(key){ setAbiertas(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n;}); }

  // ── Render ──────────────────────────────────────────────────
  if(error) return(
    <div className="cl-root"><div className="cl-card cl-error">
      <h3>El catálogo de medidas no está disponible.</h3>
      <p style={{color:GRL,fontSize:13}}>{error}</p>
      <button className="cl-primary" onClick={()=>{setError("");cargarCatalogo().then(setDb).catch(e=>setError(e.message||String(e)));}}>VOLVER A INTENTAR</button>
    </div></div>
  );
  if(!db) return(
    <div className="cl-root"><div className="cl-card" style={{padding:40,textAlign:"center",color:GRL,fontSize:12,letterSpacing:2}} aria-busy="true">CARGANDO BASE DE MEDIDAS...</div></div>
  );

  const mostrarSize=resultado.isSize;
  const restantes=Math.max(0,grupos.length-limit);

  return(
    <div className="cl-root" style={{maxWidth:1060,margin:"0 auto"}}>
      {/* ── Encabezado ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:3,color:GRL}}>CONSULTA DE LLANTAS</div>
          <h2 style={{margin:"4px 0 0",fontSize:mob?22:28,lineHeight:1.15,letterSpacing:"-.02em"}}>¿Qué llanta lleva?</h2>
          <p style={{margin:"4px 0 0",color:GRL,fontSize:13}}>Escribe el vehículo o la medida. Delantera y trasera en un solo resultado.</p>
        </div>
        <button className="cl-btn" type="button" onClick={()=>abrirConvertidor("",state.category)}>CONVERTIDOR DE MEDIDAS ↗</button>
      </div>

      {/* ── Búsqueda ── */}
      <div className="cl-card cl-search">
        <form onSubmit={e=>{e.preventDefault();setLimit(PAGE);inputRef.current?.blur();}} role="search">
          <label htmlFor="cl-q" style={{position:"absolute",width:1,height:1,overflow:"hidden",clipPath:"inset(50%)"}}>Vehículo o medida</label>
          <div className="cl-line">
            <input id="cl-q" ref={inputRef} type="search" autoComplete="off" list="cl-sugerencias" enterKeyHint="search" inputMode="search"
              placeholder={state.category==="Offroad"?"Ej. Polaris RZR, Can Am X3 2023 o 27x9-12":"Ej. Italika FT150, Honda CRF250 2022 o 120/70-17"}
              value={state.q} onChange={e=>{setState(s=>({...s,q:e.target.value}));setLimit(PAGE);}} aria-describedby="cl-help"/>
            <datalist id="cl-sugerencias">{datalist.map(v=><option key={v} value={v}/>)}</datalist>
            {state.q&&<button type="button" className="cl-clear" aria-label="Borrar texto" onClick={()=>{setState(s=>({...s,q:""}));setLimit(PAGE);inputRef.current?.focus();}}>×</button>}
            <button type="submit" className="cl-primary">BUSCAR</button>
          </div>
        </form>

        <div className="cl-row">
          <label>Categoría
            <select value={state.category} onChange={e=>set("category",e.target.value)}>
              <option value="Moto">Moto</option>
              <option value="Offroad">ATV / UTV</option>
            </select>
          </label>
          <label>Tipo de consulta
            <select value={state.mode} onChange={e=>set("mode",e.target.value)}>
              <option value="auto">Automático</option>
              <option value="vehicle">Por vehículo</option>
              <option value="size">Por medida (búsqueda inversa)</option>
            </select>
          </label>
        </div>
        <p id="cl-help" className="cl-help">Puedes escribir la medida con diagonal, guion o espacios: 120/70-17 y 120 70 17 se leen igual. R, ZR y B se respetan.</p>

        {mostrarSize&&<div className="cl-sizectl">
          <fieldset className="cl-fs">
            <legend>Posición de la medida</legend>
            <div className="cl-seg" role="group">
              {[["","Cualquiera"],["front","Delantera"],["rear","Trasera"],["both","En ambos ejes"]].map(([v,l])=>
                <button key={v} type="button" className="cl-btn" aria-pressed={state.axis===v} onClick={()=>set("axis",v)}>{l}</button>)}
            </div>
          </fieldset>
          <label>Construcción
            <select value={state.construction} onChange={e=>set("construction",e.target.value)}>
              <option value="auto">Automático (según lo escrito)</option>
              <option value="exact">Símbolo exacto (R, ZR, B o guion)</option>
              <option value="dimensions">Solo dimensiones</option>
            </select>
          </label>
        </div>}

        <details className="cl-guided" open={guiadoAbierto||filtrosActivos.length>0} onToggle={e=>setGuiadoAbierto(e.currentTarget.open)}>
          <summary>FILTROS GUIADOS {filtrosActivos.length>0&&<span style={{color:OR}}>({filtrosActivos.length})</span>}</summary>
          <div className="cl-row" style={{marginTop:6,marginBottom:12}}>
            <label>Marca
              <select value={state.brand} onChange={e=>set("brand",e.target.value)}>
                <option value="">Todas las marcas</option>
                {opciones.brands.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label>Modelo
              <select value={state.model} disabled={!state.brand} onChange={e=>set("model",e.target.value)}>
                <option value="">{state.brand?"Todos los modelos":"Primero elige marca"}</option>
                {opciones.models.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label>Año
              <select value={state.year} disabled={!state.brand} onChange={e=>set("year",e.target.value)}>
                <option value="">Todos los años registrados</option>
                {opciones.years.map(v=><option key={v} value={v}>{v==="unknown"?"Año no identificado":v}</option>)}
              </select>
            </label>
            {opciones.versions.length>1&&<label>Versión
              <select value={state.version} onChange={e=>set("version",e.target.value)}>
                <option value="">Todas las versiones</option>
                {opciones.versions.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </label>}
          </div>
        </details>

        {filtrosActivos.length>0&&<div className="cl-chips">
          {filtrosActivos.map(k=><button key={k} type="button" className="cl-btn" aria-label={"Quitar "+etiquetaFiltro(k)} onClick={()=>set(k,"")}>{etiquetaFiltro(k)} ×</button>)}
        </div>}
      </div>

      {/* ── Barra de resultados ── */}
      <div className="cl-bar">
        <p className="cl-count" aria-live="polite">
          {!activa?"Consulta por vehículo o por medida":
            resultado.total?`${fmt(grupos.length)} ${grupos.length===1?"configuración":"configuraciones"} · ${fmt(resultado.total)} ${resultado.total===1?"ficha":"fichas"}${resultado.partial?" · búsqueda parcial":""}`:"Sin coincidencias"}
        </p>
        <button type="button" className="cl-quiet" onClick={limpiar}>LIMPIAR</button>
      </div>

      {mostrarSize&&estadoConsulta.q&&<div className="cl-notice" role="status">
        {resultado.partial?"Medida incompleta o formato no reconocido. Completa la medida para una coincidencia precisa; ejemplo: 120/70-17 o 27x9-12."
         :resultado.exactSymbol?"Coincidencia de dimensiones y símbolo escrito. Confirma carga, velocidad y equipamiento."
         :"Coincidencia por dimensiones. Los resultados pueden mostrar R, ZR, B o guion: revisa la construcción antes de elegir."}
      </div>}

      {facetas.length>0&&<div className="cl-facets">
        <p>Acotar por marca</p>
        {facetas.map(([m,n])=><button key={m} type="button" className="cl-btn" onClick={()=>set("brand",m)}>{m} · {n}</button>)}
      </div>}

      {/* ── Resultados ── */}
      <div className="cl-results" aria-busy={state.q!==qDiferida}>
        {!activa&&<div className="cl-card cl-empty">
          <h3>Una consulta, las dos posiciones.</h3>
          <p>{fmt(db.rows.length)} fichas públicas. Elige un ejemplo o empieza a escribir.</p>
          <div className="cl-examples">{EJEMPLOS.map(([q,c])=><button key={q} type="button" className="cl-btn" onClick={()=>ejemplo(q,c)}>{q}</button>)}</div>
        </div>}

        {activa&&grupos.length===0&&<div className="cl-card cl-empty">
          <h3>No encontramos esa combinación.</h3>
          <p>La ausencia de resultados no confirma incompatibilidad: puede faltar cobertura de año o versión. Ajusta los filtros o consulta sin año.</p>
          <div className="cl-examples">
            <button type="button" className="cl-btn" onClick={()=>{setState(s=>({...DEFAULTS,q:s.q,category:s.category}));setLimit(PAGE);}}>Quitar filtros y conservar texto</button>
            {(YEAR_RE.test(state.q)||state.year)&&<button type="button" className="cl-btn" onClick={()=>{setState(s=>({...s,year:"",q:s.q.replace(new RegExp(YEAR_RE.source,"g"),"").trim()}));setLimit(PAGE);}}>Consultar sin año</button>}
            <button type="button" className="cl-btn" onClick={limpiar}>Empezar de nuevo</button>
          </div>
          {sugerencias.length>0&&<div className="cl-sugg" style={{marginTop:16}}>
            <p>¿Quisiste escribir alguno de estos? Confirma el modelo antes de consultar.</p>
            {sugerencias.map(q=><button key={q} type="button" className="cl-btn" onClick={()=>ejemplo(q)}>{q}</button>)}
          </div>}
        </div>}

        {activa&&grupos.slice(0,limit).map(g=>{
          const key=g.d._id;
          return <Ficha key={key} g={g} state={estadoConsulta} abierta={abiertas.has(key)} onToggle={()=>toggleEvidencia(key)}
            onCopiar={async()=>{const ok=await copiar(textoCopia(g));aviso(ok?"Medidas copiadas":"No se pudo copiar. Selecciona las medidas en el resultado.");}}/>;
        })}
      </div>
      {activa&&restantes>0&&<button type="button" className="cl-btn cl-more" onClick={()=>setLimit(l=>l+PAGE)}>Ver {Math.min(PAGE,restantes)} más ({restantes} restantes)</button>}

      <p className="cl-cov">{cobertura} Una similitud geométrica no autoriza montaje ni acredita carga, velocidad o compatibilidad.</p>
      {toast&&<div className="cl-toast" role="status">{toast}</div>}
    </div>
  );
}

// ── Tarjeta de resultado ──────────────────────────────────────
function Ficha({g,state,abierta,onToggle,onCopiar}){
  const d=g.d;
  const same=d._front&&d._rear&&d._front.exact===d._rear.exact;
  const avisos=[
    !d.year?"Año no identificado: esta ficha no confirma un año específico.":"",
    d._conflict?"Fuentes con medidas distintas para esta identificación. Confirma la versión.":"",
    (!d._front||!d._rear)?"Información incompleta o medida por revisar. No se supone la medida del otro eje.":"",
    d.variant_notice||"",
    d._unusual?"La fuente registra más ancho delante que atrás. Verifica esta configuración antes de elegir.":"",
    (d._multiple&&(!d.year||(!state.year&&!YEAR_RE.test(state.q))))?"Este modelo registra medidas diferentes. Confirma el año y la versión de tu vehículo.":"",
  ].filter(Boolean);
  const years=E.yearsLabel(g.years);
  const categoria=d.vehicle==="Moto"?"Moto":"Offroad";

  return(
    <article className="cl-card cl-result">
      <div className="cl-head">
        <div>
          <span className="cl-brand">{d.m}</span>
          <h3>{d.n}</h3>
          <p className="cl-years">{years}</p>
        </div>
        <span className="cl-tag">{d.vehicle||"Sin categoría"}</span>
      </div>
      {avisos.map((t,i)=><p key={i} className="cl-warn">{t}</p>)}
      {same?
        <div className="cl-same">
          <div className="cl-tlabel">MISMA MEDIDA DELANTERA Y TRASERA{d.vehicle==="Moto"?"":" · AMBOS EJES"}</div>
          <div className="cl-measure">{d.fd}</div>
          <small>Rin {d._front.rim}″{g.frontHit&&g.rearHit?" · Coincide en ambos ejes":""}</small>
        </div>
      :
        <div className="cl-tires">
          <Llanta d={d} ax="fd" hit={g.frontHit}/>
          <Llanta d={d} ax="rd" hit={g.rearHit}/>
        </div>
      }
      <p className="cl-meta">{d.market||"Mercado no identificado"}{g.records.length>1?` · ${g.records.length} fichas agrupadas con estas medidas`:""}</p>
      <div className="cl-actions">
        <button type="button" className="cl-btn" aria-expanded={abierta} onClick={onToggle}>{abierta?"Ocultar detalles":"Ver años, detalles y fuentes"}</button>
        <button type="button" className="cl-btn" onClick={onCopiar}>Copiar medidas</button>
      </div>
      {abierta&&<Evidencia g={g} categoria={categoria}/>}
    </article>
  );
}

function Llanta({d,ax,hit}){
  const t=ax==="fd"?d._front:d._rear;
  return(
    <div className={"cl-tire"+(hit?" hit":"")}>
      <div className="cl-tlabel">{ax==="fd"?"DELANTERA":"TRASERA"}{hit?" · COINCIDE":""}</div>
      <div className="cl-measure">{d[ax]||"Sin dato confirmado"}</div>
      <small>{t?`Rin ${t.rim}″`:"Consultar fuente antes de elegir"}</small>
    </div>
  );
}

function Evidencia({g,categoria}){
  const d=g.d;
  const porAnio=useMemo(()=>{
    const u=new Map();
    for(const r of g.records){const k=r.year||"unknown";if(!u.has(k))u.set(k,[]);u.get(k).push(r);}
    return [...u.values()].sort((a,b)=>(b[0].year||0)-(a[0].year||0));
  },[g]);
  return(
    <div className="cl-evidence">
      <div className="cl-actions" style={{marginTop:0}}>
        {d.fd&&<button type="button" className="cl-btn" onClick={()=>abrirConvertidor(d.fd,categoria)}>Comparar delantera ↗</button>}
        {d.rd&&<button type="button" className="cl-btn" onClick={()=>abrirConvertidor(d.rd,categoria)}>Comparar trasera ↗</button>}
      </div>
      <p style={{color:GRL,fontSize:12}}>Solo se agrupan años documentados con las mismas medidas. No se infieren años intermedios ni una generación del fabricante.</p>
      {porAnio.map(ds=>(
        <details key={ds[0].year||"unknown"}>
          <summary>{ds[0].year||"Año no identificado"} · Especificaciones y fuente</summary>
          {ds.map(r=><Fuente key={r._id} d={r}/>)}
        </details>
      ))}
    </div>
  );
}

function Fuente({d}){
  const fuentes=d.sources||[];
  return(
    <div>
      <p style={{margin:"6px 0"}}>{d.year||"Año no identificado"} · {d.market||"Mercado no identificado"}{d.note?" · "+d.note:""}</p>
      <ul>
        {fuentes.length?fuentes.map((s,i)=>{
          const u=urlSegura(s.u);
          return <li key={i}>
            {u?<a href={u} target="_blank" rel="noopener noreferrer">{s.source||"Fuente"} ↗</a>:(s.source||"Fuente sin enlace")} · {s.date||"Sin fecha de consulta"}<br/>
            Publicado: delantera {s.raw?.[0]||s.fd||"sin dato"}; trasera {s.raw?.[1]||s.rd||"sin dato"}.
          </li>;
        }):<li>Sin fuente enlazada. Requiere confirmación.</li>}
      </ul>
      <dl>{especificaciones(d).map(([k,v],i)=><FilaDl key={i} k={k} v={v}/>)}</dl>
    </div>
  );
}
const FilaDl=({k,v})=><><dt>{k}</dt><dd>{v}</dd></>;
