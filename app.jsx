import { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, setDoc,
  deleteDoc, writeBatch, getDoc, query, where
} from "firebase/firestore";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential
} from "firebase/auth";
import jsPDF from "jspdf";
import "jspdf-autotable";

// ══════════════════════════════════════════════════════════════
// CONFIGURACIÓN — EDITA ESTA SECCIÓN ANTES DE PUBLICAR
// ══════════════════════════════════════════════════════════════

// 1) Firebase. Crea un proyecto nuevo (ej. "portal-llantymoto") en
//    console.firebase.google.com → Configuración → Tus apps → Web,
//    y pega aquí el objeto que te da la consola.
const firebaseConfig = {
  apiKey: "AIzaSyAnOwHt4YSzATUInmtm5eiNnNMug_WgNrA",
  authDomain: "portal-llantymoto.firebaseapp.com",
  projectId: "portal-llantymoto",
  storageBucket: "portal-llantymoto.firebasestorage.app",
  messagingSenderId: "564165742899",
  appId: "1:564165742899:web:b699b03329918ef2f36e46"
};

// 2) Colecciones de Firestore.
//    Si prefieres reusar el proyecto de Tapatía en vez de crear uno nuevo,
//    cámbialas a "productos_moto", "usuarios_moto", etc. para no mezclar datos.
const COL = {
  productos:    "productos",   // interno: precios completos y existencia real
  // Catálogo que ve el cliente. Uno por lista de precio, con la existencia
  // ya topada: si hay 256 piezas, aquí se guarda 30. El número real NUNCA
  // sale del servidor, así que no hay nada que "descubrir" en el navegador.
  catalogo: {
    ASOCIADO:     "cat_asociado",
    DISTRIBUIDOR: "cat_distribuidor",
    PUBLICO:      "cat_publico",
  },
  usuarios:     "usuarios",
  cotizaciones: "cotizaciones",
  transitos:    "transitos",
  folios:       "folios",
  bitacora:     "bitacora",
};

// 3) Datos de la empresa que salen impresos en el PDF de cotización.
//    ⚠️ Llena los datos bancarios con los reales de LlantyMoto.
const EMPRESA = {
  nombre:   "LlantyMoto",
  eslogan:  "Llantas para moto, ATV y UTV",
  giro:     "Importadores de llantas para motocicleta, ATV, UTV y remolque",
  ciudad:   "Tlaquepaque, Jalisco, México",
  correo:   "ventas@llantymoto.com",
  web:      "llanty.app",
  banco:    "BBVA",
  titular:  "COMERCIAL LLANTERA TAPATÍA SA DE CV",
  cuenta:   "0154483138",
  clabe:    "012320001544831389",
  // La cuenta es del grupo y aplica igual para LlantyMoto. Se aclara en
  // el PDF para que el cliente no dude al ver un titular distinto.
  notaBanco:"Esta cuenta aplica para LlantyMoto y Comercial Llantera Tapatía.",
};
// Pon el logo.png en la raíz del repo y ajusta la URL (o deja el archivo
// en /public y usa "/logo.png").
const ESLOGAN = "Rodamos lo que vendemos.";
const LOGO_URL = "https://raw.githubusercontent.com/nicobuenrostro/portal-llantymoto/main/logo.png";
// Logos de las marcas: sube un PNG por marca a /marcas del repo, con el
// nombre en minúsculas y guiones (terra-plus.png, eurogrip.png, ...).
// Si el archivo no existe, el chip cae solo al nombre en texto.
const MARCAS_BASE = "https://raw.githubusercontent.com/nicobuenrostro/portal-llantymoto/main/marcas";
const slugMarca = m => String(m||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/\s+/g,"-");
const MARCA_LOGO = m => `${MARCAS_BASE}/${slugMarca(m)}.png`;
// Marcas cuyo logotipo es blanco: sobre chip blanco no se verían.
const MARCA_FONDO = { PLUSWAY:"#262626" };

// Marcas que NO llevan chip propio en el filtro. Sus productos siguen
// apareciendo normal en el catálogo, en las búsquedas y en TODAS; solo
// se agrupan bajo un chip "OTRAS" para no llenar la fila.
// Para volver a mostrar una marca, quítala de esta lista.
const MARCAS_OCULTAS = ["EUROGRIP","VIPAL","RAGE"];
const OTRAS = "__OTRAS__";
const esOculta = m => MARCAS_OCULTAS.includes(marcaKey(m));

// 4) Almacenes. La clave es el campo en Firestore; la etiqueta es lo que se ve.
const ALMS   = ["tlajo","meli"];
const ALMS_L = ["TLAJO","CHAPALA"];

// 5) En LlantyMoto los precios de lista YA INCLUYEN IVA.
//    Si algún día cambias a precios netos, pon PRECIOS_CON_IVA = false.
const PRECIOS_CON_IVA = true;
const TASA_IVA = 0.16;

// ══════════════════════════════════════════════════════════════

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
// Firebase exige mínimo 6 caracteres.
const MIN_PASS = 6;

// ── Paleta ────────────────────────────────────────────────────
const OR  = "#FF5C1E";   // naranja LlantyMoto
const DK  = "#1A1A1A";   // negro header
const GRL = "#818181";
const BG  = "#F5F5F5";
const CD  = "#ffffff";
const BD  = "#EBEBEB";
const VERDE = "#16A34A", AMBAR = "#D97706", NARANJA = "#EA580C", ROJO = "#DC2626";
// Colores de precio (mismos que Tapatía)
const C_PUB = {bg:"#F0FDF4",c:"#16A34A"}, C_DIST = {bg:"#EFF6FF",c:"#2563EB"}, C_ASOC = {bg:"#FFF7ED",c:"#EA580C"};

// Colores por marca (tomados del borrador)
const MARCA_COLOR = {
  ANLAS:{bg:"#E8F5E9",c:"#1B5E20"},        CEAT:{bg:"#FFF0EB",c:"#BF360C"},
  CUATRIMASTER:{bg:"#E0F7FA",c:"#006064"}, EUROGRIP:{bg:"#E3F2FD",c:"#0D47A1"},
  MITAS:{bg:"#F3E5F5",c:"#4A148C"},        OBOR:{bg:"#FCE4EC",c:"#B71C1C"},
  PLUSWAY:{bg:"#FFF3E0",c:"#E65100"},      RAGE:{bg:"#FCE4EC",c:"#880E4F"},
  TERRAMOUSSE:{bg:"#ECEFF1",c:"#37474F"},  TERRAPLUS:{bg:"#E8EAF6",c:"#1A237E"},
  URIDE:{bg:"#E0F2F1",c:"#004D40"},        VIPAL:{bg:"#FFFDE7",c:"#827717"},
};
const marcaKey = m => String(m||"").toUpperCase().replace(/\s+/g,"");
const marcaStyle = m => MARCA_COLOR[marcaKey(m)] || {bg:"#F0F0F0",c:GRL};

// ── Helpers ───────────────────────────────────────────────────
const safe    = v => String(v??"").trim();
const safeNum = v => {
  if(typeof v === "number") return isNaN(v)?0:v;
  const n = Number(String(v??"").replace(/[$,\s]/g,""));
  return isNaN(n)?0:n;
};
const money  = n => { const v=safeNum(n); return v===0?"—":new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:0,maximumFractionDigits:0}).format(v); };
const money2 = n => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:2}).format(safeNum(n));

// El total del reporte SAP manda; si no viene, se suma por almacén.
const calcTotal = p => {
  const t = safeNum(p.total);
  return t>0 ? t : ALMS.reduce((s,a)=>s+safeNum(p[a]),0);
};
// Escala de Tapatía: 0 rojo · 1-5 naranja · 6-20 ámbar · 21+ verde
const semaforo = t => t===0?ROJO : t<=5?NARANJA : t<=20?AMBAR : VERDE;
// El cliente no ve el inventario exacto arriba de 30 piezas.
const TOPE_STOCK = 30;
const stockVis = t => t>=TOPE_STOCK ? "+30" : String(t);
// Se aplica AL GUARDAR, no al pintar: lo que pasa de 30 se guarda como 30.
const topar = v => { const n=safeNum(v); return n>=TOPE_STOCK ? TOPE_STOCK : n; };
const almPpal  = p => { const i=ALMS.findIndex(a=>safeNum(p[a])>0); return i>=0?ALMS_L[i]:"—"; };
const getPrecio = (p,l) => {
  const s=safe(l).toUpperCase();
  if(s==="DISTRIBUIDOR") return safeNum(p.distribuidor);
  if(s==="ASOCIADO")     return safeNum(p.asociado);
  return safeNum(p.publico);
};
const clampDesc = v => Math.min(30,Math.max(0,Math.round(parseInt(v)||0)));

// ── Búsqueda ──────────────────────────────────────────────────
// Una medida NO son palabras sueltas: es un dato con estructura.
// Partirla por espacios y buscar cada pedazo como texto hacía que
// "25 8 r12" trajera 5.00-12, 120/70-12 y 80/100-12, porque todas
// contienen un 8 y un 12 en alguna parte. Ahora la medida se lee
// completa: se extraen sus grupos numéricos en orden y se comparan
// contra los del producto.
const sinAcentos = s => String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const norm  = s => sinAcentos(s).toUpperCase().replace(/ZR/g,"R").replace(/[^A-Z0-9]/g,"");
const digs  = s => String(s??"").replace(/[^0-9]/g,"");

// Firma de una medida: sus números en orden, más si el rin es radial.
// "25x8-12", "25 8 r12" y "25X8.00-12" dan todos [25,8,12].
// El .00 se cae solo porque parseFloat("8.00") es 8.
function firmaMedida(s){
  const u = sinAcentos(s).toUpperCase().replace(/ZR/g,"R");
  const nums = (u.match(/\d+(?:\.\d+)?/g)||[]).map(n=>String(parseFloat(n)));
  const radial = /R\s*\d+(\.\d+)?\s*$/.test(u.trim());
  return { nums, radial };
}
// ¿Este pedazo de la búsqueda es parte de una medida o es una palabra?
// "25x8-12", "R12", "120/70" son medida. "OBOR", "BEAST", "P3058" no.
const esTokenMedida = t => (/^[\dRXZB.\/-]+$/i.test(t) && /\d/.test(t)) || /^[RXZB]$/i.test(t);

function matchProducto(q,p){
  const raw = sinAcentos(q).toUpperCase().trim();
  if(!raw) return true;
  const toks    = raw.split(/\s+/).filter(Boolean);
  const medTok  = toks.filter(esTokenMedida);
  const palabras= toks.filter(t=>!esTokenMedida(t));
  const campoN  = norm(`${p.marca||""}${p.medida||""}${p.codigo||""}${p.descripcion||""}`);

  // Marca y modelo se siguen buscando como texto libre.
  for(const w of palabras) if(!campoN.includes(norm(w))) return false;
  if(!medTok.length) return true;

  const fq = firmaMedida(medTok.join(" "));
  if(fq.nums.length===0) return true;
  const fp = firmaMedida(p.medida||"");

  // Dos o más grupos: es una medida completa. Deben coincidir en orden.
  if(fq.nums.length>=2 && fp.nums.length>0){
    for(let i=0;i<fq.nums.length;i++) if(fq.nums[i]!==fp.nums[i]) return false;
    // La R no excluye: pedir "25 8 r12" muestra radiales y diagonales
    // de esa medida, para que el vendedor vea todas sus opciones.
    return true;
  }
  // Un solo grupo largo: la forma pegada ("25812") o un código de modelo.
  const d = fq.nums.join("").replace(".","");
  if(d.length>=4) return digs(`${p.medida||""}${p.codigo||""}${p.descripcion||""}`).includes(d);
  return campoN.includes(d);
}

function detectTipo(s){
  const u=String(s||"").toUpperCase();
  if(/\d{2,3}\/\d{2,3}\s*Z?R\d{2}/.test(u)) return "Radial métrica";
  if(/\d{2,3}\/\d{2,3}\s*-\s*\d{2}/.test(u)) return "Métrica diagonal";
  if(/\d{2}X[\d.]+R\d{2}/.test(u))          return "ATV/UTV radial";
  if(/\d{2}X[\d.]+-\d{1,2}/.test(u))        return "ATV/UTV diagonal";
  if(/\d\.\d{2}-\d{2}/.test(u))             return "Pulgada";
  return "";
}

// ── ETA (próximos arribos) ────────────────────────────────────
function etaSort(eta){
  const s=safe(eta).toUpperCase();
  if(/PUERTO|ARRIB|LLEG/.test(s)&&!/\d{1,2}\//.test(s)) return "0000-00-00";
  const m1=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m1) return `${m1[3]}-${m1[2].padStart(2,"0")}-${m1[1].padStart(2,"0")}`;
  const meses={ENE:"01",FEB:"02",MAR:"03",ABR:"04",MAY:"05",JUN:"06",JUL:"07",AGO:"08",SEP:"09",OCT:"10",NOV:"11",DIC:"12"};
  const m2=s.match(/(\d{1,2})\s*\/?\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)/i);
  if(m2) return `${new Date().getFullYear()}-${meses[m2[2].toUpperCase()]}-${m2[1].padStart(2,"0")}`;
  return "9999-99-99";
}
function yaArribado(eta){
  const s=safe(eta).toUpperCase();
  return /PUERTO|ARRIB|LLEG/.test(s)&&!/\d{1,2}\//.test(s);
}
const etaPuertoDisplay = eta => yaArribado(eta)?"ARRIBADO":(safe(eta)||"—");
function etaAlmacen(eta){
  const s=safe(eta);
  const fmt=d=>d.toLocaleDateString("es-MX",{day:"2-digit",month:"2-digit",year:"numeric"});
  if(yaArribado(s)){ const d=new Date(); d.setDate(d.getDate()+5); return fmt(d); }
  const m1=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m1){
    const d=new Date(Number(m1[3]),Number(m1[2])-1,Number(m1[1]));
    if(!isNaN(d.getTime())){ d.setDate(d.getDate()+8); return fmt(d); }
  }
  const meses={ENE:0,FEB:1,MAR:2,ABR:3,MAY:4,JUN:5,JUL:6,AGO:7,SEP:8,OCT:9,NOV:10,DIC:11};
  const m2=s.match(/(\d{1,2})\s*\/?\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)/i);
  if(m2){
    const d=new Date(new Date().getFullYear(),meses[m2[2].toUpperCase()],Number(m2[1]));
    if(!isNaN(d.getTime())){ d.setDate(d.getDate()+8); return fmt(d); }
  }
  return "Por confirmar";
}

// ── Firestore ─────────────────────────────────────────────────
async function fbGetUsuarios(){
  try{
    const snap=await getDocs(collection(db,COL.usuarios));
    return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>safe(a.nombre).localeCompare(safe(b.nombre)));
  }catch(e){ console.error("fbGetUsuarios:",e); return null; }
}
// El cliente lee su propia colección, en paquetes, para no gastar
// miles de lecturas por sesión.
async function fbGetCatalogoCliente(lista){
  try{
    const nombre=COL.catalogo[safe(lista).toUpperCase()]||COL.catalogo.PUBLICO;
    const snap=await getDocs(collection(db,nombre));
    const out=[];
    snap.docs.sort((a,b)=>a.id.localeCompare(b.id)).forEach(d=>{
      const crudo=d.data().items;
      let lista=[];
      try{ lista = typeof crudo==="string" ? JSON.parse(crudo) : (crudo||[]); }
      catch(e){ console.error("paquete ilegible:",d.id,e); lista=[]; }
      lista.forEach((it,i)=>{
        const [marca,medida,codigo,descripcion,precio,tlajo,meli,total]=it;
        // Las tres listas apuntan al mismo número: el cliente solo tiene la suya.
        out.push({id:`${d.id}_${i}`,marca,medida,codigo,descripcion,
          asociado:safeNum(precio),distribuidor:safeNum(precio),publico:safeNum(precio),
          tlajo:safeNum(tlajo),meli:safeNum(meli),total:safeNum(total)});
      });
    });
    return out;
  }catch(e){ console.error("fbGetCatalogoCliente:",e); return null; }
}
async function fbGetProductos(){
  try{
    const snap=await getDocs(collection(db,COL.productos));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){ console.error("fbGetProductos:",e); return null; }
}
async function fbGetCotizaciones(uid,verTodas){
  try{
    // El no-admin pide solo las suyas: las reglas no le dejarían leer el resto.
    const ref=collection(db,COL.cotizaciones);
    const snap=await getDocs(verTodas?ref:query(ref,where("uid","==",safe(uid))));
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    return data.sort((a,b)=>new Date(b.fecha||0)-new Date(a.fecha||0));
  }catch(e){ console.error("fbGetCotizaciones:",e); return null; }
}
async function fbGetTransitos(){
  try{
    const snap=await getDocs(collection(db,COL.transitos));
    return snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>etaSort(a.eta).localeCompare(etaSort(b.eta)));
  }catch(e){ console.error("fbGetTransitos:",e); return null; }
}

// ── Identidad ─────────────────────────────────────────────────
// El usuario teclea "nico"; por dentro es nico@llanty.app. Al ser
// determinista, iniciar sesión NO requiere leer la base antes de
// autenticar — por eso las reglas pueden quedar cerradas.
const DOMINIO_INTERNO = "llanty.app";
const emailDe = u => `${sinAcentos(u).toLowerCase().trim().replace(/[^a-z0-9._-]/g,"")}@${DOMINIO_INTERNO}`;

// Crear una cuenta desde el panel firmaría al admin como el usuario nuevo.
// Se usa una instancia aparte de Firebase para no tumbar su sesión.
// (Plan Spark: no hay Cloud Functions, así que se resuelve del lado del cliente.)
async function crearCuentaAuth(usuario,password){
  const app2=initializeApp(firebaseConfig,"alta-"+Date.now());
  try{
    const auth2=getAuth(app2);
    const cred=await createUserWithEmailAndPassword(auth2,emailDe(usuario),password);
    await signOut(auth2);
    return cred.user.uid;
  } finally { await deleteApp(app2); }
}
function mensajeAuth(e){
  const c=safe(e?.code);
  if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "Usuario o contraseña incorrectos";
  if(/too-many-requests/.test(c)) return "Demasiados intentos fallidos. Espera unos minutos.";
  if(/email-already-in-use/.test(c)) return "Ese usuario ya existe";
  if(/weak-password/.test(c)) return `La contraseña debe tener al menos ${MIN_PASS} caracteres`;
  if(/network-request-failed/.test(c)) return "Sin conexión. Revisa tu internet.";
  if(/requires-recent-login/.test(c)) return "Por seguridad, vuelve a entrar antes de cambiarla.";
  return safe(e?.message)||"Error inesperado";
}

// ── Permisos ──────────────────────────────────────────────────
const isAdminRole = s => s?.rol==="admin"||s?.rol==="superadmin";
const isVendedor  = s => s?.lista==="VENDEDOR"||isAdminRole(s);
// "Interno" = la gente de la casa. Ve todas las cotizaciones y las tres
// listas de precio. El cliente solo ve lo suyo.
const esInterno   = s => isVendedor(s);

// ── CSV ───────────────────────────────────────────────────────
const hdrKey = h => sinAcentos(h).toUpperCase().replace(/[^A-Z0-9]/g,"");
function parseCsv(text){
  const clean=text.replace(/^\uFEFF/,"");
  const lines=clean.trim().split(/\r?\n/);
  if(lines.length<2) return [];
  const first=lines[0];
  const delim=first.includes("\t")?"\t":first.includes(";")?";":",";
  const headers=first.split(delim).map(h=>hdrKey(h.replace(/"/g,"")));
  return lines.slice(1).map(line=>{
    const vals=splitLine(line,delim),obj={};
    headers.forEach((h,i)=>{ obj[h]=safe(vals[i]??"").replace(/^"|"$/g,""); });
    return obj;
  }).filter(r=>Object.values(r).some(v=>v!==""));
}
// Respeta comas dentro de comillas (las descripciones traen comas)
function splitLine(line,delim){
  const out=[]; let cur="", q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){ q=!q; continue; }
    if(ch===delim && !q){ out.push(cur); cur=""; continue; }
    cur+=ch;
  }
  out.push(cur);
  return out;
}
const pick = (row,...alias) => {
  for(const a of alias){ const k=hdrKey(a); if(row[k]!==undefined&&row[k]!=="") return row[k]; }
  return "";
};

// ── UI ────────────────────────────────────────────────────────
function MarcaChip({marca,size=10}){
  const s=marcaStyle(marca);
  return <span style={{background:s.bg,color:s.c,padding:"3px 10px",borderRadius:20,fontSize:size,fontWeight:800,letterSpacing:.3,display:"inline-block",whiteSpace:"nowrap"}}>{marca||"—"}</span>;
}
function Badge({val}){
  const map={PUBLICO:{bg:"#dcfce7",c:"#16a34a"},"PÚBLICO":{bg:"#dcfce7",c:"#16a34a"},DISTRIBUIDOR:{bg:"#dbeafe",c:"#2563eb"},ASOCIADO:{bg:"#ffede5",c:OR},VENDEDOR:{bg:"#f3e8ff",c:"#9333ea"},superadmin:{bg:"#fef3c7",c:"#d97706"},admin:{bg:"#dbeafe",c:"#2563eb"},client:{bg:"#f3f4f6",c:"#6b7280"},activo:{bg:"#dcfce7",c:"#16a34a"},inactivo:{bg:"#fee2e2",c:"#dc2626"}};
  const s=map[val]||{bg:"#f3f4f6",c:GRL};
  return <span style={{background:s.bg,color:s.c,padding:"2px 8px",borderRadius:3,fontSize:10,fontWeight:700,letterSpacing:1}}>{val}</span>;
}
function Inp({label,value,onChange,type="text",mb=12,placeholder=""}){
  return <div style={{marginBottom:mb}}>
    {label&&<div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{label}</div>}
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{width:"100%",padding:"10px 12px",background:"#fafafa",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:6,boxSizing:"border-box",outline:"none"}}/>
  </div>;
}
function Btn({onClick,children,danger,ghost,sm,disabled}){
  const bg=disabled?"#e5e7eb":danger?"#fee2e2":ghost?"transparent":OR;
  const cl=disabled?"#9ca3af":danger?"#dc2626":ghost?GRL:"#fff";
  const br=danger?"1px solid #fca5a5":ghost?"1px solid "+BD:"none";
  return <button onClick={disabled?undefined:onClick} disabled={disabled}
    style={{background:bg,color:cl,border:br,padding:sm?"5px 11px":"9px 16px",borderRadius:6,cursor:disabled?"not-allowed":"pointer",fontWeight:700,fontSize:sm?10:12,letterSpacing:1,whiteSpace:"nowrap",opacity:disabled?.6:1}}>
    {children}
  </button>;
}
function Logo({h=34,eslogan=true}){
  // El eslogan va centrado bajo el logotipo: alineado a la izquierda
  // arrancaba bajo el isotipo LM y se veía descuadrado.
  return <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
    <img src={LOGO_URL} alt={EMPRESA.nombre} style={{height:h,objectFit:"contain",maxWidth:250}}
      onError={e=>{e.target.style.display="none";}}/>
    {eslogan && <div style={{color:GRL,fontSize:h>=40?11:10,fontStyle:"italic",whiteSpace:"nowrap"}}>{ESLOGAN}</div>}
  </div>;
}
function MarcaFiltro({m,activa,onClick,mob}){
  const [ok,setOk]=useState(true);
  const [bg,fg]=MARCA_COLOR[marcaKey(m)]||["#F0F0F0",GRL];
  const todas = m==="", otras = m===OTRAS;
  const fondo = MARCA_FONDO[marcaKey(m)] || "#fff";
  // Los logotipos van SIEMPRE a color: así se reconoce la marca de un
  // vistazo. Lo seleccionado se marca con el chip, no apagando el logo:
  // borde naranja, fondo durazno, sombra y un leve levantón.
  const conFondoPropio = !!MARCA_FONDO[marcaKey(m)];
  const fondoChip = (todas||otras) ? (activa?DK:"#fff")
    : conFondoPropio ? fondo
    : ok ? (activa?"#FFF5F2":"#fff")
    : (activa?bg:"#fff");
  return <button onClick={onClick} title={otras?MARCAS_OCULTAS.join(" · "):(m||"Todas las marcas")}
    style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
      height:mob?40:46,minWidth:(todas||otras)?72:(ok?96:0),padding:(ok&&!todas&&!otras)?"0 12px":"0 14px",
      background:fondoChip,
      border:(activa?2:1.5)+"px solid "+(activa?(todas?DK:OR):BD),
      boxShadow:activa?"0 3px 10px rgba(255,92,30,.28)":"none",
      transform:activa?"translateY(-1px)":"none",
      borderRadius:10,cursor:"pointer",transition:"all .15s"}}>
    {(todas||otras)
      ? <span style={{fontSize:11,fontWeight:800,letterSpacing:.6,color:activa?"#fff":GRL}}>{todas?"TODAS":"OTRAS"}</span>
      : ok
        ? <img src={MARCA_LOGO(m)} alt={m} onError={()=>setOk(false)}
            style={{height:mob?22:26,maxWidth:100,objectFit:"contain"}}/>
        : <span style={{fontSize:11,fontWeight:800,letterSpacing:.5,whiteSpace:"nowrap",color:activa?fg:GRL}}>{m}</span>}
  </button>;
}

function Buscador({search,ds,onChange,marca,setMarca,marcas,count,mob,top=0}){
  const tipo=ds.trim().length>=2?detectTipo(ds.trim()):"";
  // Se queda pegado bajo el header: con 800+ SKUs el vendedor hace mucho
  // scroll y perder la barra a media lista es pura fricción.
  return <div style={{position:"sticky",top,zIndex:8,background:BG,paddingTop:10,marginTop:-10,paddingBottom:10}}>
  <div style={{background:"#222",padding:mob?"12px 12px":"12px 14px",borderBottom:"3px solid "+OR,display:"flex",flexDirection:mob?"column":"row",gap:8,alignItems:mob?"stretch":"center",borderRadius:8,marginBottom:10}}>
    <input value={search} onChange={e=>onChange(e.target.value)}
      placeholder={mob?"Buscar medida, marca o SKU...":"Buscar por medida, marca, SKU o descripción (ej: 120/70-17, mitas 90/90-21, 25x10-12)"}
      style={{flex:1,width:"100%",padding:"11px 14px",border:"2px solid transparent",borderRadius:8,background:"#fff",fontSize:14,color:"#222",outline:"none",boxSizing:"border-box"}}/>
    <span style={{color:OR,fontSize:12,fontWeight:700,background:"rgba(255,92,30,.1)",border:"1px solid rgba(255,92,30,.3)",padding:"7px 14px",borderRadius:20,whiteSpace:"nowrap",textAlign:"center"}}>
      {count} producto{count!==1?"s":""}{tipo?` · ${tipo}`:""}
    </span>
  </div>
  <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:6,scrollbarWidth:"none"}}>
    {["",...marcas.filter(m=>!esOculta(m))].map(m=>
      <MarcaFiltro key={m||"todas"} m={m} mob={mob} activa={marca===m} onClick={()=>setMarca(m)}/>)}
    {marcas.some(esOculta) &&
      <MarcaFiltro m={OTRAS} mob={mob} activa={marca===OTRAS} onClick={()=>setMarca(OTRAS)}/>}
  </div></div>;
}
function Pager({total,pg,setPg,ps=50}){
  const pages=Math.max(1,Math.ceil(total/ps));
  return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12,flexWrap:"wrap",gap:8}}>
    <span style={{color:GRL,fontSize:11}}>{total} productos · {PRECIOS_CON_IVA?"todos causan IVA, precios con IVA incluido":"precios antes de IVA"}</span>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <button onClick={()=>{setPg(p=>Math.max(0,p-1));window.scrollTo(0,0);}} disabled={pg===0}
        style={{padding:"6px 12px",background:pg===0?BD:OR,color:pg===0?GRL:"#fff",border:"none",borderRadius:6,cursor:pg===0?"default":"pointer",fontSize:11,fontWeight:700}}>← ANT</button>
      <span style={{color:GRL,fontSize:11}}>{pg+1}/{pages}</span>
      <button onClick={()=>{setPg(p=>Math.min(pages-1,p+1));window.scrollTo(0,0);}} disabled={pg+1>=pages}
        style={{padding:"6px 12px",background:pg+1>=pages?BD:OR,color:pg+1>=pages?GRL:"#fff",border:"none",borderRadius:6,cursor:pg+1>=pages?"default":"pointer",fontSize:11,fontWeight:700}}>SIG →</button>
    </div>
  </div>;
}

// ── PDF de cotización ─────────────────────────────────────────
async function generarPDF({folio,session,items,nota,vigencia,descuento,clienteNombre}){
  const sfolio   = safe(folio)||"S/F";
  const snota    = safe(nota);
  const svig     = safe(vigencia)||"7 días naturales";
  const scliente = safe(clienteNombre)||"Público en general";
  const sdesc    = clampDesc(descuento);
  const snombre  = safe(session?.nombre)||"—";
  const sitems   = Array.isArray(items)?items:[];
  const fecha    = new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"});

  const d=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=210,M=15;

  // Encabezado negro con franja naranja
  d.setFillColor(26,26,26); d.rect(0,0,W,42,"F");
  d.setFillColor(255,92,30); d.rect(0,42,W,2.5,"F");

  try{
    const resp=await fetch(LOGO_URL);
    const blob=await resp.blob();
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
    const img=new Image();
    await new Promise(r=>{img.onload=r;img.onerror=r;img.src=b64;});
    const ratio=(img.naturalWidth||3)/(img.naturalHeight||1);
    const imgH=18, imgW=imgH*ratio;
    d.addImage(b64,"PNG",M,6,imgW,imgH);
  }catch(e){
    d.setTextColor(255,255,255);d.setFontSize(17);d.setFont("helvetica","bold");
    d.text(EMPRESA.nombre.toUpperCase(),M,17);
  }

  d.setTextColor(255,92,30);d.setFontSize(8);d.setFont("helvetica","bolditalic");
  d.text(ESLOGAN,M,26);
  d.setTextColor(200,200,200);d.setFontSize(7.5);d.setFont("helvetica","normal");
  d.text(EMPRESA.giro,M,30.5);
  d.text(`${EMPRESA.ciudad}  |  ${EMPRESA.correo}  |  ${EMPRESA.web}`,M,33.5);

  d.setFillColor(255,92,30);d.rect(140,0,70,42,"F");
  d.setTextColor(255,255,255);d.setFontSize(15);d.setFont("helvetica","bold");
  d.text("COTIZACIÓN",175,14,{align:"center"});
  d.setFontSize(11);d.text(sfolio,175,22,{align:"center"});
  d.setFontSize(9);d.setFont("helvetica","normal");d.text(fecha,175,29,{align:"center"});

  let y=53;
  d.setFillColor(246,246,246);d.rect(M,y-4,W-M*2,26,"F");
  d.setDrawColor(230,230,230);d.setLineWidth(.3);d.rect(M,y-4,W-M*2,26);
  d.setTextColor(255,92,30);d.setFont("helvetica","bold");d.setFontSize(9);
  d.text("DATOS DE COTIZACIÓN",M+2,y+1);y+=6;

  const tf=(lbl,val,x1,x2)=>{
    d.setFont("helvetica","normal");d.setTextColor(90,90,90);d.setFontSize(8.5);d.text(lbl,x1,y);
    d.setFont("helvetica","bold");d.setTextColor(30,30,30);d.text(safe(val)||"—",x2,y);
  };
  tf("Folio:",sfolio,M+2,M+18);tf("Fecha:",fecha,100,116);y+=6;
  tf("Elaboró:",snombre,M+2,M+20);tf("Vigencia:",svig,100,116);y+=6;
  d.setFont("helvetica","normal");d.setTextColor(90,90,90);d.setFontSize(8.5);d.text("Cliente:",M+2,y);
  d.setFont("helvetica","bold");d.setTextColor(30,30,30);
  d.text(d.splitTextToSize(scliente,100)[0]||scliente,M+20,y);

  y+=10;
  d.setFont("helvetica","bold");d.setFontSize(8);d.setTextColor(37,99,235);
  d.text("Todos los productos causan IVA. Los precios de esta cotización ya incluyen el IVA del 16%.",M,y);
  y+=4;

  const rows=sitems.map((it,i)=>[
    i+1,
    safe(it.marca)||"—",
    safe(it.medida)||"—",
    safe(it.descripcion)||"—",
    safeNum(it.cantidad),
    money2(it.precio),
    money2(safeNum(it.precio)*safeNum(it.cantidad)),
  ]);

  d.autoTable({
    startY:y,
    head:[["#","MARCA","MEDIDA","DESCRIPCIÓN","CANT.","P. UNIT.","IMPORTE"]],
    body:rows,
    margin:{left:M,right:M},
    headStyles:{fillColor:[26,26,26],textColor:255,fontStyle:"bold",fontSize:7.5,halign:"center"},
    bodyStyles:{fontSize:7,textColor:[40,40,40]},
    columnStyles:{0:{halign:"center",cellWidth:7},1:{cellWidth:22},2:{cellWidth:22,fontStyle:"bold"},3:{cellWidth:62},4:{halign:"center",cellWidth:12},5:{halign:"right",cellWidth:23},6:{halign:"right",cellWidth:24}},
    alternateRowStyles:{fillColor:[250,250,250]},
    tableLineColor:[225,225,225],tableLineWidth:.1,
  });

  // Totales. Los precios de lista ya incluyen IVA → se desglosa hacia atrás.
  const bruto  = sitems.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad),0);
  const descMonto = sdesc>0?bruto*(sdesc/100):0;
  const total  = bruto-descMonto;
  const base   = PRECIOS_CON_IVA ? total/(1+TASA_IVA) : total;
  const iva    = PRECIOS_CON_IVA ? total-base : total*TASA_IVA;
  const granTotal = PRECIOS_CON_IVA ? total : total+iva;

  const fy=d.lastAutoTable.finalY+5;
  const bx=118,bw=77;let ty=fy;
  const nRows=sdesc>0?4:3;
  d.setFillColor(249,249,249);d.rect(bx,ty-2,bw,nRows*6.5+4,"F");
  d.setDrawColor(225,225,225);d.setLineWidth(.2);d.rect(bx,ty-2,bw,nRows*6.5+4);

  const trow=(lbl,val,color)=>{
    d.setFont("helvetica","normal");d.setFontSize(8.5);d.setTextColor(...(color||[90,90,90]));d.text(lbl,bx+2,ty+4);
    d.setFont("helvetica","bold");d.setTextColor(...(color||[30,30,30]));d.text(val,bx+bw-2,ty+4,{align:"right"});
    ty+=6.5;
  };
  trow("Importe lista (c/IVA):",money2(bruto));
  if(sdesc>0) trow(`Descuento (${sdesc}%):`,"-"+money2(descMonto),[200,30,30]);
  trow("Subtotal sin IVA:",money2(base));
  trow("IVA (16%):",money2(iva),[37,99,235]);

  d.setFillColor(255,92,30);d.rect(bx,ty+3,bw,9,"F");
  d.setTextColor(255,255,255);d.setFont("helvetica","bold");d.setFontSize(11);
  d.text("TOTAL:",bx+3,ty+9.5);
  d.text(money2(granTotal),bx+bw-2,ty+9.5,{align:"right"});

  if(snota){
    const ny=ty+18;
    if(ny<258){
      d.setTextColor(60,60,60);d.setFont("helvetica","bold");d.setFontSize(8);
      d.text("OBSERVACIONES:",M,ny);
      d.setFont("helvetica","normal");d.setFontSize(7.5);
      d.text(d.splitTextToSize(snota,W-M*2-5),M,ny+5);
    }
  }

  const by=ty+20+(snota?12:0);
  if(by<256){
    d.setFillColor(246,246,246);d.rect(M,by,W-M*2,25,"F");
    d.setDrawColor(225,225,225);d.rect(M,by,W-M*2,25);
    d.setTextColor(255,92,30);d.setFont("helvetica","bold");d.setFontSize(8);
    d.text("DATOS PARA DEPÓSITO / TRANSFERENCIA",M+2,by+5);
    const bf=(l,v,x1,x2,yy)=>{
      d.setFont("helvetica","normal");d.setFontSize(7.5);d.setTextColor(90,90,90);d.text(l,x1,yy);
      d.setFont("helvetica","bold");d.setTextColor(30,30,30);d.text(v,x2,yy);
    };
    bf("Banco:",EMPRESA.banco,M+2,M+16,by+11);
    bf("Titular:",EMPRESA.titular,100,114,by+11);
    bf("No. Cuenta:",EMPRESA.cuenta,M+2,M+26,by+17);
    bf("CLABE:",EMPRESA.clabe,100,114,by+17);
    d.setFont("helvetica","italic");d.setFontSize(6.5);d.setTextColor(120,120,120);
    d.text(EMPRESA.notaBanco,M+2,by+22);
  }

  d.setFillColor(26,26,26);d.rect(0,282,W,15,"F");
  d.setFillColor(255,92,30);d.rect(0,282,W,1.5,"F");
  d.setTextColor(255,255,255);d.setFont("helvetica","bold");d.setFontSize(7.5);
  d.text("Precios sujetos a cambio sin previo aviso. Sujeto a disponibilidad.",W/2,287.5,{align:"center"});
  d.setFont("helvetica","normal");d.setTextColor(190,190,190);
  d.text("Esta cotización es informativa y no constituye un pedido, factura ni compromiso de entrega.",W/2,291,{align:"center"});
  d.text(`${EMPRESA.nombre}  |  ${EMPRESA.web}  |  ${fecha}`,W/2,294.5,{align:"center"});

  d.save(`Cotizacion_${sfolio}.pdf`);
}

// ── Panel de cotización ───────────────────────────────────────
function CartPanel({cart,setCart,session,onClose}){
  const vend=isVendedor(session);
  const [nota,setNota]=useState("");
  const [vigencia,setVigencia]=useState("7 días naturales");
  const [descuento,setDescuento]=useState(0);
  const [clienteNombre,setClienteNombre]=useState("");
  const [generating,setGenerating]=useState(false);
  const [folioMsg,setFolioMsg]=useState("");

  const bruto=cart.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad),0);
  const descPct=clampDesc(descuento);
  const descMonto=vend&&descPct>0?bruto*(descPct/100):0;
  const total=bruto-descMonto;
  const base=PRECIOS_CON_IVA?total/(1+TASA_IVA):total;
  const iva=PRECIOS_CON_IVA?total-base:total*TASA_IVA;
  const granTotal=PRECIOS_CON_IVA?total:total+iva;

  const updCantidad=(idx,val)=>{const n=Math.max(1,parseInt(val)||1);setCart(prev=>prev.map((it,i)=>i===idx?{...it,cantidad:n}:it));};
  const updPrecio=(idx,tipo)=>setCart(prev=>prev.map((it,i)=>{
    if(i!==idx)return it;
    const p=tipo==="publico"?it._publico:tipo==="distribuidor"?it._distribuidor:it._asociado;
    return{...it,precio:safeNum(p),tipoPrecio:tipo};
  }));
  const remove=idx=>setCart(prev=>prev.filter((_,i)=>i!==idx));

  async function getNextFolio(){
    const uid=safe(session?.id)||"unknown";
    const ref=doc(db,COL.folios,uid);
    const snap=await getDoc(ref);
    const next=(snap.exists()?safeNum(snap.data().ultimo):0)+1;
    await setDoc(ref,{ultimo:next,usuario:safe(session?.usuario),actualizado:new Date().toISOString()},{merge:true});
    const prefix=safe(session?.usuario).substring(0,3).toUpperCase()||"USR";
    return `LM-${prefix}-${String(next).padStart(4,"0")}`;
  }

  async function generarCotizacion(){
    if(cart.length===0){setFolioMsg("❌ Agrega al menos un producto.");return;}
    setGenerating(true);setFolioMsg("Generando folio...");
    try{
      const folio=await getNextFolio();
      setFolioMsg(`📄 ${folio} — generando PDF...`);
      const descReal=vend?descPct:0;
      const nombreCliente=safe(clienteNombre)||"Público en general";
      await generarPDF({folio,session,items:cart,nota,vigencia,descuento:descReal,clienteNombre:nombreCliente});
      await setDoc(doc(db,COL.cotizaciones,folio),{
        folio,uid:safe(session?.id),usuario:safe(session?.usuario),nombre:safe(session?.nombre),
        empresa:safe(session?.empresa),items:cart,
        bruto,descuento:descReal,base,iva,total:granTotal,
        clienteNombre:nombreCliente,nota:safe(nota),vigencia:safe(vigencia),
        fecha:new Date().toISOString(),
      });
      setFolioMsg(`✅ ${folio} generada y guardada.`);
      setTimeout(()=>{setCart([]);onClose();},2000);
    }catch(e){
      console.error("generarCotizacion:",e);
      setFolioMsg("❌ Error: "+safe(e.message));
    }
    setGenerating(false);
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:2000,display:"flex",justifyContent:"flex-end",fontFamily:"Arial,sans-serif"}}>
      <div style={{width:"100%",maxWidth:520,background:"#fff",height:"100%",display:"flex",flexDirection:"column",boxShadow:"-4px 0 24px rgba(0,0,0,.2)"}}>
        <div style={{background:DK,borderBottom:"3px solid "+OR,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:15,letterSpacing:1}}>COTIZACIÓN</div>
            <div style={{color:"rgba(255,255,255,.7)",fontSize:11}}>{cart.length} producto{cart.length!==1?"s":""} · {money2(granTotal)}</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",width:32,height:32,borderRadius:"50%",cursor:"pointer",fontSize:16,fontWeight:700}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {cart.length===0&&<div style={{textAlign:"center",color:GRL,padding:40,fontSize:13}}>
            Agrega productos con el botón <strong style={{color:OR}}>＋</strong> del catálogo.
          </div>}
          {cart.map((it,i)=>(
            <div key={i} style={{border:"1px solid "+BD,borderRadius:8,padding:12,marginBottom:10,background:"#fafafa"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div style={{flex:1,marginRight:8}}>
                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3}}>
                    <MarcaChip marca={it.marca} size={9}/>
                    <span style={{fontSize:15,fontWeight:900,color:DK}}>{it.medida}</span>
                  </div>
                  <div style={{fontFamily:"monospace",color:"#bbb",fontSize:10}}>{it.codigo}</div>
                  <div style={{fontSize:12,fontWeight:500,lineHeight:1.3,color:"#444"}}>{it.descripcion}</div>
                </div>
                <button onClick={()=>remove(i)} style={{background:"#fee2e2",border:"none",color:"#dc2626",width:24,height:24,borderRadius:"50%",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>✕</button>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:11,color:GRL}}>Cant:</span>
                  <div style={{display:"flex",alignItems:"center",border:"1px solid "+BD,borderRadius:6,overflow:"hidden"}}>
                    <button onClick={()=>updCantidad(i,it.cantidad-1)} style={{background:"#f3f4f6",border:"none",padding:"4px 9px",cursor:"pointer",fontSize:14,fontWeight:700,color:"#374151"}}>−</button>
                    <input type="number" min="1" value={it.cantidad} onChange={e=>updCantidad(i,e.target.value)}
                      style={{width:42,textAlign:"center",border:"none",padding:4,fontSize:13,fontWeight:700,outline:"none"}}/>
                    <button onClick={()=>updCantidad(i,it.cantidad+1)} style={{background:"#f3f4f6",border:"none",padding:"4px 9px",cursor:"pointer",fontSize:14,fontWeight:700,color:"#374151"}}>＋</button>
                  </div>
                </div>
                {vend&&(
                  <select value={it.tipoPrecio} onChange={e=>updPrecio(i,e.target.value)}
                    style={{padding:"5px 8px",border:"1px solid "+BD,borderRadius:6,fontSize:11,color:"#374151",outline:"none",background:"#fff"}}>
                    <option value="publico">Público</option>
                    <option value="distribuidor">Distribuidor</option>
                    <option value="asociado">Asociado</option>
                  </select>
                )}
                <div style={{marginLeft:"auto",textAlign:"right"}}>
                  <div style={{fontSize:11,color:GRL}}>P. Unit: <strong style={{color:"#1a1a1a"}}>{money2(it.precio)}</strong> <span style={{fontSize:9,color:"#bbb"}}>c/IVA</span></div>
                  <div style={{fontSize:13,fontWeight:800,color:OR}}>{money2(safeNum(it.precio)*safeNum(it.cantidad))}</div>
                </div>
              </div>
            </div>
          ))}

          {cart.length>0&&<div style={{borderTop:"1px solid "+BD,paddingTop:14,marginTop:4}}>
          <div style={{marginBottom:10}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>A QUIÉN SE COTIZA</div>
            <input value={clienteNombre} onChange={e=>setClienteNombre(e.target.value)} placeholder="Público en general"
              style={{width:"100%",padding:"9px 11px",border:"1px solid "+BD,borderRadius:6,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>VIGENCIA</div>
            <select value={vigencia} onChange={e=>setVigencia(e.target.value)}
              style={{width:"100%",padding:"9px 11px",border:"1px solid "+BD,borderRadius:6,fontSize:12,outline:"none",background:"#fff"}}>
              <option>7 días naturales</option>
              <option>15 días naturales</option>
              <option>30 días naturales</option>
              <option>Sujeto a disponibilidad</option>
            </select>
          </div>
          {vend&&(
            <div style={{marginBottom:10}}>
              <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>DESCUENTO ADICIONAL % (0–30)</div>
              <input type="number" min="0" max="30" step="1" value={descuento}
                onChange={e=>setDescuento(clampDesc(e.target.value))}
                style={{width:"100%",padding:"9px 11px",border:"1px solid "+BD,borderRadius:6,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}/>
            </div>
          )}
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>OBSERVACIONES</div>
            <textarea value={nota} onChange={e=>setNota(e.target.value)} rows={2} placeholder="Condiciones especiales, entrega, etc."
              style={{width:"100%",padding:"9px 11px",border:"1px solid "+BD,borderRadius:6,fontSize:12,resize:"none",outline:"none",boxSizing:"border-box"}}/>
          </div>
          </div>}
        </div>

        <div style={{borderTop:"1px solid "+BD,padding:16,background:"#f9f9f9",flexShrink:0}}>
          <div style={{background:"#fff",border:"1px solid "+BD,borderRadius:6,padding:"10px 12px",marginBottom:12,fontSize:12}}>
            {vend&&descPct>0&&<div style={{display:"flex",justifyContent:"space-between",color:GRL,marginBottom:3}}>
              <span>Importe lista (c/IVA):</span><span style={{color:"#1a1a1a",fontWeight:600}}>{money2(bruto)}</span>
            </div>}
            {vend&&descPct>0&&<div style={{display:"flex",justifyContent:"space-between",color:"#dc2626",marginBottom:3}}>
              <span>Descuento ({descPct}%):</span><span style={{fontWeight:600}}>-{money2(descMonto)}</span>
            </div>}
            <div style={{display:"flex",justifyContent:"space-between",color:GRL,marginBottom:3}}>
              <span>Subtotal sin IVA:</span><span style={{color:"#1a1a1a",fontWeight:600}}>{money2(base)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,color:"#2563eb"}}>
              <span>IVA (16%):</span><span style={{fontWeight:600}}>{money2(iva)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:15,color:OR,borderTop:"1px solid "+BD,paddingTop:6,marginTop:4}}>
              <span>TOTAL:</span><span>{money2(granTotal)}</span>
            </div>
          </div>
          {folioMsg&&<div style={{fontSize:11,marginBottom:10,padding:"8px 12px",borderRadius:6,
            background:folioMsg.startsWith("✅")?"#f0fdf4":folioMsg.startsWith("❌")?"#fef2f2":"#fffbeb",
            color:folioMsg.startsWith("✅")?"#16a34a":folioMsg.startsWith("❌")?"#dc2626":"#d97706",
            border:`1px solid ${folioMsg.startsWith("✅")?"#bbf7d0":folioMsg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{folioMsg}</div>}
          <button onClick={generarCotizacion} disabled={generating||cart.length===0}
            style={{width:"100%",padding:13,background:cart.length===0?"#e5e7eb":OR,color:cart.length===0?GRL:"#fff",
              border:"none",borderRadius:6,cursor:cart.length===0?"not-allowed":"pointer",fontWeight:800,fontSize:14,letterSpacing:1,opacity:generating?.7:1}}>
            {generating?"GENERANDO...":"GENERAR COTIZACIÓN PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Historial ─────────────────────────────────────────────────
function HistorialCotizaciones({session}){
  const [cots,setCots]=useState([]);
  const [loading,setLoading]=useState(true);
  const [expanded,setExpanded]=useState(null);
  const admin=isAdminRole(session);
  const interno=esInterno(session);

  useEffect(()=>{
    let m=true;
    (async()=>{
      setLoading(true);
      const data=await fbGetCotizaciones(session?.id,interno);
      if(m&&data!==null) setCots(data);
      if(m) setLoading(false);
    })();
    return()=>{m=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function reimprimir(cot){
    try{
      await generarPDF({
        folio:cot.folio,
        session:{nombre:cot.nombre,empresa:cot.empresa},
        items:cot.items||[],nota:cot.nota||"",
        vigencia:cot.vigencia||"7 días naturales",
        descuento:cot.descuento||0,
        clienteNombre:cot.clienteNombre||"Público en general",
      });
    }catch(e){alert("Error al reimprimir: "+safe(e.message));}
  }

  if(loading) return <div style={{textAlign:"center",padding:40,color:GRL}}>Cargando historial...</div>;
  if(cots.length===0) return(
    <div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
      <div style={{fontSize:40,marginBottom:12}}>📋</div>
      <div style={{fontSize:14,fontWeight:600}}>Aún no hay cotizaciones</div>
      <div style={{fontSize:12,marginTop:6}}>Arma una desde el catálogo y aparecerá aquí.</div>
    </div>
  );

  return(
    <div>
      <div style={{marginBottom:12,color:GRL,fontSize:11}}>{cots.length} cotización{cots.length!==1?"es":""}</div>
      {cots.map(cot=>{
        const open=expanded===cot.folio;
        return(
          <div key={cot.folio} style={{background:CD,border:"1px solid "+BD,borderRadius:8,marginBottom:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",cursor:"pointer"}} onClick={()=>setExpanded(open?null:cot.folio)}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontWeight:800,fontSize:13,fontFamily:"monospace",color:OR}}>{cot.folio}</span>
                  {admin&&<span style={{fontSize:11,color:GRL}}>· {cot.nombre}{cot.empresa?` (${cot.empresa})`:""}</span>}
                </div>
                <div style={{display:"flex",gap:12,marginTop:3,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:GRL}}>{cot.fecha?new Date(cot.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):""}</span>
                  <span style={{fontSize:11,fontWeight:700,color:"#1a1a1a"}}>{money2(cot.total??cot.bruto)}</span>
                  {cot.clienteNombre&&<span style={{fontSize:11,color:GRL}}>→ {cot.clienteNombre}</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button onClick={e=>{e.stopPropagation();reimprimir(cot);}}
                  style={{background:OR,color:"#fff",border:"none",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>PDF</button>
                <span style={{color:GRL,fontSize:16,transform:open?"rotate(180deg)":"none",transition:"transform .2s"}}>▾</span>
              </div>
            </div>
            {open&&(
              <div style={{borderTop:"1px solid "+BD,padding:"12px 16px",background:"#fafafa",overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#f0f0f0"}}>
                    {["MARCA","MEDIDA","DESCRIPCIÓN","CANT.","P. UNIT.","IMPORTE"].map(h=>
                      <th key={h} style={{padding:"6px 10px",textAlign:["CANT.","P. UNIT.","IMPORTE"].includes(h)?"right":"left",color:OR,fontWeight:700,fontSize:10}}>{h}</th>)}
                  </tr></thead>
                  <tbody>{(cot.items||[]).map((it,i)=><tr key={i} style={{borderTop:"1px solid #f0f0f0"}}>
                    <td style={{padding:"5px 10px"}}><MarcaChip marca={it.marca} size={9}/></td>
                    <td style={{padding:"5px 10px",fontWeight:800}}>{it.medida}</td>
                    <td style={{padding:"5px 10px",color:"#555"}}>{it.descripcion}</td>
                    <td style={{padding:"5px 10px",textAlign:"right"}}>{it.cantidad}</td>
                    <td style={{padding:"5px 10px",textAlign:"right"}}>{money2(it.precio)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",fontWeight:700,color:OR}}>{money2(safeNum(it.precio)*safeNum(it.cantidad))}</td>
                  </tr>)}</tbody>
                </table>
                <div style={{display:"flex",justifyContent:"flex-end",gap:16,marginTop:10,paddingTop:8,borderTop:"1px solid "+BD,flexWrap:"wrap",fontSize:12}}>
                  {safeNum(cot.descuento)>0&&<span style={{color:"#dc2626"}}>Desc. {cot.descuento}%</span>}
                  <span style={{color:GRL}}>Subtotal s/IVA: <strong>{money2(cot.base??cot.subtotal)}</strong></span>
                  <span style={{color:"#2563eb"}}>IVA: <strong>{money2(cot.iva)}</strong></span>
                  <span style={{fontWeight:800,color:OR}}>Total: {money2(cot.total??cot.bruto)}</span>
                </div>
                {cot.nota&&<div style={{marginTop:6,fontSize:11,color:GRL}}><strong>Nota:</strong> {cot.nota}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Próximos arribos ──────────────────────────────────────────
function ProximosArribos({session,mob}){
  const [transitos,setTransitos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [ds,setDs]=useState("");
  const [msg,setMsg]=useState("");
  const [uploading,setUploading]=useState(false);
  const fref=useRef();
  const timer=useRef(null);
  const admin=isAdminRole(session);

  useEffect(()=>{
    let m=true;
    (async()=>{
      setLoading(true);
      const data=await fbGetTransitos();
      if(m&&data!==null) setTransitos(data);
      if(m) setLoading(false);
    })();
    return()=>{m=false;};
  },[]);

  useEffect(()=>{
    if(timer.current) clearTimeout(timer.current);
    timer.current=setTimeout(()=>setDs(search),300);
    return()=>{if(timer.current)clearTimeout(timer.current);};
  },[search]);

  const grouped=useMemo(()=>{
    const q=ds.trim();
    const filtered=(!q||q.length<2)?transitos:transitos.filter(t=>matchProducto(q,{descripcion:t.producto||"",codigo:t.sku||"",medida:"",marca:""}));
    const map={};
    filtered.forEach(t=>{
      const key=safe(t.sku)||safe(t.producto);
      if(!map[key]) map[key]={sku:t.sku,producto:t.producto,arribos:[]};
      map[key].arribos.push({qty:t.qty,eta:t.eta});
    });
    const arr=Object.values(map);
    arr.forEach(g=>g.arribos.sort((a,b)=>etaSort(a.eta).localeCompare(etaSort(b.eta))));
    arr.sort((a,b)=>etaSort(a.arribos[0]?.eta).localeCompare(etaSort(b.arribos[0]?.eta)));
    return arr;
  },[transitos,ds]);

  const totalPiezas=grouped.reduce((s,g)=>s+g.arribos.reduce((s2,a)=>s2+safeNum(a.qty),0),0);

  async function handleFile(e){
    const file=e.target.files[0];if(!file)return;e.target.value="";
    if(/\.xlsx?$/i.test(file.name)){setMsg("⚠️ Guarda el archivo como CSV UTF-8 desde Excel.");return;}
    setUploading(true);setMsg("📂 Leyendo archivo...");
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const rows=parseCsv(ev.target.result);
        if(rows.length===0){setMsg("❌ El archivo no trae filas de datos.");setUploading(false);return;}
        const mapped=rows.map(r=>({
          sku:      pick(r,"SKU","CODIGO","CÓDIGO"),
          producto: pick(r,"PRODUCTO","DESCRIPCION","DESCRIPCIÓN"),
          qty:      safeNum(pick(r,"QTY","CANTIDAD","PIEZAS")),
          eta:      pick(r,"ETA","FECHA"),
          actualizado:new Date().toISOString(),
        })).filter(p=>p.sku||p.producto);
        if(mapped.length===0){setMsg("❌ No se reconoció ninguna columna. Revisa los encabezados.");setUploading(false);return;}
        setMsg("Actualizando arribos...");
        const oldSnap=await getDocs(collection(db,COL.transitos));
        if(oldSnap.docs.length>0){
          const del=writeBatch(db);
          oldSnap.docs.forEach(d=>del.delete(d.ref));
          await del.commit();
        }
        for(let i=0;i<mapped.length;i+=400){
          const batch=writeBatch(db);
          mapped.slice(i,i+400).forEach((p,j)=>batch.set(doc(collection(db,COL.transitos),`t_${String(i+j).padStart(6,"0")}`),p));
          await batch.commit();
        }
        const data=await fbGetTransitos();
        if(data!==null) setTransitos(data);
        setMsg(`✅ ${mapped.length} registros de arribos guardados.`);
      }catch(err){setMsg("❌ Error: "+safe(err.message));}
      setUploading(false);
    };
    reader.readAsText(file,"UTF-8");
  }

  return(
    <div>
      {admin&&<div style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:14,marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:180}}>
          <div style={{fontWeight:800,fontSize:12,marginBottom:3}}>ACTUALIZAR ARRIBOS</div>
          <div style={{color:GRL,fontSize:11}}>CSV UTF-8 con las columnas:</div>
          <div style={{color:"#bbb",fontSize:10,marginTop:2}}>SKU, PRODUCTO, QTY, ETA — la ETA es la fecha de llegada a puerto (DD/MM/AAAA), o la palabra PUERTO si ya arribó.</div>
        </div>
        <input type="file" accept=".csv,.tsv,.txt" ref={fref} onChange={handleFile} style={{display:"none"}}/>
        <Btn onClick={()=>{setMsg("");fref.current.click();}} disabled={uploading}>{uploading?"SUBIENDO...":"SUBIR CSV"}</Btn>
        {msg&&<div style={{fontSize:11,width:"100%",padding:"8px 12px",borderRadius:6,
          background:msg.startsWith("✅")?"#f0fdf4":msg.startsWith("❌")?"#fef2f2":"#fffbeb",
          color:msg.startsWith("✅")?"#16a34a":msg.startsWith("❌")?"#dc2626":"#d97706",
          border:`1px solid ${msg.startsWith("✅")?"#bbf7d0":msg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{msg}</div>}
      </div>}

      <div style={{background:"#eff6ff",borderLeft:"3px solid #2563eb",border:"1px solid #bfdbfe",borderRadius:6,padding:"9px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:16}}>🚢</span>
        <span style={{color:GRL,fontSize:11}}>
          Fecha aproximada a CEDIS: producto <strong style={{color:"#16a34a"}}>ARRIBADO</strong> en puerto = <strong style={{color:"#2563eb"}}>hoy + 5 días</strong> · ETA con fecha = <strong style={{color:"#2563eb"}}>fecha de puerto + 8 días</strong>. Puede variar.
        </span>
      </div>

      <div style={{marginBottom:14}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Escribe la medida o el SKU para ver sus arribos..."
          style={{width:"100%",padding:"11px 14px",border:"2px solid "+OR,borderRadius:8,fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        {ds.trim().length>=2&&<div style={{marginTop:5,color:"#bbb",fontSize:10}}>{grouped.length} producto{grouped.length!==1?"s":""} · {totalPiezas.toLocaleString("es-MX")} piezas en camino</div>}
      </div>

      {loading&&<div style={{textAlign:"center",padding:40,color:GRL}}>Cargando próximos arribos...</div>}

      {!loading&&transitos.length===0&&<div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
        <div style={{fontSize:40,marginBottom:12}}>🚢</div>
        <div style={{fontSize:14,fontWeight:600}}>Sin arribos programados por ahora</div>
      </div>}

      {!loading&&transitos.length>0&&ds.trim().length<2&&<div style={{textAlign:"center",padding:"30px 20px",color:GRL,fontSize:13}}>
        <div style={{fontSize:30,marginBottom:8}}>🔍</div>
        Escribe la medida o el código del producto para ver sus próximos arribos.
      </div>}

      {!loading&&ds.trim().length>=2&&grouped.length===0&&<div style={{textAlign:"center",padding:30,color:GRL,fontSize:13}}>
        No hay arribos programados para "<strong>{ds}</strong>".
      </div>}

      {!loading&&ds.trim().length>=2&&grouped.map((g,i)=>(
        <div key={i} style={{background:CD,border:"1px solid "+BD,borderRadius:10,marginBottom:12,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
          <div style={{background:"#FFF5F2",padding:mob?"12px 14px":"14px 18px",borderBottom:"1px solid #ffd9c9"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
              <div style={{flex:1,minWidth:200}}>
                {safe(g.sku)
                  ?<span style={{fontFamily:"monospace",background:"#fff",border:"1.5px solid "+OR,color:OR,fontWeight:800,fontSize:mob?11:12,padding:"3px 10px",borderRadius:14,display:"inline-block"}}>{g.sku}</span>
                  :<span style={{background:"#fef3c7",color:"#d97706",border:"1px solid #fde68a",padding:"3px 10px",borderRadius:14,fontSize:11,fontWeight:800,display:"inline-block"}}>CÓDIGO PENDIENTE</span>}
                <div style={{fontSize:mob?14:16,fontWeight:700,color:DK,marginTop:6,lineHeight:1.3}}>{g.producto}</div>
              </div>
              <div style={{textAlign:"center",background:"#fff",border:"1px solid #ffd9c9",borderRadius:8,padding:"6px 16px"}}>
                <div style={{fontSize:9,color:GRL,letterSpacing:1,fontWeight:700}}>{g.arribos.length} ARRIBO{g.arribos.length!==1?"S":""}</div>
                <div style={{fontSize:mob?18:22,fontWeight:800,color:OR,lineHeight:1.2}}>{g.arribos.reduce((s,a)=>s+safeNum(a.qty),0).toLocaleString("es-MX")}</div>
                <div style={{fontSize:9,color:GRL,letterSpacing:1}}>PIEZAS</div>
              </div>
            </div>
          </div>
          <div>
            {g.arribos.map((a,j)=>{
              const arrib=yaArribado(a.eta);
              return(
                <div key={j} style={{display:"flex",alignItems:"center",gap:mob?10:16,padding:mob?"10px 14px":"12px 18px",borderTop:j>0?"1px solid #f3f4f6":"none",flexWrap:"wrap",background:arrib?"#f0fdf4":"transparent"}}>
                  <div style={{minWidth:mob?74:96,fontSize:mob?15:17,fontWeight:800,color:"#16a34a"}}>
                    {safeNum(a.qty).toLocaleString("es-MX")} <span style={{fontSize:11,fontWeight:700,color:GRL}}>pzas</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:mob?8:12,flex:1,flexWrap:"wrap"}}>
                    <div style={{background:arrib?"#16a34a":"#f0fdf4",border:"1px solid "+(arrib?"#16a34a":"#bbf7d0"),borderRadius:8,padding:"5px 12px",textAlign:"center"}}>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:1,color:arrib?"rgba(255,255,255,.85)":"#16a34a"}}>⚓ PUERTO</div>
                      <div style={{fontSize:mob?12:13,fontWeight:800,color:arrib?"#fff":"#15803d"}}>{etaPuertoDisplay(a.eta)}</div>
                    </div>
                    <span style={{color:"#cbd5e1",fontSize:mob?14:18,fontWeight:700}}>→</span>
                    <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"5px 12px",textAlign:"center"}}>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:1,color:"#2563eb"}}>🏭 CEDIS APROX.</div>
                      <div style={{fontSize:mob?12:13,fontWeight:800,color:"#1d4ed8"}}>{etaAlmacen(a.eta)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Contraseña en la tabla de clientes ────────────────────────
// Las contraseñas las guarda Firebase Authentication, cifradas, fuera
// de nuestra base. Nadie —ni el administrador— puede consultarlas.
// Para reponer una: consola de Firebase → Authentication → el usuario
// → Restablecer contraseña.
function PassCell(){
  return <span style={{fontSize:11,color:GRL}} title="Gestionada por Firebase Authentication">
    🔒 protegida
  </span>;
}

// ── Cambiar mi contraseña ─────────────────────────────────────
function ChangePassword(){
  const [actual,setActual]=useState(""),[nueva,setNueva]=useState(""),[conf,setConf]=useState("");
  const [msg,setMsg]=useState(""),[loading,setLoading]=useState(false);
  async function cambiar(){
    if(!actual||!nueva||!conf){setMsg("❌ Completa los tres campos.");return;}
    if(nueva!==conf){setMsg("❌ Las contraseñas nuevas no coinciden.");return;}
    if(nueva.length<MIN_PASS){setMsg(`❌ Mínimo ${MIN_PASS} caracteres.`);return;}
    setLoading(true);setMsg("");
    try{
      const u=auth.currentUser;
      if(!u){setMsg("❌ Tu sesión expiró. Vuelve a entrar.");setLoading(false);return;}
      // Firebase exige confirmar la actual antes de dejar cambiarla.
      await reauthenticateWithCredential(u,EmailAuthProvider.credential(u.email,actual));
      await updatePassword(u,nueva);
      setMsg("✅ Contraseña cambiada.");setActual("");setNueva("");setConf("");
    }catch(e){ setMsg("❌ "+mensajeAuth(e)); }
    setLoading(false);
  }
  return <div>
    <div style={{display:"grid",gap:10}}>
      {[["CONTRASEÑA ACTUAL",actual,setActual],["CONTRASEÑA NUEVA",nueva,setNueva],["CONFIRMAR",conf,setConf]].map(([lbl,val,set])=>(
        <div key={lbl}><div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{lbl}</div>
          <input type="password" value={val} onChange={e=>set(e.target.value)} style={{width:"100%",padding:"10px 12px",background:"#fafafa",border:"1px solid "+BD,fontSize:13,borderRadius:6,boxSizing:"border-box",outline:"none"}}/>
        </div>
      ))}
    </div>
    {msg&&<div style={{marginTop:10,fontSize:12,color:msg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600}}>{msg}</div>}
    <button onClick={cambiar} disabled={loading} style={{marginTop:14,background:OR,color:"#fff",border:"none",padding:"10px 20px",borderRadius:6,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12,opacity:loading?.7:1}}>
      {loading?"GUARDANDO...":"CAMBIAR CONTRASEÑA"}
    </button>
  </div>;
}

// ── Crear admin ───────────────────────────────────────────────
function CreateAdmin({session,mob}){
  const [form,setForm]=useState({nombre:"",usuario:"",password:"",confirmar:""});
  const [msg,setMsg]=useState(""),[loading,setLoading]=useState(false);
  const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
  async function crear(){
    if(!form.nombre||!form.usuario||!form.password){setMsg("❌ Completa todos los campos.");return;}
    if(form.password!==form.confirmar){setMsg("❌ Las contraseñas no coinciden.");return;}
    if(form.password.length<MIN_PASS){setMsg(`❌ Mínimo ${MIN_PASS} caracteres.`);return;}
    setLoading(true);setMsg("");
    try{
      // La cuenta se crea en Firebase Auth; el documento solo guarda el perfil.
      const uid=await crearCuentaAuth(form.usuario,form.password);
      await setDoc(doc(db,COL.usuarios,uid),{
        nombre:form.nombre.trim(),usuario:form.usuario.trim(),
        rol:"admin",lista:"VENDEDOR",estatus:"activo",empresa:EMPRESA.nombre,
        creado_por:safe(session?.nombre),creado_en:new Date().toISOString(),actualizado:new Date().toISOString()
      });
      setMsg(`✅ Administrador '${form.usuario}' creado.`);setForm({nombre:"",usuario:"",password:"",confirmar:""});
    }catch(e){setMsg("❌ "+mensajeAuth(e));}
    setLoading(false);
  }
  return <div>
    <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
      {[["NOMBRE","nombre"],["USUARIO","usuario"],["CONTRASEÑA","password"],["CONFIRMAR","confirmar"]].map(([lbl,k])=>(
        <div key={k} style={{marginBottom:12}}>
          <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{lbl}</div>
          <input type={k==="password"||k==="confirmar"?"password":"text"} value={form[k]} onChange={e=>upd(k,e.target.value)}
            style={{width:"100%",padding:"10px 12px",background:"#fafafa",border:"1px solid "+BD,fontSize:13,borderRadius:6,boxSizing:"border-box",outline:"none"}}/>
        </div>
      ))}
    </div>
    {msg&&<div style={{fontSize:12,color:msg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600,marginBottom:10}}>{msg}</div>}
    <button onClick={crear} disabled={loading} style={{background:OR,color:"#fff",border:"none",padding:"10px 20px",borderRadius:6,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12,opacity:loading?.7:1}}>
      {loading?"CREANDO...":"CREAR ADMINISTRADOR"}
    </button>
  </div>;
}

// ── Ficha de producto (móvil) ─────────────────────────────────
function CardProducto({p,vend,lista,onAdd}){
  const tot=calcTotal(p), col=semaforo(tot);
  return(
    <div style={{background:CD,borderRadius:12,boxShadow:"0 2px 8px rgba(0,0,0,.08)",overflow:"hidden",borderTop:"3px solid "+OR,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px 8px"}}>
        <MarcaChip marca={p.marca} size={12}/>
        <span style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:800,color:col}}>
          <span style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0}}/>
          {stockVis(tot)} pzs
        </span>
      </div>
      <div style={{fontFamily:"monospace",fontSize:10,color:"#BBB",padding:"0 14px 4px"}}>{p.codigo}</div>
      <div style={{fontSize:22,fontWeight:900,color:DK,padding:"0 14px 6px",letterSpacing:-.5,lineHeight:1.1}}>{p.medida||"—"}</div>
      <div style={{fontSize:13,color:"#444",padding:"0 14px 12px",lineHeight:1.5,fontWeight:500}}>{p.descripcion}</div>

      {vend?(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",background:BG,borderTop:"1px solid "+BD}}>
          {[["PÚBLICO",p.publico,C_PUB],["DISTRIBUIDOR",p.distribuidor,C_DIST],["ASOCIADO",p.asociado,C_ASOC]].map(([l,v,st])=>(
            <div key={l} style={{padding:"10px 6px",textAlign:"center",background:st.bg}}>
              <div style={{fontSize:9,color:GRL,fontWeight:700,letterSpacing:.5}}>{l}</div>
              <div style={{fontSize:8,color:"#BBB",fontWeight:600,marginBottom:3}}>IVA incl.</div>
              <div style={{fontSize:15,fontWeight:800,color:st.c}}>{money(v)}</div>
            </div>
          ))}
        </div>
      ):(
        <div style={{background:BG,borderTop:"1px solid "+BD,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:9,color:GRL,fontWeight:700,letterSpacing:.6}}>TU PRECIO ({safe(lista)||"PÚBLICO"}) · IVA INCL.</div>
            <div style={{fontSize:10,color:GRL,marginTop:2}}>Almacén ppal: <strong style={{color:DK}}>{almPpal(p)}</strong></div>
          </div>
          <span style={{fontSize:19,fontWeight:900,color:OR}}>{money(getPrecio(p,lista))}</span>
        </div>
      )}

      <div style={{borderTop:"1px solid "+BD,background:"#FAFAFA"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px 4px"}}>
          <span style={{fontSize:9,fontWeight:700,color:GRL,letterSpacing:.6}}>DISPONIBILIDAD POR ALMACÉN</span>
          <span style={{fontSize:10,fontWeight:800,color:tot>0?"#16A34A":"#DC2626"}}>{tot>0?"● Disponible":"● Sin stock"}</span>
        </div>
        <div style={{display:"flex",gap:8,padding:"4px 14px 10px"}}>
          {ALMS.map((a,i)=>{const v=safeNum(p[a]);return(
            <div key={a} style={{display:"flex",flexDirection:"column",alignItems:"center",background:"#fff",border:"1px solid "+BD,borderRadius:8,padding:"6px 12px",flex:1}}>
              <span style={{fontSize:9,color:GRL,fontWeight:700,letterSpacing:.5,marginBottom:3}}>{ALMS_L[i]}</span>
              <span style={{fontSize:v>0?16:12,fontWeight:v>0?800:400,color:v>0?DK:"#ccc"}}>{v>0?stockVis(v):"--"}</span>
            </div>
          );})}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",background:"#FFF5F2",border:"1px solid "+OR,borderRadius:8,padding:"6px 12px",flex:1}}>
            <span style={{fontSize:9,color:GRL,fontWeight:700,letterSpacing:.5,marginBottom:3}}>TOTAL</span>
            <span style={{fontSize:16,fontWeight:800,color:OR}}>{stockVis(tot)}</span>
          </div>
        </div>
      </div>
      <button onClick={onAdd} style={{width:"100%",padding:11,background:OR,color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:12,letterSpacing:1}}>
        ＋ AGREGAR A COTIZACIÓN
      </button>
      <div style={{textAlign:"center",padding:7,fontSize:9,color:"#999",background:"#FAFAFA",borderTop:"1px solid "+BD,letterSpacing:.3,fontWeight:600}}>
        {PRECIOS_CON_IVA?"TODOS LOS PRECIOS INCLUYEN IVA 16%":"PRECIOS ANTES DE IVA"}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════════════
export default function App(){
  const [session,setSession]=useState(null);
  const [view,setView]=useState("cargando");
  const [tab,setTab]=useState("products");
  const [users,setUsers]=useState([]);
  const [products,setProducts]=useState([]);
  const [prodLoad,setProdLoad]=useState(false);
  const [userLoad,setUserLoad]=useState(false);
  const [search,setSearch]=useState("");
  const [ds,setDs]=useState("");
  const [marca,setMarca]=useState("");
  const [page,setPage]=useState(0);
  const [cart,setCart]=useState([]);
  const [cartOpen,setCartOpen]=useState(false);
  const PS=50;
  const [lu,setLu]=useState(""),[lp,setLp]=useState(""),[lerr,setLerr]=useState("");
  const [loginLoad,setLoginLoad]=useState(false);
  const [msg,setMsg]=useState("");
  const [modal,setModal]=useState(null);
  const [saving,setSaving]=useState(false);
  const [mob,setMob]=useState(typeof window!=="undefined"?window.innerWidth<768:false);
  const fref=useRef();const timer=useRef(null);
  const hdrRef=useRef(null);const [hdrH,setHdrH]=useState(0);
  const emptyC={nombre:"",empresa:"",usuario:"",password:"",lista:"DISTRIBUIDOR",estatus:"activo"};

  useEffect(()=>{const h=()=>setMob(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  // Alto real del header, para que el buscador se pegue justo debajo.
  useEffect(()=>{
    const el=hdrRef.current; if(!el) return;
    const upd=()=>setHdrH(el.offsetHeight);
    upd();
    if(typeof ResizeObserver==="undefined") return;
    const ro=new ResizeObserver(upd); ro.observe(el);
    return()=>ro.disconnect();
  },[session,view,mob]);
  useEffect(()=>{
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>{setDs(search);setPage(0);},300);
    return()=>{if(timer.current)clearTimeout(timer.current);};
  },[search]);
  useEffect(()=>{setPage(0);},[marca]);
  // Firebase recuerda la sesión; al arrancar nos dice si hay alguien dentro.
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async u=>{
      if(!u){ setSession(null); setView("login"); setLoginLoad(false); return; }
      try{
        const snap=await getDoc(doc(db,COL.usuarios,u.uid));
        if(!snap.exists()){
          await signOut(auth);
          setLerr("Tu cuenta no tiene perfil. Contacta al administrador.");
          setSession(null); setView("login"); setLoginLoad(false); return;
        }
        const perfil={id:u.uid,...snap.data()};
        if(safe(perfil.estatus)==="inactivo"){
          await signOut(auth);
          setLerr("Cuenta inactiva. Contacta al administrador.");
          setSession(null); setView("login"); setLoginLoad(false); return;
        }
        setSession(perfil);
        setView(isAdminRole(perfil)?"admin":"client");
        setLerr(""); setLoginLoad(false);
        await loadProducts(perfil);
        if(isAdminRole(perfil)){ const ud=await fbGetUsuarios(); if(ud!==null)setUsers(ud); }
      }catch(e){
        console.error("perfil:",e);
        setLerr("No se pudo cargar tu perfil.");
        setSession(null); setView("login"); setLoginLoad(false);
      }
    });
    return ()=>unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function loadProducts(perfil){
    const u=perfil||session;
    setProdLoad(true);
    const d = esInterno(u) ? await fbGetProductos() : await fbGetCatalogoCliente(u?.lista);
    if(d!==null)setProducts(d);
    setProdLoad(false);
  }
  async function loadUsers(){setUserLoad(true);const d=await fbGetUsuarios();if(d!==null)setUsers(d);setUserLoad(false);}

  const marcas=useMemo(()=>{
    const s=new Set(products.map(p=>safe(p.marca)).filter(Boolean));
    return Array.from(s).sort();
  },[products]);

  const filtered=useMemo(()=>{
    let r=products;
    if(marca===OTRAS)  r=r.filter(p=>esOculta(p.marca));
    else if(marca)     r=r.filter(p=>safe(p.marca)===marca);
    const q=ds.trim();
    if(q) r=r.filter(p=>matchProducto(q,p));
    // Igual que Tapatía: más existencia primero, sin stock hasta el final.
    return [...r].sort((a,b)=>{
      const ta=calcTotal(a),tb=calcTotal(b);
      if(ta===0&&tb===0) return 0;
      if(ta===0) return 1;
      if(tb===0) return -1;
      return tb-ta;
    });
  },[products,ds,marca]);

  function addToCart(p){
    const lista=safe(session?.lista).toUpperCase();
    const vend=isVendedor(session);
    const tipoPrecio=vend?"publico":lista==="DISTRIBUIDOR"?"distribuidor":lista==="ASOCIADO"?"asociado":"publico";
    const precio=tipoPrecio==="publico"?safeNum(p.publico):tipoPrecio==="distribuidor"?safeNum(p.distribuidor):safeNum(p.asociado);
    setCart(prev=>{
      const idx=prev.findIndex(it=>it.codigo===p.codigo);
      if(idx>=0) return prev.map((it,i)=>i===idx?{...it,cantidad:it.cantidad+1}:it);
      return [...prev,{
        marca:safe(p.marca),medida:safe(p.medida),
        codigo:safe(p.codigo),descripcion:safe(p.descripcion),
        precio,tipoPrecio,cantidad:1,
        _publico:safeNum(p.publico),_distribuidor:safeNum(p.distribuidor),_asociado:safeNum(p.asociado),
      }];
    });
  }

  async function doLogin(){
    if(!safe(lu)||!safe(lp)){setLerr("Escribe tu usuario y contraseña");return;}
    setLerr("");setLoginLoad(true);
    try{
      // Firebase valida en su servidor; aquí nunca vemos la contraseña.
      await signInWithEmailAndPassword(auth,emailDe(lu),lp);
      setLu("");setLp("");
      // El resto lo hace onAuthStateChanged: perfil, catálogo y vista.
    }catch(e){ setLerr(mensajeAuth(e)); setLoginLoad(false); }
  }

  async function doLogout(){
    try{ await signOut(auth); }catch(e){ console.error("signOut:",e); }
    setSession(null);setView("login");setSearch("");setDs("");setMarca("");setPage(0);
    setProducts([]);setUsers([]);setCart([]);
  }

  async function handleFile(e){
    const file=e.target.files[0];if(!file)return;e.target.value="";
    if(/\.xlsx?$/i.test(file.name)){setMsg("⚠️ Guarda el archivo como CSV UTF-8 desde Excel.");return;}
    setMsg("📂 Leyendo archivo...");
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const rows=parseCsv(ev.target.result);
        if(rows.length===0){setMsg("❌ El archivo no trae filas de datos.");return;}
        const mapped=rows.map(r=>{
          const tlajo=safeNum(pick(r,"TLAJO"));
          const meli =safeNum(pick(r,"MELI","CHAPALA"));
          const totalCol=safeNum(pick(r,"TOTAL","TOTALALMACEN","TOTAL ALMACÉN","EXISTENCIA"));
          return {
            marca:      pick(r,"MARCA"),
            medida:     pick(r,"MEDIDA"),
            codigo:     pick(r,"CODIGO","CÓDIGO","SKU","NUMERO DE ARTICULO","NÚMERO DE ARTÍCULO"),
            descripcion:pick(r,"DESCRIPCION","DESCRIPCIÓN"),
            asociado:     safeNum(pick(r,"ASOCIADO")),
            distribuidor: safeNum(pick(r,"DISTRIBUIDOR")),
            publico:      safeNum(pick(r,"PVP","PUBLICO","PÚBLICO","PVP PUBLICO")),
            tlajo, meli,
            total: totalCol>0?totalCol:(tlajo+meli),
            actualizado:new Date().toISOString(),
          };
        }).filter(p=>p.codigo);
        if(mapped.length===0){setMsg("❌ Ninguna fila trae código. Revisa el encabezado CODIGO.");return;}
        setMsg("Respaldando catálogo anterior...");
        const oldSnap=await getDocs(collection(db,COL.productos));
        if(oldSnap.docs.length>0){
          const ts=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
          const bk=writeBatch(db);oldSnap.docs.forEach(d=>bk.set(doc(db,`respaldo_${ts}`,d.id),d.data()));await bk.commit();
          setMsg("Eliminando versión anterior...");
          const del=writeBatch(db);oldSnap.docs.forEach(d=>del.delete(d.ref));await del.commit();
        }
        for(let i=0;i<mapped.length;i+=400){
          const batch=writeBatch(db);
          mapped.slice(i,i+400).forEach((p,j)=>batch.set(doc(collection(db,COL.productos),`p_${String(i+j).padStart(6,"0")}`),p));
          await batch.commit();setMsg(`Guardando ${Math.min(i+400,mapped.length)} / ${mapped.length}...`);
        }
        const verify=await getDocs(collection(db,COL.productos));
        if(verify.size===0){setMsg("❌ No se guardó nada. Revisa las reglas de Firestore.");return;}

        // ── Catálogos para clientes ──────────────────────────────
        // Se arma uno por lista de precio, con SOLO su precio y la
        // existencia ya topada en 30. Lo que rebasa ese número no se
        // escribe en ningún lado, así que el cliente no puede sacarlo.
        const TIERS=[["ASOCIADO","asociado"],["DISTRIBUIDOR","distribuidor"],["PUBLICO","publico"]];
        const POR_PAQUETE=250;
        for(const [lista,campo] of TIERS){
          const nombre=COL.catalogo[lista];
          setMsg(`Generando catálogo ${lista.toLowerCase()}...`);
          const previo=await getDocs(collection(db,nombre));
          if(previo.docs.length>0){
            const del=writeBatch(db);previo.docs.forEach(d=>del.delete(d.ref));await del.commit();
          }
          const items=mapped.map(p=>[
            safe(p.marca), safe(p.medida), safe(p.codigo), safe(p.descripcion),
            safeNum(p[campo]),
            topar(p.tlajo), topar(p.meli), topar(p.total),
          ]);
          const bat=writeBatch(db);
          for(let i=0,n=0;i<items.length;i+=POR_PAQUETE,n++){
            // Firestore NO admite arreglos dentro de arreglos, así que el
            // paquete viaja como texto JSON y se reconstruye al leerlo.
            bat.set(doc(db,nombre,`c_${String(n).padStart(3,"0")}`),
              {parte:n,items:JSON.stringify(items.slice(i,i+POR_PAQUETE)),
               n:items.slice(i,i+POR_PAQUETE).length,actualizado:new Date().toISOString()});
          }
          await bat.commit();
        }
        await setDoc(doc(db,COL.bitacora,`carga_${Date.now()}`),{tipo:"carga_productos",por:safe(session?.nombre),cantidad:mapped.length,fecha:new Date().toISOString()});
        await loadProducts();setMsg(`✅ ${mapped.length} productos cargados.`);
      }catch(err){console.error("handleFile:",err);setMsg("❌ Error: "+safe(err.message));}
    };
    reader.readAsText(file,"UTF-8");
  }

  async function saveClient(form){
    setSaving(true);
    try{
      if(!safe(form.nombre)||!safe(form.usuario)){alert("Nombre y usuario son obligatorios.");setSaving(false);return;}
      if(!form.id&&safe(form.password).length<MIN_PASS){alert(`La contraseña es obligatoria y debe tener al menos ${MIN_PASS} caracteres.`);setSaving(false);return;}
      if(!form.id&&users.find(u=>safe(u.usuario)===safe(form.usuario))){alert("Ese usuario ya existe.");setSaving(false);return;}
      // Alta: primero la cuenta en Firebase Auth; el id del perfil es su uid.
      const id=form.id||await crearCuentaAuth(form.usuario,safe(form.password));
      const data={nombre:safe(form.nombre),empresa:safe(form.empresa),usuario:safe(form.usuario),lista:safe(form.lista),estatus:safe(form.estatus),rol:"client",actualizado:new Date().toISOString()};
      if(!form.id)data.creado_en=new Date().toISOString();
      await setDoc(doc(db,COL.usuarios,id),data,{merge:true});
      const verify=await getDoc(doc(db,COL.usuarios,id));
      if(!verify.exists()){alert("No se guardó. Intenta de nuevo.");setSaving(false);return;}
      await setDoc(doc(db,COL.bitacora,`u_${Date.now()}`),{tipo:form.id?"edicion_usuario":"nuevo_usuario",usuario:safe(form.usuario),por:safe(session?.nombre),fecha:new Date().toISOString()});
      await loadUsers();setModal(null);
    }catch(err){alert("Error: "+mensajeAuth(err));}
    setSaving(false);
  }

  async function toggleEstatus(id,est){
    try{
      await setDoc(doc(db,COL.usuarios,id),{estatus:est==="activo"?"inactivo":"activo",actualizado:new Date().toISOString()},{merge:true});
      setUsers(prev=>prev.map(u=>u.id===id?{...u,estatus:est==="activo"?"inactivo":"activo"}:u));
    }catch(err){alert("Error: "+safe(err.message));}
  }
  async function deleteClient(id,nombre,rol){
    if(rol==="admin"&&users.filter(u=>u.rol==="admin").length<=1){alert("No puedes eliminar al único administrador.");return;}
    if(!window.confirm(`¿Eliminar a ${nombre}?\n\nPierde el acceso de inmediato. Su cuenta queda sin perfil, así que no podrá entrar ni leer nada.\nPara borrarla del todo: consola de Firebase → Authentication.`))return;
    try{
      await deleteDoc(doc(db,COL.usuarios,id));
      await setDoc(doc(db,COL.bitacora,`del_${Date.now()}`),{tipo:"eliminacion_usuario",usuario_id:id,usuario_nombre:safe(nombre),por:safe(session?.nombre),fecha:new Date().toISOString()});
      setUsers(prev=>prev.filter(u=>u.id!==id));
    }catch(err){alert("Error: "+safe(err.message));}
  }

  function ClientModal(){
    const isEdit=modal.mode==="edit";
    const [form,setForm]=useState(isEdit?{...modal.data,password:""}:{...emptyC});
    const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
    return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:CD,borderRadius:10,padding:24,width:"100%",maxWidth:460,boxShadow:"0 8px 40px rgba(0,0,0,.2)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:800,fontSize:14,color:OR,marginBottom:18}}>{isEdit?"EDITAR CLIENTE":"NUEVO CLIENTE"}</div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <Inp label="NOMBRE *" value={form.nombre} onChange={e=>upd("nombre",e.target.value)}/>
          <Inp label="EMPRESA" value={form.empresa||""} onChange={e=>upd("empresa",e.target.value)}/>
          <Inp label="USUARIO *" value={form.usuario} onChange={e=>upd("usuario",e.target.value)}/>
          <Inp label={isEdit?"NUEVA CONTRASEÑA (vacío = no cambia)":"CONTRASEÑA *"} value={form.password} onChange={e=>upd("password",e.target.value)} type="password"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>LISTA DE PRECIOS *</div>
            <select value={form.lista} onChange={e=>upd("lista",e.target.value)} style={{width:"100%",padding:"10px 12px",background:"#fafafa",border:"1px solid "+BD,fontSize:13,borderRadius:6,outline:"none"}}>
              <option value="PUBLICO">PÚBLICO</option><option value="DISTRIBUIDOR">DISTRIBUIDOR</option>
              <option value="ASOCIADO">ASOCIADO</option><option value="VENDEDOR">VENDEDOR (ve las tres listas)</option>
            </select>
          </div>
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>ESTATUS</div>
            <select value={form.estatus} onChange={e=>upd("estatus",e.target.value)} style={{width:"100%",padding:"10px 12px",background:"#fafafa",border:"1px solid "+BD,fontSize:13,borderRadius:6,outline:"none"}}>
              <option value="activo">Activo</option><option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <Btn ghost onClick={()=>setModal(null)}>CANCELAR</Btn>
          <Btn onClick={()=>saveClient(form)} disabled={saving}>{saving?"GUARDANDO...":"GUARDAR"}</Btn>
        </div>
      </div>
    </div>;
  }

  const Hdr=session&&(
    <header ref={hdrRef} style={{background:DK,padding:mob?"10px 14px":"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:9,boxShadow:"0 2px 10px rgba(0,0,0,.4)"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <Logo h={mob?36:50}/>
        {!mob&&<>
          <div style={{width:1,height:24,background:"rgba(255,255,255,.2)"}}/>
          <span style={{color:"rgba(255,255,255,.75)",fontSize:10,letterSpacing:2}}>{isAdminRole(session)?"PANEL ADMINISTRADOR":"PORTAL DE PRECIOS"}</span>
        </>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{background:OR,color:"#fff",fontSize:10,fontWeight:700,padding:"4px 12px",borderRadius:20,letterSpacing:.5,whiteSpace:"nowrap"}}>
          {PRECIOS_CON_IVA?"PRECIOS CON IVA INCLUIDO":"PRECIOS SIN IVA"}
        </span>
        {!mob&&<div style={{textAlign:"right"}}>
          <div style={{color:"#fff",fontSize:12,fontWeight:600}}>{session.nombre}</div>
          {session.empresa&&<div style={{color:"rgba(255,255,255,.6)",fontSize:10}}>{session.empresa}</div>}
        </div>}
        <button onClick={doLogout} style={{background:"rgba(255,255,255,.12)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",padding:"7px 14px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:11,letterSpacing:1}}>SALIR</button>
      </div>
    </header>
  );

  const CartFab=cart.length>0&&!cartOpen&&(
    <button onClick={()=>setCartOpen(true)} style={{position:"fixed",bottom:24,right:24,zIndex:1000,background:OR,color:"#fff",border:"none",borderRadius:50,padding:"12px 20px",cursor:"pointer",fontWeight:800,fontSize:13,boxShadow:"0 4px 16px rgba(255,92,30,.5)",display:"flex",alignItems:"center",gap:8}}>
      COTIZACIÓN
      <span style={{background:"#fff",color:OR,borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{cart.length}</span>
    </button>
  );

  const TabBar=({items})=>(
    <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto"}}>
      {items.map(([k,l])=>(
        <button key={k} onClick={()=>setTab(k)} style={{padding:mob?"11px 12px":"12px 18px",background:"none",border:"none",color:tab===k?OR:GRL,borderBottom:tab===k?"3px solid "+OR:"3px solid transparent",cursor:"pointer",fontSize:mob?11:12,fontWeight:700,letterSpacing:1,marginBottom:-1,whiteSpace:"nowrap"}}>{l}</button>
      ))}
    </div>
  );

  if(view==="cargando") return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Arial,sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <Logo h={54}/>
        <div style={{color:GRL,fontSize:12,letterSpacing:2,marginTop:16}}>CARGANDO...</div>
      </div>
    </div>
  );

  // ── LOGIN ───────────────────────────────────────────────────
  if(view==="login") return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Arial,sans-serif",padding:16}}>
      <div style={{width:"100%",maxWidth:370,background:CD,borderRadius:12,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,.14)"}}>
        <div style={{background:DK,borderBottom:"3px solid "+OR,padding:"24px 28px",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
          <Logo h={64}/>
          <span style={{color:GRL,fontSize:10,fontStyle:"italic"}}>{EMPRESA.eslogan}</span>
        </div>
        <div style={{padding:"26px 28px 24px"}}>
          <div style={{color:GRL,fontSize:11,letterSpacing:3,textAlign:"center",marginBottom:20}}>PORTAL DE PRECIOS</div>
          <Inp label="USUARIO" value={lu} onChange={e=>setLu(e.target.value)}/>
          <div style={{marginBottom:20}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>CONTRASEÑA</div>
            <input type="password" value={lp} onChange={e=>setLp(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")doLogin();}}
              style={{width:"100%",padding:"10px 12px",background:"#fafafa",border:"1px solid "+BD,fontSize:13,borderRadius:6,boxSizing:"border-box",outline:"none"}}/>
          </div>
          {lerr&&<div style={{color:"#dc2626",fontSize:12,textAlign:"center",marginBottom:12,fontWeight:600}}>{lerr}</div>}
          <button onClick={doLogin} disabled={loginLoad}
            style={{width:"100%",padding:12,background:OR,color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:800,cursor:loginLoad?"wait":"pointer",letterSpacing:2,opacity:loginLoad?.7:1}}>
            {loginLoad?"VERIFICANDO...":"ENTRAR"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── ADMIN ───────────────────────────────────────────────────
  if(view==="admin") return(
    <div style={{minHeight:"100vh",background:BG,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
      {Hdr}{modal&&<ClientModal/>}
      {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} onClose={()=>setCartOpen(false)}/>}
      {CartFab}
      <TabBar items={[["products","CATÁLOGO"],["clients","CLIENTES"],["quotes","COTIZACIONES"],["arribos","ARRIBOS"],["settings","CONFIGURACIÓN"]]}/>
      <div style={{padding:mob?12:24,maxWidth:1400,margin:"0 auto"}}>

        {tab==="products"&&<div>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:14,marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
            <div style={{flex:1,minWidth:180}}>
              <div style={{fontWeight:800,fontSize:12,marginBottom:3}}>ACTUALIZAR CATÁLOGO</div>
              <div style={{color:GRL,fontSize:11}}>CSV UTF-8 con las columnas:</div>
              <div style={{color:"#bbb",fontSize:10,marginTop:2}}>MARCA, MEDIDA, CODIGO, DESCRIPCION, ASOCIADO, DISTRIBUIDOR, PVP, TLAJO, MELI, TOTAL</div>
            </div>
            <input type="file" accept=".csv,.tsv,.txt" ref={fref} onChange={handleFile} style={{display:"none"}}/>
            <Btn onClick={()=>{setMsg("");fref.current.click();}}>SUBIR CSV</Btn>
            <button onClick={loadProducts} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
            {msg&&<div style={{fontSize:11,width:"100%",padding:"8px 12px",borderRadius:6,
              background:msg.startsWith("✅")?"#f0fdf4":msg.startsWith("❌")?"#fef2f2":"#fffbeb",
              color:msg.startsWith("✅")?"#16a34a":msg.startsWith("❌")?"#dc2626":"#d97706",
              border:`1px solid ${msg.startsWith("✅")?"#bbf7d0":msg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{msg}</div>}
          </div>

          <Buscador search={search} ds={ds} onChange={setSearch} marca={marca} setMarca={setMarca} marcas={marcas} count={filtered.length} mob={mob} top={hdrH}/>
          {prodLoad&&<div style={{textAlign:"center",padding:30,color:GRL}}>Cargando catálogo...</div>}
          {!prodLoad&&products.length===0&&<div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
            <div style={{fontSize:40,marginBottom:12}}>📦</div>
            <div style={{fontSize:14,fontWeight:600}}>El catálogo está vacío</div>
            <div style={{fontSize:12,marginTop:6}}>Sube el CSV para empezar.</div>
          </div>}
          {!prodLoad&&products.length>0&&<div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:10,background:"#fff"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:DK}}>
                {["MARCA","MEDIDA","SKU","DESCRIPCIÓN"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}</th>)}
                {["PÚBLICO","DIST.","ASOCIADO"].map(h=><th key={h} style={{padding:"10px 8px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}<div style={{fontSize:8,fontWeight:400,letterSpacing:0,color:"rgba(255,255,255,.55)"}}>IVA incl.</div></th>)}
                {[...ALMS_L,"TOTAL"].map(h=><th key={h} style={{padding:"10px 8px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}</th>)}
                <th style={{width:36}}></th>
              </tr></thead>
              <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                const tot=calcTotal(p),col=semaforo(tot);
                return <tr key={p.id||i} style={{borderBottom:"1px solid "+BD,background:i%2?"#FAFAFA":"#fff"}}>
                  <td style={{padding:"8px 12px"}}><MarcaChip marca={p.marca}/></td>
                  <td style={{padding:"8px 12px",fontWeight:900,fontSize:14,color:DK,whiteSpace:"nowrap"}}>{p.medida||"—"}</td>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:10,color:"#999"}}>{p.codigo}</td>
                  <td style={{padding:"8px 12px",maxWidth:280,fontSize:12,color:"#444",lineHeight:1.3}}>{p.descripcion}</td>
                  <td style={{padding:"8px",textAlign:"right",color:OR,fontWeight:800}}>{money(p.publico)}</td>
                  <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.distribuidor)}</td>
                  <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.asociado)}</td>
                  {ALMS.map(a=>{const v=safeNum(p[a]);return <td key={a} style={{padding:"8px",textAlign:"right",color:v>0?"#555":"#ddd"}}>{v>0?v:"--"}</td>;})}
                  <td style={{padding:"8px",textAlign:"right",fontWeight:800,fontSize:14,color:col}}>{tot}</td>
                  <td style={{padding:"6px 8px"}}>
                    <button onClick={()=>addToCart(p)} title="Agregar a cotización"
                      style={{background:OR,color:"#fff",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>＋</button>
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
          {products.length>0&&<Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>}
        </div>}

        {tab==="clients"&&<div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:8,flexWrap:"wrap"}}>
            <div><span style={{color:GRL,fontSize:11}}>{users.length} usuarios registrados</span>{userLoad&&<span style={{color:OR,fontSize:11,marginLeft:8}}>cargando...</span>}</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
              <Btn onClick={()=>setModal({mode:"create",data:{}})}>+ NUEVO CLIENTE</Btn>
            </div>
          </div>
          {mob?(
            <div>{users.map(u=><div key={u.id} style={{background:isAdminRole(u)?"#eff6ff":CD,border:"1px solid "+(isAdminRole(u)?"#bfdbfe":BD),borderRadius:8,padding:14,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <div>
                  <div style={{fontWeight:700,fontSize:13}}>{u.nombre}{isAdminRole(u)&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>ADMIN</span>}</div>
                  {u.empresa&&<div style={{color:GRL,fontSize:11}}>{u.empresa}</div>}
                </div>
                <Badge val={u.estatus}/>
              </div>
              <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}><Badge val={isAdminRole(u)?u.rol:u.lista}/><span style={{color:GRL,fontSize:11,fontFamily:"monospace"}}>@{u.usuario}</span></div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {!isAdminRole(u)&&<Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>}
                {!isAdminRole(u)&&<Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>}
                {u.id!==session?.id&&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
              </div>
            </div>)}</div>
          ):(
            <div style={{border:"1px solid "+BD,borderRadius:10,overflow:"hidden",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,background:"#fff"}}>
                <thead><tr style={{background:DK}}>{["NOMBRE","EMPRESA","USUARIO","CONTRASEÑA","ROL","LISTA","ESTATUS","ACCIONES"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:1}}>{h}</th>)}</tr></thead>
                <tbody>{users.map((u,i)=><tr key={u.id} style={{borderTop:"1px solid "+BD,background:isAdminRole(u)?"#eff6ff":i%2?"#FAFAFA":"#fff"}}>
                  <td style={{padding:"9px 14px",fontWeight:600}}>{u.nombre}{isAdminRole(u)&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>ADMIN</span>}</td>
                  <td style={{padding:"9px 14px",color:GRL,fontSize:11}}>{u.empresa||"—"}</td>
                  <td style={{padding:"9px 14px",fontFamily:"monospace",color:GRL,fontSize:11}}>{u.usuario}</td>
                  <td style={{padding:"9px 14px"}}><PassCell/></td>
                  <td style={{padding:"9px 14px"}}><Badge val={u.rol}/></td>
                  <td style={{padding:"9px 14px"}}>{isAdminRole(u)?<span style={{color:GRL,fontSize:11}}>—</span>:<Badge val={u.lista}/>}</td>
                  <td style={{padding:"9px 14px"}}><Badge val={u.estatus}/></td>
                  <td style={{padding:"9px 14px"}}><div style={{display:"flex",gap:6}}>
                    {!isAdminRole(u)&&<Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>}
                    {!isAdminRole(u)&&<Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>}
                    {u.id!==session?.id&&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </div>}

        {tab==="quotes"&&<HistorialCotizaciones session={session}/>}
        {tab==="arribos"&&<ProximosArribos session={session} mob={mob}/>}

        {tab==="settings"&&<div style={{maxWidth:560}}>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:10,padding:24,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:OR,marginBottom:16}}>CAMBIAR MI CONTRASEÑA</div>
            <ChangePassword/>
          </div>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:10,padding:24,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:OR,marginBottom:16}}>CREAR ADMINISTRADOR</div>
            <CreateAdmin session={session} mob={mob}/>
          </div>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:10,padding:24}}>
            <div style={{fontWeight:800,fontSize:13,color:OR,marginBottom:12}}>ESTADO DEL SISTEMA</div>
            <div style={{color:GRL,fontSize:12,lineHeight:2}}>
              <div>Proyecto Firebase: <strong style={{color:"#1a1a1a"}}>{firebaseConfig.projectId}</strong></div>
              <div>Sesión: <strong style={{color:"#1a1a1a"}}>{session?.nombre}</strong></div>
              <div>Productos en catálogo: <strong style={{color:"#1a1a1a"}}>{products.length}</strong></div>
              <div>Marcas: <strong style={{color:"#1a1a1a"}}>{marcas.length}</strong></div>
              <div>Clientes: <strong style={{color:"#1a1a1a"}}>{users.filter(u=>u.estatus==="activo").length} activos · {users.filter(u=>u.estatus==="inactivo").length} inactivos</strong></div>
            </div>
            <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={loadProducts} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 16px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ Recargar catálogo</button>
              <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 16px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ Recargar clientes</button>
            </div>
          </div>
        </div>}
      </div>
    </div>
  );

  // ── CLIENTE / VENDEDOR ──────────────────────────────────────
  const lista=safe(session?.lista).toUpperCase();
  const vend=isVendedor(session);
  return(
    <div style={{minHeight:"100vh",background:BG,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
      {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} onClose={()=>setCartOpen(false)}/>}
      {CartFab}{Hdr}

      <div style={{background:"linear-gradient(90deg,#FF5C1E,#E04A10)",padding:"9px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <span style={{color:"#fff",fontSize:mob?11:13,fontWeight:700}}>CONTADO ANTICIPADO: <span style={{color:"#FFE0C0"}}>3% DE DESCUENTO ADICIONAL</span></span>
      </div>

      <TabBar items={[["products","CATÁLOGO"],["quotes",vend?"COTIZACIONES":"MIS COTIZACIONES"],...(vend?[["arribos","PRÓXIMOS ARRIBOS"]]:[])]}/>

      <div style={{padding:mob?12:20,maxWidth:1400,margin:"0 auto"}}>
        {tab==="products"&&<>
          <div style={{background:"#FFF5F2",borderLeft:"3px solid "+OR,border:"1px solid #ffd9c9",borderRadius:6,padding:"9px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:OR,fontWeight:800}}>i</span>
            <span style={{color:GRL,fontSize:11}}>
              {PRECIOS_CON_IVA
                ? <>Todos los productos causan IVA. Los precios que ves <strong style={{color:"#1a1a1a"}}>ya lo incluyen</strong>, y tu cotización desglosa subtotal e IVA.</>
                : <>Los precios mostrados son <strong style={{color:"#1a1a1a"}}>antes de IVA</strong>.</>}
            </span>
          </div>
          {vend&&<div style={{background:"#f3e8ff",border:"1px solid #d8b4fe",borderRadius:6,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:"#9333ea",fontWeight:700}}>★</span>
            <span style={{color:"#9333ea",fontSize:11,fontWeight:700}}>Modo vendedor — ves las tres listas de precios</span>
          </div>}

          <Buscador search={search} ds={ds} onChange={setSearch} marca={marca} setMarca={setMarca} marcas={marcas} count={filtered.length} mob={mob} top={hdrH}/>

          {prodLoad&&<div style={{textAlign:"center",padding:40,color:GRL}}>Cargando catálogo...</div>}
          {!prodLoad&&filtered.length===0&&<div style={{textAlign:"center",padding:"60px 20px",color:"#ccc"}}>
            <div style={{fontSize:40,marginBottom:10}}>🔍</div>
            <div style={{color:GRL,fontSize:14}}>No encontramos productos con esa búsqueda.</div>
            <div style={{color:GRL,fontSize:12,marginTop:6}}>Prueba solo con la medida, por ejemplo <strong>120/70-17</strong>.</div>
          </div>}

          {!prodLoad&&filtered.length>0&&(mob?(
            <div>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>
              <CardProducto key={p.id||i} p={p} vend={vend} lista={lista} onAdd={()=>addToCart(p)}/>
            )}</div>
          ):(
            <div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:10,background:"#fff",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:DK}}>
                  {["MARCA","MEDIDA","SKU","DESCRIPCIÓN"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}</th>)}
                  {vend
                    ? ["PÚBLICO","DIST.","ASOCIADO"].map(h=><th key={h} style={{padding:"10px 8px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}<div style={{fontSize:8,fontWeight:400,letterSpacing:0,color:"rgba(255,255,255,.55)"}}>IVA incl.</div></th>)
                    : <th style={{padding:"10px 10px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>PRECIO<div style={{fontSize:8,fontWeight:400,letterSpacing:0,color:"rgba(255,255,255,.55)"}}>IVA incl.</div></th>}
                  {ALMS_L.map(a=><th key={a} style={{padding:"10px 8px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8}}>{a}</th>)}
                  <th style={{padding:"10px 8px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8}}>TOTAL</th>
                  <th style={{width:36}}></th>
                </tr></thead>
                <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                  const tot=calcTotal(p),col=semaforo(tot);
                  return <tr key={p.id||i} style={{borderBottom:"1px solid "+BD,background:i%2?"#FAFAFA":"#fff"}}>
                    <td style={{padding:"8px 12px"}}><MarcaChip marca={p.marca}/></td>
                    <td style={{padding:"8px 12px",fontWeight:900,fontSize:15,color:DK,whiteSpace:"nowrap"}}>{p.medida||"—"}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:10,color:"#999"}}>{p.codigo}</td>
                    <td style={{padding:"8px 12px",maxWidth:260,fontSize:12,color:"#444",lineHeight:1.3,fontWeight:500}}>{p.descripcion}</td>
                    {vend?<>
                      <td style={{padding:"8px",textAlign:"right",color:OR,fontWeight:800}}>{money(p.publico)}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.distribuidor)}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.asociado)}</td>
                    </>:<td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,fontSize:14,color:OR,whiteSpace:"nowrap"}}>{money(getPrecio(p,lista))}</td>}
                    {ALMS.map(a=>{const v=safeNum(p[a]);return <td key={a} style={{padding:"8px",textAlign:"right",color:v>0?"#555":"#ddd"}}>{v>0?stockVis(v):"--"}</td>;})}
                    <td style={{padding:"8px",textAlign:"right",fontWeight:800,fontSize:14,color:col}}>{stockVis(tot)}</td>
                    <td style={{padding:"6px 8px"}}>
                      <button onClick={()=>addToCart(p)} title="Agregar a cotización"
                        style={{background:OR,color:"#fff",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>＋</button>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ))}
          {filtered.length>0&&<Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>}
        </>}

        {tab==="quotes"&&<HistorialCotizaciones session={session}/>}
        {tab==="arribos"&&vend&&<ProximosArribos session={session} mob={mob}/>}
      </div>
    </div>
  );
}
