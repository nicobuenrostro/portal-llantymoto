import { useState, useEffect, useMemo, useRef, Component } from "react";
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
  packing:      "packing_lists", // historial del optimizador (solo internos)
  destinos:     "destinos",      // catálogo compartido de destinos (folio D-0001)
  bitacora:     "bitacora",
};

// 3) Datos de la empresa que salen impresos en el PDF de cotización.
//    ⚠️ Llena los datos bancarios con los reales de LlantyMoto.
const EMPRESA = {
  nombre:   "LlantyMoto",
  eslogan:  "Llantas para moto, ATV y UTV",
  giro:     "Importadores de llantas para motocicleta, ATV y UTV",
  ciudad:   "Tlajomulco, Jalisco, México",
  // Texto que se imprime en la cotización y link real de Google Maps
  // del parque industrial. El texto y el link son independientes: puedes
  // afinar el texto sin tocar el link.
  direccion:"Parque Industrial Elite Circuito Metropolitano I — Bodega B-02",
  mapsUrl:  "https://maps.app.goo.gl/X835vpTYwAqcsB8d7",
  // Contactos de la cotización. `num` va en el link (formato wa.me /
  // tel:), `vis` es lo que se imprime.
  whats: [
    { num:"5213321840837", vis:"33 2184 0837", label:"Atención a clientes" },
    { num:"5213321836944", vis:"33 2183 6944", label:"Atención a clientes" },
  ],
  oficina: { num:"+523332847074", vis:"33 3284 7074" },
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

// 3-bis) Tapatía Credit. Aparece SOLO del lado del cliente: dentro de
// la lista del catálogo, en el panel de cotización y en el PDF. Nunca
// en el panel de administrador. Para apagarlo, pon activo:false — no
// hay que tocar ninguna otra línea.
const CREDITO = {
  activo: true,
  nombre: "TAPATÍA CREDIT",
  frase:  "Compra hasta con 90 días de crédito.",
  pie:    "Pregunta a tu asesor cómo abrir tu línea.",
};
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
const MARCAS_OCULTAS = ["EUROGRIP","VIPAL","RAGE","URIDE","OTRA","RINOMAX"];
// Orden fijo de los chips de marca. Lo que no esté aquí va después,
// y el chip OTRAS siempre cierra la fila.
const ORDEN_MARCAS = ["TERRA PLUS","OBOR","CUATRIMASTER","MITAS","TERRA MOUSSE","ANLAS","CEAT","PLUSWAY"];
const ordenMarca = m => { const i=ORDEN_MARCAS.findIndex(o=>marcaKey(o)===marcaKey(m)); return i===-1?999:i; };
const OTRAS = "__OTRAS__";
const esOculta = m => MARCAS_OCULTAS.includes(marcaKey(m));

// 4) Almacenes. La clave es el campo en Firestore; la etiqueta es lo que se ve.
// tlajo = bodega SAP 500 · meli = bodega SAP 6 (Chapala 06) ·
// chap3 = bodega SAP 3 (Chapala 03). El campo en Firestore no cambia
// aunque cambie la etiqueta, para no migrar datos históricos.
const ALMS   = ["tlajo","meli","chap3"];
const ALMS_L = ["TLAJO","CHAP 06","CHAP 03"];

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
// Sello de compilación. Aparece en el login y en el pie del panel.
// Sirve para saber, sin adivinar, qué versión está publicada.
const VERSION = "v4.0.2 · sap 4 decimales · 05ago2026";

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
// `real` SOLO puede ser true para vendedores y administradores. Aun
// así es cinturón y tirantes: los catálogos que lee un cliente
// (cat_asociado, cat_distribuidor, cat_publico) se guardan YA topados
// en 30 al subir el CSV, así que aunque un cliente lograra encender
// este parámetro, el número real no existe en los datos que recibe.
// Cámaras por costal y similares: llegan con las tres listas en 0 a
// propósito. El portal no muestra $0: muestra "POR VOLUMEN" y no deja
// meterlas a cotización (las condiciones se negocian con el asesor).
const esVolumen = p => safeNum(p?.publico)===0 && safeNum(p?.distribuidor)===0 && safeNum(p?.asociado)===0;
const VolBadge = ({grande}) => <span title="Precio especial por volumen: consulta condiciones con tu asesor"
  style={{display:"inline-block",padding:grande?"4px 10px":"3px 8px",borderRadius:10,
  background:"#FFF7ED",border:"1px solid #FDBA74",color:"#9A3412",
  fontSize:grande?11:9.5,fontWeight:800,letterSpacing:.5,whiteSpace:"nowrap"}}>POR VOLUMEN</span>;
const stockVis = (t,real=false) => (!real && t>=TOPE_STOCK) ? "+30" : String(t);
// Píldora de existencia por almacén. Antes TLAJO y CHAPALA salían en
// el mismo gris plano y no se distinguía nada de un vistazo; ahora
// cada celda dice sola si hay, hay poco o no hay.
function StockPill({v,peso=600,real=false}){
  const n=safeNum(v);
  if(n<=0) return <span style={{color:"#D5D5D5",fontSize:12}}>—</span>;
  const col=semaforo(n);
  return <span style={{display:"inline-block",minWidth:38,textAlign:"center",
    padding:"3px 8px",borderRadius:12,fontSize:12,fontWeight:peso,
    color:col,background:col+"14",border:"1px solid "+col+"33"}}>{stockVis(n,real)}</span>;
}
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
      let paquete=[];
      try{ paquete = typeof crudo==="string" ? JSON.parse(crudo) : (crudo||[]); }
      catch(e){ console.error("paquete ilegible:",d.id,e); paquete=[]; }
      if(!Array.isArray(paquete)) paquete=[];
      paquete.forEach((it,i)=>{
        if(!Array.isArray(it)) return;
        // Formato nuevo: 9 posiciones (con CHAP 03). Formato viejo: 8.
        // El total siempre es la última posición, así ambos conviven.
        const [marca,medida,codigo,descripcion,precio,tlajo,meli]=it;
        const chap3=it.length>=9?it[7]:0;
        const total=it[it.length-1];
        // Las tres listas apuntan al mismo número: el cliente solo tiene la suya.
        out.push({id:`${d.id}_${i}`,marca,medida,codigo,descripcion,
          asociado:safeNum(precio),distribuidor:safeNum(precio),publico:safeNum(precio),
          tlajo:safeNum(tlajo),meli:safeNum(meli),chap3:safeNum(chap3),total:safeNum(total)});
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
// Permiso suelto: deja subir el CSV diario SIN dar acceso de
// administrador. El vendedor con este permiso no ve clientes, ni
// usuarios, ni configuración: solo la pantalla de subir catálogo.
const puedeCatalogo = s => isAdminRole(s)||s?.puede_catalogo===true;
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
// Proporción del ancho del PNG que ocupa el isotipo LM (el círculo).
// Con esto el eslogan arranca justo bajo la L de LLANTYMOTO y no bajo
// el círculo, y se estira exactamente al ancho de las letras.
// Medido sobre el logo.png real (1418x357): el círculo termina en el
// pixel 389 y las letras arrancan en el 416 → 416/1418 = 0.293.
// Si algún día cambias el archivo del logo, este es el único número
// que hay que mover: súbelo si el eslogan queda muy a la izquierda,
// bájalo si queda muy adentro.
const ISOTIPO = 0.293;
// Medido sobre el mismo logo.png: la tinta de las letras LLANTYMOTO
// termina al 58.8% del alto del lienzo (el círculo LM baja más, hasta
// el 100%). Sirve para colgar el eslogan del PDF justo bajo las letras.
const LETRAS_FONDO = 0.588;

function Logo({h=34,eslogan=true,max=250}){
  // El ancho pintado del logotipo no se sabe hasta que carga la imagen:
  // se mide al vuelo y de ahí sale dónde empieza y cuánto mide el
  // eslogan. La escala es uniforme (scale, no scaleX) para no deformar
  // la letra. offsetWidth no se ve afectado por el transform, así que
  // la medición no se retroalimenta.
  const [w,setW]=useState(0);
  const [tw,setTw]=useState(0);
  const txtRef=useRef(null);
  useEffect(()=>{ if(txtRef.current) setTw(txtRef.current.offsetWidth); },[eslogan,h,w]);
  const anchoLetras = w>0 ? w*(1-ISOTIPO) : 0;
  const escala = (tw>0&&anchoLetras>0) ? Math.min(1.9,Math.max(.55,anchoLetras/tw)) : 1;
  const alto   = Math.round(11*escala*1.15);
  const medir  = e=>setW(e.currentTarget.getBoundingClientRect().width);
  return <div style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-start",minWidth:0}}>
    <img src={LOGO_URL} alt={EMPRESA.nombre} onLoad={medir}
      style={{height:h,objectFit:"contain",maxWidth:max,display:"block"}}
      onError={e=>{e.target.style.display="none";}}/>
    {eslogan && (w>0
      ? <div style={{width:w,height:alto,position:"relative"}}>
          <div ref={txtRef} style={{position:"absolute",left:w*ISOTIPO,top:1,whiteSpace:"nowrap",
            color:GRL,fontSize:11,fontStyle:"italic",lineHeight:1.1,
            transform:`scale(${escala})`,transformOrigin:"left top"}}>{ESLOGAN}</div>
        </div>
      // Si la imagen no cargó no hay contra qué alinear: se pinta plano.
      : <div style={{color:GRL,fontSize:10,fontStyle:"italic",whiteSpace:"nowrap"}}>{ESLOGAN}</div>)}
  </div>;
}

// ── Aviso de Tapatía Credit ───────────────────────────────────
// Discreto a propósito: una línea, sin fondo de color ni ícono grande.
// Debe leerse como un dato más del portal, no como publicidad que le
// compite a las llantas.
function LineaCredito({compacta,esCliente=true}){
  // Es una herramienta de financiamiento PARA el cliente: al vendedor
  // solo le quita espacio de trabajo, así que jamás se le muestra.
  if(!CREDITO.activo||!esCliente) return null;
  return <div style={{display:"flex",alignItems:"center",gap:10,background:"#fff",
    border:"1px solid "+BD,borderLeft:"3px solid "+OR,borderRadius:8,
    padding:compacta?"8px 11px":"10px 13px",marginBottom:10}}>
    <span style={{color:OR,fontSize:9,fontWeight:800,letterSpacing:.8,whiteSpace:"nowrap"}}>{CREDITO.nombre}</span>
    <span style={{width:1,alignSelf:"stretch",background:BD}}/>
    <span style={{color:"#444",fontSize:compacta?11:12,fontWeight:600,lineHeight:1.3}}>
      {CREDITO.frase}
      {!compacta&&<span style={{display:"block",color:GRL,fontSize:10,fontWeight:400,marginTop:2}}>{CREDITO.pie}</span>}
    </span>
  </div>;
}
function MarcaFiltro({m,activa,onClick,mob}){
  const [ok,setOk]=useState(true);
  // MARCA_COLOR guarda OBJETOS {bg,c}, no listas. Desarmarlo como lista
  // ("const [bg,fg]=...") tumbaba el portal en cuanto había una marca
  // que dibujar: "object is not iterable".
  const { bg, c: fg } = marcaStyle(m);
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
  // Degradado en el borde derecho: avisa que la fila de marcas sigue.
  // Un chip cortado en seco se lee como error, no como "hay más".
  const fade=mob?{maskImage:"linear-gradient(to right,#000 88%,transparent)",
                  WebkitMaskImage:"linear-gradient(to right,#000 88%,transparent)"}:{};
  // Se queda pegado bajo el header: con 800+ SKUs el vendedor hace mucho
  // scroll y perder la barra a media lista es pura fricción.
  return <div style={{position:"sticky",top,zIndex:8,background:BG,paddingTop:10,marginTop:-10,paddingBottom:10}}>
  <div style={{background:"#222",padding:mob?"10px":"12px 14px",borderBottom:"3px solid "+OR,display:"flex",flexDirection:mob?"column":"row",gap:8,alignItems:mob?"stretch":"center",borderRadius:8,marginBottom:10}}>
    <div style={{position:"relative",flex:1,display:"flex",alignItems:"center"}}>
      {/* 16px NO es capricho: con menos, Safari hace zoom al enfocar y
          deja la página descuadrada. El teclado va sin autocorrector
          porque corregía los SKU. */}
      <input value={search} onChange={e=>onChange(e.target.value)}
        inputMode="search" enterKeyHint="search"
        autoCorrect="off" autoCapitalize="off" spellCheck={false}
        placeholder={mob?"Buscar medida, marca o SKU...":"Buscar por medida, marca, SKU o descripción (ej: 120/70-17, mitas 90/90-21, 25x10-12)"}
        style={{width:"100%",padding:search?"11px 42px 11px 14px":"11px 14px",border:"2px solid transparent",borderRadius:8,background:"#fff",fontSize:mob?16:14,color:"#222",outline:"none",boxSizing:"border-box",WebkitAppearance:"none"}}/>
      {search&&<button onClick={()=>onChange("")} aria-label="Limpiar búsqueda"
        style={{position:"absolute",right:6,width:32,height:32,border:"none",background:"#EEE",color:"#555",borderRadius:"50%",fontSize:13,fontWeight:800,cursor:"pointer",lineHeight:1,padding:0}}>✕</button>}
    </div>
    <span style={{color:OR,fontSize:12,fontWeight:700,background:"rgba(255,92,30,.1)",border:"1px solid rgba(255,92,30,.3)",padding:"7px 14px",borderRadius:20,whiteSpace:"nowrap",textAlign:"center"}}>
      {count} producto{count!==1?"s":""}{tipo?` · ${tipo}`:""}
    </span>
  </div>
  <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:6,scrollbarWidth:"none",...fade}}>
    {["",...marcas.filter(m=>!esOculta(m))].map(m=>
      <MarcaFiltro key={m||"todas"} m={m} mob={mob} activa={marca===m} onClick={()=>setMarca(m)}/>)}
    {marcas.some(esOculta) &&
      <MarcaFiltro m={OTRAS} mob={mob} activa={marca===OTRAS} onClick={()=>setMarca(OTRAS)}/>}
  </div></div>;
}
function Pager({total,pg,setPg,ps=50,mob}){
  const pages=Math.max(1,Math.ceil(total/ps));
  // En el teléfono la lista se acumula: ANT/SIG con scrollTo(0,0) te
  // aventaba hasta el header y perdías de vista lo que buscabas.
  if(mob) return pg+1>=pages?null:(
    <button onClick={()=>setPg(p=>p+1)}
      style={{width:"100%",padding:14,marginTop:4,background:"#fff",color:OR,border:"2px solid "+OR,borderRadius:8,fontWeight:800,fontSize:13,letterSpacing:1,cursor:"pointer"}}>
      CARGAR {Math.min(ps,total-(pg+1)*ps)} MÁS
    </button>
  );
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
// Tokens del documento. Solo del PDF: el portal tiene los suyos.
const PDF = {
  ink:    [26,26,26],     // negro corporativo
  naranja:[255,92,30],    // naranja LlantyMoto
  texto:  [55,55,55],
  sutil:  [130,130,130],
  borde:  [223,223,223],
  fondo:  [247,247,247],
  rojo:   [190,40,40],
  M:14, W:210, H:297,
  limite:     270,  // el contenido NUNCA baja de aquí; el pie vive abajo
  headerAlto:  36,  // página 1
  headerCont:  15,  // páginas 2+
};

// Glifo oficial de WhatsApp (verde #25D366, fondo transparente),
// incrustado para no depender de la red al generar el PDF.
const WA_ICON = "data:image/png;base64,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";

// Auricular de "llamar" (extraído de la referencia: bocina oscura con
// ondas azules), fondo transparente, incrustado.
const TEL_ICON = "data:image/png;base64,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";

// El logo se baja una vez y se mide para conocer su proporción real.
// Si falla la red, se devuelve null y el PDF usa el nombre en texto.
async function cargarLogoPDF(){
  try{
    const resp=await fetch(LOGO_URL); const blob=await resp.blob();
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
    const img=new Image();
    await new Promise(r=>{img.onload=r;img.onerror=r;img.src=b64;});
    return {b64, ratio:(img.naturalWidth||397)/(img.naturalHeight||100)};
  }catch(e){ return null; }
}

async function generarPDF({folio,session,items,nota,vigencia,descuento,paqueteria,clienteNombre}){
  const sfolio   = safe(folio)||"S/F";
  const snota    = safe(nota);
  const svig     = safe(vigencia)||"7 días naturales";
  const scliente = safe(clienteNombre)||"Público en general";
  const sdesc    = clampDesc(descuento);
  const snombre  = safe(session?.nombre)||"—";
  const sitems   = Array.isArray(items)?items:[];
  const fecha    = new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"});

  const logo = await cargarLogoPDF();
  const d=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const {M,W}=PDF, AW=W-M*2;

  const F=(c)=>d.setFillColor(c[0],c[1],c[2]);
  const T=(c)=>d.setTextColor(c[0],c[1],c[2]);
  const D=(c)=>d.setDrawColor(c[0],c[1],c[2]);

  // ── Cromo de página ────────────────────────────────────────
  const pintarLogo=(x,y,h)=>{
    if(!logo){
      T([255,255,255]);d.setFontSize(h*3.2);d.setFont("helvetica","bold");
      d.text(EMPRESA.nombre.toUpperCase(),x,y+h*0.8); return {w:h*4};
    }
    const w=h*logo.ratio; d.addImage(logo.b64,"PNG",x,y,w,h); return {w};
  };

  const headerPrimera=()=>{
    F(PDF.ink);   d.rect(0,0,W,PDF.headerAlto,"F");
    F(PDF.naranja);d.rect(0,PDF.headerAlto,W,1.4,"F");
    const {w:logoW}=pintarLogo(M,6.5,15);
    // El eslogan va CENTRADO bajo las letras LLANTYMOTO (no bajo el
    // círculo LM), un 3% más chico que el ancho de las letras y pegadito
    // al logotipo. Misma constante ISOTIPO que usa el portal.
    const eslX = M + logoW*ISOTIPO, eslW = logoW*(1-ISOTIPO);
    d.setFont("helvetica","bolditalic");d.setFontSize(8);
    const fs=Math.min(9,Math.max(6,8*eslW/Math.max(1,d.getTextWidth(ESLOGAN))))*0.95;
    d.setFontSize(fs);T(PDF.naranja);
    // baseline = fondo real de las letras + un respiro de 3.2mm. No usa
    // el fondo del lienzo (21.5mm) porque ahí manda el círculo, no las
    // letras, y el eslogan quedaba flotando muy abajo.
    d.text(ESLOGAN,eslX+eslW/2,6.5+15*LETRAS_FONDO+3.8,{align:"center"});
    d.setFont("helvetica","normal");d.setFontSize(7);T([185,185,185]);
    d.text(EMPRESA.giro,M,30);
    // La ciudad es un link a Google Maps: quien lee el PDF en pantalla
    // puede abrir la ubicación de la bodega con un clic.
    d.textWithLink(EMPRESA.ciudad,M,33.4,{url:EMPRESA.mapsUrl});
    const cw1=d.getTextWidth(EMPRESA.ciudad);
    d.text(`   ·   ${EMPRESA.correo}   ·   ${EMPRESA.web}`,M+cw1,33.4);
    // Tarjeta naranja: COTIZACIÓN + folio + fecha
    const cw=56, cx=W-M-cw;
    F(PDF.naranja);d.roundedRect(cx,5.5,cw,25,2,2,"F");
    T([255,255,255]);d.setFont("helvetica","bold");d.setFontSize(11);
    d.text("COTIZACIÓN",cx+cw/2,12.5,{align:"center"});
    d.setFontSize(13);d.text(sfolio,cx+cw/2,20,{align:"center"});
    d.setFont("helvetica","normal");d.setFontSize(8);d.setTextColor(255,224,200);
    d.text(fecha,cx+cw/2,26,{align:"center"});
  };

  const headerCont=()=>{
    F(PDF.ink);d.rect(0,0,W,PDF.headerCont,"F");
    F(PDF.naranja);d.rect(0,PDF.headerCont,W,1,"F");
    pintarLogo(M,3.6,8);
    T([255,255,255]);d.setFont("helvetica","bold");d.setFontSize(9);
    d.text(`COTIZACIÓN ${sfolio}`,W-M,7.5,{align:"right"});
    d.setFont("helvetica","normal");d.setFontSize(7);T([190,190,190]);
    d.text(`${scliente}  ·  Continuación`,W-M,11.8,{align:"right"});
  };

  const footerStatic=()=>{
    D(PDF.naranja);d.setLineWidth(.6);d.line(M,281,W-M,281);
    T(PDF.sutil);d.setFont("helvetica","bold");d.setFontSize(7);
    d.text(`${EMPRESA.nombre}  ·  ${EMPRESA.web}`,M,285.5);
    d.setFont("helvetica","normal");
    d.text(`${sfolio}  ·  ${fecha}`,W/2,285.5,{align:"center"});
    // "Página X de Y" se agrega al final, cuando ya se conoce Y.
  };

  // ── Cursor + salto de página seguro ────────────────────────
  // need(h): si el bloque de altura h no cabe antes del límite, se
  // abre página nueva CON su cromo. Así ningún bloque se parte ni
  // pisa el pie, y jamás se generan páginas vacías (solo se abre
  // página cuando hay contenido esperando).
  headerPrimera(); footerStatic();
  let y=PDF.headerAlto+8;
  const need=h=>{
    if(y+h>PDF.limite){ d.addPage(); headerCont(); footerStatic(); y=PDF.headerCont+8; }
  };

  // ── Datos de cotización ────────────────────────────────────
  const cardH=23;
  F(PDF.fondo);d.roundedRect(M,y,AW,cardH,1.5,1.5,"F");
  D(PDF.borde);d.setLineWidth(.25);d.roundedRect(M,y,AW,cardH,1.5,1.5);
  T(PDF.naranja);d.setFont("helvetica","bold");d.setFontSize(8);
  d.text("DATOS DE COTIZACIÓN",M+3,y+5);
  const col2=M+AW/2;
  const tf=(lbl,val,x,yy,maxW)=>{
    d.setFont("helvetica","normal");T([120,120,120]);d.setFontSize(7.6);d.text(lbl,x,yy);
    d.setFont("helvetica","bold");T([25,25,25]);
    const v=safe(val)||"—";
    d.text(maxW?(d.splitTextToSize(v,maxW)[0]||v):v,x+d.getTextWidth(lbl)+2.5,yy);
  };
  tf("Folio:",sfolio,M+3,y+10.5); tf("Fecha:",fecha,col2,y+10.5);
  tf("Elaboró:",snombre,M+3,y+15.5,AW/2-24); tf("Vigencia:",svig,col2,y+15.5);
  tf("Cliente:",scliente,M+3,y+20.5,AW-30);
  y+=cardH+4;

  // ── Aviso de IVA ───────────────────────────────────────────
  F(PDF.naranja);d.rect(M,y,1,6,"F");
  F([255,246,241]);d.rect(M+1,y,AW-1,6,"F");
  T([150,70,30]);d.setFont("helvetica","normal");d.setFontSize(7.4);
  d.text("Todos los productos causan IVA. Los precios de esta cotización ya incluyen el IVA del 16%.",M+4,y+4);
  y+=10;

  // ── Tabla de productos ─────────────────────────────────────
  // Anchos definidos UNA vez, en % del área útil, sumando 100 exacto:
  // el encabezado negro y el cuerpo miden lo mismo y la columna
  // IMPORTE termina en el borde derecho.
  const PCT=[4,13,13,38,8,12,12];
  const colW=PCT.map(p=>AW*p/100);
  const rows=sitems.map((it,i)=>[
    i+1, safe(it.marca)||"—", safe(it.codigo)||safe(it.medida)||"—", safe(it.descripcion)||"—",
    safeNum(it.cantidad), money2(it.precio), money2(safeNum(it.precio)*safeNum(it.cantidad)),
  ]);

  d.autoTable({
    startY:y,
    head:[["#","MARCA","SKU","DESCRIPCIÓN","CANT.","P. UNITARIO","IMPORTE"]],
    body:rows,
    margin:{left:M,right:M,top:PDF.headerCont+6,bottom:PDF.H-PDF.limite},
    tableWidth:AW,
    styles:{font:"helvetica",fontSize:7.6,cellPadding:{top:2.1,bottom:2.1,left:1.8,right:1.8},
            lineColor:PDF.borde,lineWidth:.15,overflow:"linebreak",textColor:[45,45,45]},
    headStyles:{fillColor:PDF.ink,textColor:255,fontStyle:"bold",fontSize:7.2,lineWidth:0},
    alternateRowStyles:{fillColor:[250,250,250]},
    columnStyles:{
      0:{cellWidth:colW[0],halign:"center"},
      1:{cellWidth:colW[1],halign:"left"},
      2:{cellWidth:colW[2],halign:"left",fontStyle:"bold",fontSize:6.6},
      3:{cellWidth:colW[3],halign:"left"},
      4:{cellWidth:colW[4],halign:"center"},
      5:{cellWidth:colW[5],halign:"right"},
      6:{cellWidth:colW[6],halign:"right"},
    },
    rowPageBreak:"avoid",     // ninguna fila se parte entre páginas
    showHead:"everyPage",     // el encabezado de columnas se repite
    didDrawPage:data=>{
      if(data.pageNumber>1){ headerCont(); footerStatic(); }
    },
  });
  y=d.lastAutoTable.finalY+6;

  // ── Totales + Tapatía Credit, lado a lado ──────────────────
  const bruto  = sitems.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad),0);
  const descMonto = sdesc>0?bruto*(sdesc/100):0;
  // Paquetería: monto fijo con IVA, fuera del alcance del descuento.
  const paqMonto  = safeNum(paqueteria);
  const total  = bruto-descMonto+paqMonto;
  const base   = PRECIOS_CON_IVA ? total/(1+TASA_IVA) : total;
  const iva    = PRECIOS_CON_IVA ? total-base : total*TASA_IVA;
  const granTotal = PRECIOS_CON_IVA ? total : total+iva;

  const nRows=3+(sdesc>0?1:0)+(paqMonto>0?1:0);
  const totH=nRows*6+11+4;                 // filas + banda TOTAL + aire
  const credH=CREDITO.activo?19+4:0;
  const contH=23;                          // tarjeta de contacto
  need(Math.max(totH,credH+contH)+2);
  const bw=AW*0.40, bx=W-M-bw, cw2=AW-bw-8;

  // Tarjeta de crédito (solo si está activa). Es independiente del
  // resumen: quitarla no cambia el ancho ni la posición de los totales.
  if(CREDITO.activo){
    const ch=19;
    D(PDF.borde);d.setLineWidth(.25);d.roundedRect(M,y,cw2,ch,1.5,1.5);
    F(PDF.naranja);d.rect(M,y+1.5,1,ch-3,"F");
    T(PDF.naranja);d.setFont("helvetica","bold");d.setFontSize(7.6);
    d.text(CREDITO.nombre,M+4,y+5.5);
    T(PDF.texto);d.setFont("helvetica","bold");d.setFontSize(8.4);
    d.text("Hasta 90 días de crédito.",M+4,y+10.5);
    d.setFont("helvetica","normal");d.setFontSize(6.8);T(PDF.sutil);
    d.text("Consulta requisitos con tu asesor.  ·  Sujeto a autorización.",M+4,y+15);
  }

  // ── Pedidos y atención ─────────────────────────────────────
  // Va junto al total a propósito: el cliente ve el monto y lo
  // siguiente que busca es a quién hablarle. Los WhatsApp abren el
  // chat con el folio ya escrito, para saber de qué cotización viene
  // cada mensaje sin preguntar.
  {
    const cy=y+credH;
    D(PDF.borde);d.setLineWidth(.25);d.roundedRect(M,cy,cw2,contH,1.5,1.5);
    F(PDF.naranja);d.rect(M,cy+1.5,1,contH-3,"F");
    T(PDF.naranja);d.setFont("helvetica","bold");d.setFontSize(7.6);
    d.text("PEDIDOS Y ATENCIÓN",M+4,cy+5.3);
    const msg=encodeURIComponent(`Hola, vengo de la cotización ${sfolio}.`);
    let ry=cy+9.6;
    EMPRESA.whats.forEach(w=>{
      // icono oficial de WhatsApp, incrustado arriba
      d.addImage(WA_ICON,"PNG",M+4,ry-2.7,3.3,3.3);
      T([25,25,25]);d.setFont("helvetica","bold");d.setFontSize(8);
      d.text(w.vis,M+9,ry);
      const nw=d.getTextWidth(w.vis);
      T(PDF.sutil);d.setFont("helvetica","normal");d.setFontSize(6.8);
      d.text(`WhatsApp · ${w.label}`,M+11.5+nw,ry);
      d.link(M+3.5,ry-3.2,cw2-7,4.6,{url:`https://wa.me/${w.num}?text=${msg}`});
      ry+=5.4;
    });
    d.addImage(TEL_ICON,"PNG",M+4,ry-2.7,3.3,3.3);
    T([25,25,25]);d.setFont("helvetica","bold");d.setFontSize(8);
    d.text(EMPRESA.oficina.vis,M+9,ry);
    const ow=d.getTextWidth(EMPRESA.oficina.vis);
    T(PDF.sutil);d.setFont("helvetica","normal");d.setFontSize(6.8);
    d.text("Teléfono de oficina",M+11.5+ow,ry);
    d.link(M+3.5,ry-3.2,cw2-7,4.6,{url:`tel:${EMPRESA.oficina.num}`});
  }

  let ty=y;
  F([250,250,250]);d.rect(bx,ty,bw,nRows*6+2,"F");
  D(PDF.borde);d.setLineWidth(.25);d.rect(bx,ty,bw,nRows*6+2);
  const trow=(lbl,val,color,bold)=>{
    d.setFont("helvetica","normal");d.setFontSize(8);T(color||[110,110,110]);d.text(lbl,bx+3,ty+4.6);
    d.setFont("helvetica",bold?"bold":"normal");T(color||[30,30,30]);
    // Si etiqueta + monto no caben en el ancho de la tarjeta (montos de
    // muchos dígitos), el monto se encoge hasta caber en vez de salirse.
    let fs=8;d.setFontSize(fs);
    const lw=d.getTextWidth(lbl);
    while(fs>5.5 && lw+d.getTextWidth(val)+8 > bw){fs-=.5;d.setFontSize(fs);}
    d.text(val,bx+bw-3,ty+4.6,{align:"right"});
    ty+=6;
  };
  trow("Importe de lista (c/IVA)",money2(bruto));
  if(sdesc>0) trow(`Descuento (${sdesc}%)`,"-"+money2(descMonto),PDF.rojo,true);
  if(paqMonto>0) trow("Paquetería",money2(paqMonto));
  trow("Subtotal sin IVA",money2(base));
  trow("IVA (16%)",money2(iva));
  ty+=2;
  F(PDF.naranja);d.roundedRect(bx,ty,bw,10,1.5,1.5,"F");
  T([255,255,255]);d.setFont("helvetica","bold");d.setFontSize(9);
  d.text("TOTAL",bx+3,ty+6.6);
  d.setFontSize(11.5);
  d.text(money2(granTotal),bx+bw-3,ty+6.8,{align:"right"});
  y=Math.max(ty+10,y+credH+contH)+4;

  // ── Observaciones ──────────────────────────────────────────
  if(snota){
    const lineas=d.splitTextToSize(snota,AW-6);
    const oh=6+lineas.length*3.8;
    need(oh);
    T([60,60,60]);d.setFont("helvetica","bold");d.setFontSize(7.6);
    d.text("OBSERVACIONES",M,y+3);
    d.setFont("helvetica","normal");d.setFontSize(7.4);T(PDF.texto);
    d.text(lineas,M,y+7.5);
    y+=oh+3;
  }

  // ── Datos bancarios (nunca se omiten ni se parten) ─────────
  const bh=29; need(bh+4);
  F(PDF.fondo);d.roundedRect(M,y,AW,bh,1.5,1.5,"F");
  D(PDF.borde);d.setLineWidth(.25);d.roundedRect(M,y,AW,bh,1.5,1.5);
  T(PDF.naranja);d.setFont("helvetica","bold");d.setFontSize(8);
  d.text("DATOS PARA DEPÓSITO O TRANSFERENCIA",M+3,y+5.5);
  const bf=(l,v,x,yy,big)=>{
    d.setFont("helvetica","normal");d.setFontSize(7.4);T([120,120,120]);d.text(l,x,yy);
    d.setFont("helvetica","bold");d.setFontSize(big?9:7.8);T([25,25,25]);
    d.text(v,x+d.getTextWidth(l)+2.5,yy);
  };
  bf("Banco:",EMPRESA.banco,M+3,y+11.5);
  bf("Titular:",EMPRESA.titular,M+52,y+11.5);
  bf("No. de cuenta:",EMPRESA.cuenta,M+3,y+18.5,true);
  bf("CLABE:",EMPRESA.clabe,M+82,y+18.5,true);
  d.setFont("helvetica","italic");d.setFontSize(6.6);T(PDF.sutil);
  d.text(EMPRESA.notaBanco+"  Verifica que el beneficiario sea COMERCIAL LLANTERA TAPATÍA SA DE CV antes de pagar.",M+3,y+25);
  y+=bh+4;

  // ── Recoge en bodega ───────────────────────────────────────
  // Una sola línea discreta con link a Maps: informa dónde recoger sin
  // pelearle protagonismo a los totales ni a los datos de pago.
  need(9);
  F(PDF.naranja);d.rect(M,y,1,7,"F");
  F([255,246,241]);d.rect(M+1,y,AW-1,7,"F");
  T([150,70,30]);d.setFont("helvetica","bold");d.setFontSize(7.2);
  d.text("RECOGE EN BODEGA:",M+4,y+4.6);
  const rbw=d.getTextWidth("RECOGE EN BODEGA:");
  d.setFont("helvetica","normal");T(PDF.texto);
  d.text(EMPRESA.direccion,M+6+rbw,y+4.6);
  const dirw=d.getTextWidth(EMPRESA.direccion);
  // Botón naranja con un pin de mapa dibujado a mano (la fuente del
  // PDF no trae emojis). Toda el área del botón es clicable.
  const btnX=M+10+rbw+dirw, btnW=26, btnH=5.4, btnY=y+0.8;
  F(PDF.naranja);d.roundedRect(btnX,btnY,btnW,btnH,1.2,1.2,"F");
  const px2=btnX+4.2, py2=btnY+2.2;
  F([255,255,255]);d.circle(px2,py2,1.15,"F");
  d.triangle(px2-1.02,py2+0.55,px2+1.02,py2+0.55,px2,py2+2.5,"F");
  F(PDF.naranja);d.circle(px2,py2,0.5,"F");
  T([255,255,255]);d.setFont("helvetica","bold");d.setFontSize(7);
  d.text("VER MAPA",btnX+7.5,y+4.4);
  d.link(btnX,btnY,btnW,btnH,{url:EMPRESA.mapsUrl});
  y+=12;

  // ── Condiciones comerciales ────────────────────────────────
  need(10);
  T(PDF.sutil);d.setFont("helvetica","normal");d.setFontSize(6.8);
  d.text("Precios sujetos a cambio sin previo aviso  ·  Sujeto a disponibilidad de inventario.",M,y+2.5);
  d.text("Esta cotización es informativa y no constituye pedido, factura ni compromiso de entrega.",M,y+6.3);

  // ── Página X de Y (segunda pasada, ya con el total conocido) ─
  const pages=d.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    d.setPage(i);
    T(PDF.sutil);d.setFont("helvetica","normal");d.setFontSize(7);
    d.text(`Página ${i} de ${pages}`,W-M,285.5,{align:"right"});
  }

  d.save(`Cotizacion_${sfolio}.pdf`);
}

// ── Panel de cotización ───────────────────────────────────────
function CartPanel({cart,setCart,session,products,onClose}){
  const [importOpen,setImportOpen]=useState(false);
  const [importTxt,setImportTxt]=useState("");
  const [importMsg,setImportMsg]=useState("");
  // Pegar desde Excel: cada renglón "SKU  cantidad" (tab, coma o
  // espacios). Busca el SKU en el catálogo vivo y agrega la partida
  // con el precio ACTUAL de la lista del usuario, igual que el botón +.
  function importarPartidas(){
    const vend2=isVendedor(session);
    const lista=safe(session?.lista).toUpperCase();
    const porCodigo={};
    (products||[]).forEach(p=>{porCodigo[safe(p.codigo).toUpperCase()]=p;});
    let ok=0; const noEnc=[], volSalt=[];
    const nuevos=[];
    importTxt.split(/\r?\n/).forEach(lin=>{
      const t=lin.trim(); if(!t)return;
      const partes=t.split(/[\t,;]+|\s{2,}|\s+(?=\d+$)/).map(x=>x.trim()).filter(Boolean);
      if(!partes.length)return;
      const sku=safe(partes[0]).toUpperCase();
      const cant=Math.max(1,safeNum(partes[1])||1);
      const p=porCodigo[sku];
      if(!p){noEnc.push(sku);return;}
      if(esVolumen(p)){volSalt.push(sku);return;}
      const tipoPrecio=vend2?"publico":lista==="DISTRIBUIDOR"?"distribuidor":lista==="ASOCIADO"?"asociado":"publico";
      const precio=tipoPrecio==="publico"?safeNum(p.publico):tipoPrecio==="distribuidor"?safeNum(p.distribuidor):safeNum(p.asociado);
      nuevos.push({marca:safe(p.marca),medida:safe(p.medida),codigo:safe(p.codigo),
        descripcion:safe(p.descripcion),precio,tipoPrecio,cantidad:cant,
        _publico:safeNum(p.publico),_distribuidor:safeNum(p.distribuidor),_asociado:safeNum(p.asociado)});
      ok++;
    });
    if(nuevos.length){
      setCart(prev=>{
        const out=[...prev];
        nuevos.forEach(n=>{
          const i=out.findIndex(it=>it.codigo===n.codigo);
          if(i>=0)out[i]={...out[i],cantidad:out[i].cantidad+n.cantidad};
          else out.push(n);
        });
        return out;
      });
    }
    let m=`✅ ${ok} partida(s) agregadas.`;
    if(noEnc.length)m+=`\n❌ Sin coincidencia en el catálogo: ${noEnc.slice(0,8).join(", ")}${noEnc.length>8?"…":""}`;
    if(volSalt.length)m+=`\n⚠ Por volumen (agrégalas manualmente con su precio pactado): ${volSalt.join(", ")}`;
    setImportMsg(m);
    if(ok&&!noEnc.length&&!volSalt.length){setImportOpen(false);setImportTxt("");}
  }
  const vend=isVendedor(session);
  const [nota,setNota]=useState("");
  const [vigencia,setVigencia]=useState("7 días naturales");
  const [descuento,setDescuento]=useState("");
  const [paqueteria,setPaqueteria]=useState("");  // envío, monto fijo c/IVA
  const [clienteNombre,setClienteNombre]=useState("");
  const [generating,setGenerating]=useState(false);
  const [folioMsg,setFolioMsg]=useState("");

  const bruto=cart.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad),0);
  const descPct=clampDesc(descuento);
  // El descuento aplica SOLO a productos. La paquetería es un monto
  // fijo (con IVA) que se suma después, intocado por el descuento.
  const descMonto=vend&&descPct>0?bruto*(descPct/100):0;
  const paqMonto=vend?safeNum(paqueteria):0;
  const total=bruto-descMonto+paqMonto;
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
    // Antes de gastar folio: ninguna partida pactada puede ir en $0.
    const pactadaEnCero=cart.find(it=>it.tipoPrecio==="pactado"&&safeNum(it.precio)<=0);
    if(pactadaEnCero){setFolioMsg(`❌ "${safe(pactadaEnCero.descripcion).slice(0,40)}…" tiene precio pactado en $0. Captúralo antes de generar.`);return;}
    setGenerating(true);setFolioMsg("Generando folio...");
    try{
      const folio=await getNextFolio();
      setFolioMsg(`📄 ${folio} — generando PDF...`);
      const descReal=vend?descPct:0;
      const nombreCliente=safe(clienteNombre)||"Público en general";
      await generarPDF({folio,session,items:cart,nota,vigencia,descuento:descReal,paqueteria:paqMonto,clienteNombre:nombreCliente});
      await setDoc(doc(db,COL.cotizaciones,folio),{
        folio,uid:safe(session?.id),usuario:safe(session?.usuario),nombre:safe(session?.nombre),
        empresa:safe(session?.empresa),items:cart,
        bruto,descuento:descReal,paqueteria:paqMonto,base,iva,total:granTotal,
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
                {vend&&(it.tipoPrecio==="pactado"?(
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <span style={{fontSize:9.5,fontWeight:800,color:"#9A3412",background:"#FFF7ED",border:"1px solid #FDBA74",padding:"3px 7px",borderRadius:10}}>PACTADO</span>
                    <span style={{fontSize:11,color:GRL}}>$</span>
                    <input type="text" inputMode="decimal" value={it.precio}
                      onChange={e=>{
                        const v=safeNum(e.target.value.replace(/[^\d.]/g,""));
                        setCart(prev=>prev.map((x,j)=>j===i?{...x,precio:v,_publico:v,_distribuidor:v,_asociado:v}:x));
                      }}
                      title="Precio pactado con IVA incluido"
                      style={{width:74,padding:"5px 8px",border:"1px solid #FDBA74",borderRadius:6,fontSize:12,fontWeight:700,outline:"none"}}/>
                  </div>
                ):(
                  <select value={it.tipoPrecio} onChange={e=>updPrecio(i,e.target.value)}
                    style={{padding:"5px 8px",border:"1px solid "+BD,borderRadius:6,fontSize:11,color:"#374151",outline:"none",background:"#fff"}}>
                    <option value="publico">Público</option>
                    <option value="distribuidor">Distribuidor</option>
                    <option value="asociado">Asociado</option>
                  </select>
                ))}
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
            <button onClick={()=>{setImportOpen(v=>!v);setImportMsg("");}}
              style={{width:"100%",marginBottom:10,background:"#fff",color:"#1B7A43",border:"1.5px dashed #1B7A43",padding:"9px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:800,letterSpacing:.5}}>
              📥 IMPORTAR PARTIDAS DESDE EXCEL
            </button>
          )}
          {vend&&importOpen&&(
            <div style={{marginBottom:10,border:"1px solid "+BD,borderRadius:8,padding:10,background:"#FAFAFA"}}>
              <div style={{color:GRL,fontSize:10,marginBottom:6}}>
                Pega renglones desde Excel: <b>SKU</b> y <b>cantidad</b> (una partida por renglón). Toma el precio ACTUAL de tu lista.
              </div>
              <textarea value={importTxt} onChange={e=>setImportTxt(e.target.value)}
                placeholder={"1107017ANLASTOUSPO\t2\n25812CUMAT54\t4"}
                style={{width:"100%",minHeight:90,padding:"8px 10px",border:"1px solid "+BD,borderRadius:6,fontSize:12,fontFamily:"monospace",outline:"none",boxSizing:"border-box",resize:"vertical"}}/>
              {importMsg&&<pre style={{margin:"6px 0 0",fontSize:11,whiteSpace:"pre-wrap",color:"#374151"}}>{importMsg}</pre>}
              <button onClick={importarPartidas}
                style={{marginTop:8,background:"#1B7A43",color:"#fff",border:"none",padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:800}}>AGREGAR AL CARRITO</button>
            </div>
          )}
          {vend&&(
            <div style={{marginBottom:10}}>
              <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>DESCUENTO ADICIONAL % (0–30)</div>
              <input type="text" inputMode="numeric" placeholder="0" value={descuento}
                onChange={e=>setDescuento(e.target.value.replace(/\D/g,"").slice(0,2))}
                onBlur={()=>setDescuento(v=>{const n=clampDesc(v);return v===""?"":String(n);})}
                style={{width:"100%",padding:"9px 11px",border:"1px solid "+BD,borderRadius:6,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}/>
              {clampDesc(descuento)!==safeNum(descuento||0)&&<div style={{color:"#dc2626",fontSize:10,marginTop:3}}>El máximo permitido es 30%: se aplicará {clampDesc(descuento)}%.</div>}
            </div>
          )}
          {vend&&(
            <div style={{marginBottom:10}}>
              <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>PAQUETERÍA / ENVÍO $ (IVA incluido · sin descuento)</div>
              <input type="text" inputMode="decimal" placeholder="0" value={paqueteria}
                onChange={e=>setPaqueteria(e.target.value.replace(/[^\d.]/g,""))}
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
            {paqMonto>0&&<div style={{display:"flex",justifyContent:"space-between",color:GRL,marginBottom:3}}>
              <span>Paquetería:</span><span style={{color:"#1a1a1a",fontWeight:600}}>{money2(paqMonto)}</span>
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
          {/* Aquí es donde el cliente decide: es el momento útil para
              recordarle que puede diferir el pago. */}
          <LineaCredito compacta esCliente={!esInterno(session)}/>
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
// ── Optimizador de paquetes ───────────────────────────────────
// El HTML del optimizador vive en public/optimizador.html y NO se
// modifica: para actualizarlo basta reemplazar ese archivo y publicar.
// Como el iframe es del MISMO dominio, el portal puede leer lo que la
// herramienta pintó y guardarlo en el historial sin tocar su código.
function PanelOptimizador({session,mob}){
  const [sub,setSub]=useState("tool");
  const [msg,setMsg]=useState("");
  const [saving,setSaving]=useState(false);
  const [items,setItems]=useState(null);      // historial
  const [destinos,setDestinos]=useState(null); // catálogo compartido
  const [busca,setBusca]=useState("");
  const [expanded,setExpanded]=useState(null);
  const [editando,_setEditando]=useState(null); // {id,folio} al reabrir
  // refs espejo: el guardado automático corre desde un callback del
  // iframe y sin esto leería estado congelado (closure vieja).
  const editandoRef=useRef(null);
  const destinosRef=useRef(null);
  const guardandoRef=useRef(false);
  const setEditando=v=>{editandoRef.current=v;_setEditando(v);};
  const [dialogo,setDialogo]=useState(null);   // {modo:"nuevo"|"actualizar", destino:""}
  const frameRef=useRef(null);
  const admin=isAdminRole(session);

  const puente=()=>frameRef.current?.contentWindow?.__LLANTY||null;
  const normaliza=t=>safe(t).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();

  // ── folios ──────────────────────────────────────────────────
  async function siguienteFolioPacking(){
    const uid=safe(session?.id)||"unknown";
    const ref=doc(db,COL.folios,uid);
    const snap=await getDoc(ref);
    const next=(snap.exists()?safeNum(snap.data().ultimo_packing):0)+1;
    await setDoc(ref,{ultimo_packing:next,usuario:safe(session?.usuario)},{merge:true});
    const prefix=safe(session?.usuario).substring(0,3).toUpperCase()||"USR";
    return `PK-${prefix}-${String(next).padStart(4,"0")}`;
  }
  // Folio de DESTINO: consecutivo GLOBAL (D-0001), compartido por todo
  // el equipo, para que un destino repetido conserve siempre su número.
  async function folioDestinoGlobal(){
    const ref=doc(db,COL.folios,"__destinos");
    const snap=await getDoc(ref);
    const next=(snap.exists()?safeNum(snap.data().ultimo):0)+1;
    await setDoc(ref,{ultimo:next},{merge:true});
    return `D-${String(next).padStart(4,"0")}`;
  }

  // ── destinos compartidos ────────────────────────────────────
  async function cargarDestinos(){
    try{
      const qs=await getDocs(collection(db,COL.destinos));
      const lista=qs.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>safe(a.nombre).localeCompare(safe(b.nombre),"es"));
      destinosRef.current=lista; setDestinos(lista);
    }catch(e){ destinosRef.current=[]; setDestinos([]); }
  }
  useEffect(()=>{ cargarDestinos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Registra el destino si es nuevo; devuelve {folio,nombre}.
  async function resolverDestino(nombre,estado){
    const nom=safe(nombre).trim();
    if(!nom) return null;
    const norm=normaliza(nom);
    const ya=(destinosRef.current||destinos||[]).find(d=>normaliza(d.nombre)===norm);
    if(ya) return {folio:safe(ya.folio),nombre:safe(ya.nombre)};
    const folio=await folioDestinoGlobal();
    const id=`${Date.now()}_${norm.replace(/[^a-z0-9]/g,"").slice(0,20)}`;
    const nuevoDest={folio,nombre:nom,nombre_norm:norm,
      km:safeNum(estado?.km)||0,
      dir:safe(estado?.envio?.dir),ciudad:safe(estado?.envio?.ciudad),tel:safe(estado?.envio?.tel),
      uid:safe(session?.id),creado:new Date().toISOString()};
    await setDoc(doc(db,COL.destinos,id),nuevoDest);
    const nueva=[...(destinosRef.current||[]),{id,...nuevoDest}].sort((a,b)=>safe(a.nombre).localeCompare(safe(b.nombre),"es"));
    destinosRef.current=nueva; setDestinos(nueva);
    return {folio,nombre:nom};
  }

  function inyectarDestino(id){
    const d=(destinos||[]).find(x=>x.id===id);
    if(!d) return;
    const br=puente();
    if(br?.setDestino){ br.setDestino(d); setMsg(`✅ Destino ${d.folio} · ${d.nombre} cargado en la herramienta (${d.km||"?"} km).`); }
    else setMsg("❌ La herramienta aún no carga o le falta el bloque puente.");
  }

  // ── capturar / guardar ──────────────────────────────────────
  function capturar(){
    const docu=frameRef.current?.contentDocument;
    if(!docu) return null;
    const contenido=safe((docu.getElementById("root")||docu.body)?.innerText).trim();
    const br=puente();
    const estado=br?.getEstado?br.getEstado():null;
    return {contenido,estado};
  }

  // ── Guardado AUTOMÁTICO ─────────────────────────────────────
  // Se dispara solo, cada vez que el usuario genera el packing list
  // en la herramienta (llega a la vista PACKING con paquetes).
  // Primera generación de la sesión → folio nuevo; las siguientes
  // regeneraciones actualizan ESE MISMO folio (no se duplica).
  // El destino se toma de los datos de envío: si ya existe en el
  // catálogo compartido se reutiliza su folio D-, si no, se registra.
  async function autoGuardar(){
    if(guardandoRef.current) return;
    guardandoRef.current=true;
    try{
      const cap=capturar();
      if(!cap||!cap.estado?.calculado){guardandoRef.current=false;return;}
      const nombreDest=safe(cap.estado?.envio?.dest)||safe(cap.estado?.destNombre);
      const dest=nombreDest?await resolverDestino(nombreDest,cap.estado):null;
      const lineas=cap.contenido.split("\n").map(l=>l.trim()).filter(Boolean);
      const base={
        uid:safe(session?.id),usuario:safe(session?.usuario),
        vendedor:safe(session?.nombre)||safe(session?.usuario),
        destino:dest||null,
        resumen:[dest?`📍 ${dest.folio} ${dest.nombre}`:null,...lineas.slice(0,2)].filter(Boolean).join("  ·  ").slice(0,180),
        contenido:cap.contenido.slice(0,90000),
        estado:cap.estado||null,
      };
      const ed=editandoRef.current;
      if(ed){
        await setDoc(doc(db,COL.packing,ed.id),{...base,
          folio:ed.folio,fecha_mod:new Date().toISOString(),
          modificado_por:safe(session?.nombre)||safe(session?.usuario)},{merge:true});
        setMsg(`✅ ${ed.folio} actualizado automáticamente${dest?` · destino ${dest.folio}`:""}.`);
      }else{
        const folio=await siguienteFolioPacking();
        const id=`${Date.now()}_${safe(session?.id)||"x"}`;
        await setDoc(doc(db,COL.packing,id),{...base,folio,fecha:new Date().toISOString()});
        setEditando({id,folio}); // regeneraciones siguientes → mismo folio
        setMsg(`✅ Packing guardado automáticamente como ${folio}${dest?` · destino ${dest.folio}`:""}.`);
      }
      setItems(null);
    }catch(e){ setMsg("❌ El guardado automático falló: "+(e?.message||e)); }
    finally{ guardandoRef.current=false; }
  }

  // Enganchar el aviso del puente cuando el iframe termina de cargar
  function engancharPuente(){
    let intentos=0;
    const timer=setInterval(()=>{
      const br=puente();
      if(br){ br.onPacking=autoGuardar; clearInterval(timer); }
      else if(++intentos>50) clearInterval(timer);
    },200);
  }

  function abrirDialogo(modo){
    const cap=capturar();
    if(!cap){setMsg("❌ No pude leer la herramienta. Recarga la página.");return;}
    if(!cap.estado?.calculado&&(cap.contenido.length<60||!/paquete|pkt|bulto|caja|total/i.test(cap.contenido))){
      setMsg("❌ Primero genera un cálculo en la herramienta.");return;
    }
    const sugerido=safe(cap.estado?.envio?.dest)||safe(cap.estado?.destNombre);
    setDialogo({modo,destino:sugerido,cap});
  }

  async function confirmarGuardar(){
    const {modo,destino,cap}=dialogo;
    try{
      setSaving(true);setMsg("");
      const dest=await resolverDestino(destino,cap.estado);
      const lineas=cap.contenido.split("\n").map(l=>l.trim()).filter(Boolean);
      const base={
        uid:safe(session?.id),usuario:safe(session?.usuario),
        vendedor:safe(session?.nombre)||safe(session?.usuario),
        destino:dest||null,
        resumen:[dest?`📍 ${dest.folio} ${dest.nombre}`:null,...lineas.slice(0,2)].filter(Boolean).join("  ·  ").slice(0,180),
        contenido:cap.contenido.slice(0,90000),
        estado:cap.estado||null,
      };
      if(modo==="actualizar"&&editando){
        await setDoc(doc(db,COL.packing,editando.id),{...base,
          folio:editando.folio,fecha_mod:new Date().toISOString(),
          modificado_por:safe(session?.nombre)||safe(session?.usuario)},{merge:true});
        setMsg(`✅ ${editando.folio} actualizado con el nuevo cálculo.`);
        setEditando(null);
      }else{
        const folio=await siguienteFolioPacking();
        const id=`${Date.now()}_${safe(session?.id)||"x"}`;
        await setDoc(doc(db,COL.packing,id),{...base,folio,fecha:new Date().toISOString()});
        setMsg(`✅ Guardado como ${folio}${dest?` · destino ${dest.folio}`:""}.`);
      }
      setItems(null);setDialogo(null);
    }catch(e){ setMsg("❌ No se pudo guardar: "+(e?.message||e)); }
    finally{ setSaving(false); }
  }

  // ── historial ───────────────────────────────────────────────
  async function cargarHistorial(){
    try{
      const qs=await getDocs(collection(db,COL.packing));
      setItems(qs.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>safe(b.fecha_mod||b.fecha).localeCompare(safe(a.fecha_mod||a.fecha))));
    }catch(e){ setItems([]); }
  }
  useEffect(()=>{ if(sub==="hist"&&items===null) cargarHistorial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sub]);

  function reabrir(it){
    if(!it.estado){setMsg("❌ Este registro es de la versión anterior y solo se puede consultar o copiar.");return;}
    setSub("tool");
    setEditando({id:it.id,folio:it.folio});
    // el iframe puede seguir cargando: reintenta hasta 5s
    let intentos=0;
    const timer=setInterval(()=>{
      const br=puente();
      if(br?.setEstado&&br.setEstado(it.estado)){
        clearInterval(timer);
        setMsg(`✏️ Editando ${it.folio}. Modifica lo necesario y usa ACTUALIZAR (mismo folio) o GUARDAR COMO NUEVO.`);
      }else if(++intentos>25){ clearInterval(timer); setMsg("❌ No pude cargar el estado en la herramienta. Recarga la página."); setEditando(null); }
    },200);
  }

  function imprimirSnapshot(it){
    const w=window.open("","_blank");
    if(!w){setMsg("❌ El navegador bloqueó la ventana de impresión.");return;}
    w.document.write(`<html><head><title>${safe(it.folio)}</title><style>
      body{font-family:monospace;font-size:12px;line-height:1.5;padding:24px;white-space:pre-wrap}
      h2{font-family:sans-serif;margin:0 0 4px}
      .m{color:#666;font-family:sans-serif;font-size:11px;margin-bottom:14px}
    </style></head><body><h2>${safe(it.folio)}</h2>
    <div class="m">${safe(it.vendedor)} · ${safe(it.fecha).slice(0,16).replace("T"," ")}${it.destino?` · Destino ${safe(it.destino.folio)} ${safe(it.destino.nombre)}`:""}${it.fecha_mod?` · modificado ${safe(it.fecha_mod).slice(0,16).replace("T"," ")}`:""}</div>
    ${safe(it.contenido).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</body></html>`);
    w.document.close();w.focus();w.print();
  }

  function copiar(texto){
    try{ navigator.clipboard.writeText(texto); setMsg("✅ Copiado al portapapeles."); }
    catch(e){
      const ta=document.createElement("textarea");
      ta.value=texto;document.body.appendChild(ta);ta.select();
      document.execCommand("copy");document.body.removeChild(ta);
      setMsg("✅ Copiado al portapapeles.");
    }
  }
  async function eliminar(it){
    if(!admin)return;
    if(!window.confirm(`¿Eliminar ${it.folio} del historial?`))return;
    await deleteDoc(doc(db,COL.packing,it.id));
    setItems(prev=>prev.filter(x=>x.id!==it.id));
  }

  const filtrados=(items||[]).filter(it=>{
    const q=busca.trim().toLowerCase();
    if(!q)return true;
    return [it.folio,it.vendedor,it.usuario,it.resumen,it.contenido,it.destino?.nombre,it.destino?.folio]
      .some(v=>safe(v).toLowerCase().includes(q));
  });

  const botonSub=(k,lbl)=>(
    <button onClick={()=>setSub(k)} style={{
      background:sub===k?DK:"#fff",color:sub===k?"#fff":GRL,
      border:"1px solid "+(sub===k?DK:BD),padding:"8px 16px",
      borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:800,letterSpacing:1}}>{lbl}</button>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:800,fontSize:13,color:OR}}>OPTIMIZADOR DE PAQUETES</div>
          <div style={{color:GRL,fontSize:11,marginTop:2}}>Herramienta interna. Los clientes no la ven.</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {botonSub("tool","HERRAMIENTA")}
          {botonSub("hist","HISTORIAL")}

        </div>
      </div>

      {msg&&<div style={{marginBottom:10,padding:"9px 12px",borderRadius:8,fontSize:12,fontWeight:600,
        background:msg.startsWith("✅")||msg.startsWith("✏️")?"#ECFDF5":"#FEF2F2",
        color:msg.startsWith("✅")||msg.startsWith("✏️")?"#065F46":"#B91C1C",
        border:"1px solid "+(msg.startsWith("✅")||msg.startsWith("✏️")?"#A7F3D0":"#FECACA")}}>{msg}</div>}

      {sub==="tool"&&<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
          {/* destino guardado → se inyecta km + datos de envío */}
          <select onChange={e=>{if(e.target.value)inyectarDestino(e.target.value);e.target.value="";}}
            defaultValue="" style={{padding:"9px 10px",border:"1px solid "+BD,borderRadius:8,fontSize:12,background:"#fff",maxWidth:mob?"100%":360}}>
            <option value="">📍 Cargar destino guardado…</option>
            {(destinos||[]).map(d=><option key={d.id} value={d.id}>{d.folio} · {d.nombre}{d.km?` (${d.km} km)`:""}</option>)}
          </select>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {editando&&<>
              <button onClick={()=>abrirDialogo("actualizar")} disabled={saving} style={{
                background:DK,color:"#fff",border:"none",padding:"10px 16px",borderRadius:8,
                cursor:"pointer",fontSize:12,fontWeight:800,letterSpacing:.5}}>
                ✏️ ACTUALIZAR {editando.folio}
              </button>
              <button onClick={()=>{setEditando(null);setMsg("Edición cancelada. Un guardado ahora crearía folio nuevo.");}} style={{
                background:"#fff",color:GRL,border:"1px solid "+BD,padding:"10px 12px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700}}>
                CANCELAR
              </button>
            </>}
            <button onClick={()=>abrirDialogo("nuevo")} disabled={saving} style={{
              background:OR,color:"#fff",border:"none",padding:"10px 18px",borderRadius:8,
              cursor:saving?"wait":"pointer",fontSize:12,fontWeight:800,letterSpacing:1,opacity:saving?.7:1}}>
              💾 {editando?"GUARDAR COMO NUEVO":"GUARDAR AHORA"}
            </button>
          </div>
        </div>
        <div style={{border:"1px solid "+BD,borderRadius:10,overflow:"hidden",background:"#fff"}}>
          <iframe ref={frameRef} src="/optimizador.html" title="Optimizador de paquetes"
            onLoad={engancharPuente}
            style={{width:"100%",height:mob?"68vh":"78vh",border:"none",display:"block"}}/>
        </div>
      </>}

      {sub==="hist"&&<div>
        <input value={busca} onChange={e=>setBusca(e.target.value)}
          placeholder="Buscar por folio, vendedor, destino o contenido…"
          style={{width:"100%",padding:"10px 12px",border:"1px solid "+BD,borderRadius:8,fontSize:16,outline:"none",boxSizing:"border-box",marginBottom:10}}/>
        {items===null&&<div style={{color:GRL,fontSize:12,padding:20,textAlign:"center"}}>Cargando historial…</div>}
        {items!==null&&filtrados.length===0&&<div style={{color:GRL,fontSize:12,padding:20,textAlign:"center"}}>
          {busca?"Nada coincide con la búsqueda.":"Aún no hay packing lists guardados. Genera uno en HERRAMIENTA y presiona GUARDAR EN HISTORIAL."}</div>}
        {filtrados.map(it=>(
          <div key={it.id} style={{border:"1px solid "+BD,borderRadius:10,background:"#fff",marginBottom:8,overflow:"hidden"}}>
            <div onClick={()=>setExpanded(expanded===it.id?null:it.id)}
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",flexWrap:"wrap"}}>
              <div style={{minWidth:0}}>
                <span style={{fontFamily:"monospace",fontWeight:800,color:OR,fontSize:13}}>{it.folio}</span>
                {it.destino&&<span style={{fontFamily:"monospace",fontSize:11,color:"#1B4F72",background:"#EBF5FB",border:"1px solid #D4E6F1",padding:"2px 7px",borderRadius:10,marginLeft:8}}>📍 {safe(it.destino.folio)} {safe(it.destino.nombre)}</span>}
                <span style={{color:"#333",fontSize:12,marginLeft:10,fontWeight:700}}>{safe(it.vendedor)}</span>
                <span style={{color:GRL,fontSize:11,marginLeft:10}}>{safe(it.fecha).slice(0,10)} {safe(it.fecha).slice(11,16)}</span>
                {it.fecha_mod&&<span style={{color:"#92400E",fontSize:10,marginLeft:8,background:"#FEF3C7",padding:"2px 6px",borderRadius:8}}>mod. {safe(it.fecha_mod).slice(0,10)}</span>}
                <div style={{color:GRL,fontSize:11,marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:mob?"78vw":640}}>{safe(it.resumen)}</div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <button onClick={e=>{e.stopPropagation();reabrir(it);}} disabled={!it.estado}
                  title={it.estado?"Carga este packing en la herramienta para modificarlo":"Registro antiguo: solo consulta"}
                  style={{background:"#fff",color:it.estado?OR:"#bbb",border:"1.5px solid "+(it.estado?OR:BD),padding:"6px 12px",borderRadius:6,cursor:it.estado?"pointer":"not-allowed",fontSize:11,fontWeight:700}}>REABRIR</button>
                <button onClick={e=>{e.stopPropagation();imprimirSnapshot(it);}}
                  style={{background:OR,color:"#fff",border:"none",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>IMPRIMIR</button>
                <button onClick={e=>{e.stopPropagation();copiar(safe(it.contenido));}}
                  style={{background:"#fff",color:GRL,border:"1px solid "+BD,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>COPIAR</button>
                {admin&&<button onClick={e=>{e.stopPropagation();eliminar(it);}}
                  style={{background:"#fff",color:"#B91C1C",border:"1px solid #FECACA",padding:"6px 10px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>✕</button>}
                <span style={{color:GRL,fontSize:11}}>{expanded===it.id?"▲":"▼"}</span>
              </div>
            </div>
            {expanded===it.id&&<pre style={{margin:0,padding:"12px 14px",borderTop:"1px solid "+BD,background:"#FAFAFA",
              fontSize:11.5,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:420,overflow:"auto"}}>{safe(it.contenido)}</pre>}
          </div>
        ))}
      </div>}

      {/* ── diálogo de destino al guardar ── */}
      {dialogo&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:60,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
        onClick={()=>!saving&&setDialogo(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,padding:20,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
          <div style={{fontWeight:800,fontSize:13,color:OR,marginBottom:4}}>
            {dialogo.modo==="actualizar"?`ACTUALIZAR ${editando?.folio}`:"GUARDAR PACKING"}
          </div>
          <div style={{color:GRL,fontSize:11,marginBottom:12}}>
            El destino queda registrado con su número único (D-0001…). Si ya existe, se reutiliza su folio.
          </div>
          <label style={{fontSize:10,color:GRL,letterSpacing:2}}>DESTINO</label>
          <input list="destinos-lista" value={dialogo.destino} autoFocus
            onChange={e=>setDialogo(d=>({...d,destino:e.target.value}))}
            placeholder="Ej. Chapala, Jalisco"
            style={{width:"100%",padding:"10px 12px",border:"1px solid "+BD,borderRadius:8,fontSize:16,outline:"none",boxSizing:"border-box",margin:"4px 0 14px"}}/>
          <datalist id="destinos-lista">
            {(destinos||[]).map(d=><option key={d.id} value={d.nombre}>{d.folio}{d.km?` · ${d.km} km`:""}</option>)}
          </datalist>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>setDialogo(null)} disabled={saving}
              style={{background:"#fff",color:GRL,border:"1px solid "+BD,padding:"9px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>CANCELAR</button>
            <button onClick={confirmarGuardar} disabled={saving}
              style={{background:OR,color:"#fff",border:"none",padding:"9px 18px",borderRadius:8,cursor:saving?"wait":"pointer",fontSize:12,fontWeight:800,opacity:saving?.7:1}}>
              {saving?"GUARDANDO…":"CONFIRMAR"}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}

function HistorialCotizaciones({session,onReabrir}){
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

  // Tabla lista para PEGAR en la factura de SAP: SKU, descripción,
  // cantidad y precio unitario SIN IVA con el descuento YA aplicado.
  // Se copia al portapapeles (pegado directo en la rejilla de SAP) y
  // además se descarga como archivo que abre Excel.
  // Precisión: el unitario va a 4 decimales (petición de Nicolás).
  // Con 4 el cuadre contra el total sigue siendo de centavos exactos
  // en casos normales; solo con cantidades de miles podría desfasarse
  // 1-2 centavos, que SAP redondea igual.
  function excelSAP(cot){
    const desc=clampDesc(cot.descuento);
    const filas=(cot.items||[]).map(it=>{
      const unitConIVA=safeNum(it.precio)*(1-desc/100);
      const unitSinIVA=unitConIVA/(1+TASA_IVA);
      return [safe(it.codigo)||safe(it.medida),
              safeNum(it.cantidad),unitSinIVA.toFixed(4),safe(it.descripcion)];
    });
    const paq=safeNum(cot.paqueteria);
    if(paq>0) filas.push(["PAQUETERIA",1,(paq/(1+TASA_IVA)).toFixed(4),"PAQUETERIA / ENVIO"]);
    if(!filas.length){alert("Esta cotización no tiene partidas guardadas.");return;}
    const enc=["SKU","CANTIDAD","PRECIO SIN IVA","DESCRIPCION"];
    const tsv=[enc,...filas].map(f=>f.join("\t")).join("\n");
    try{navigator.clipboard.writeText(tsv);}catch(e){}
    // descarga .csv (Excel lo abre): BOM para acentos correctos
    const csv="\uFEFF"+[enc,...filas].map(f=>f.map(c=>{
      const t=String(c); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;
    }).join(",")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`Factura_${safe(cot.folio)||"cotizacion"}.csv`;
    document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);
    alert(`Tabla para SAP lista:\n\n• Copiada al portapapeles: pega directo en la factura (Ctrl+V).\n• Descargada como Factura_${safe(cot.folio)}.csv por si la prefieres desde Excel.\n\nPrecios SIN IVA${desc>0?` con el ${desc}% de descuento ya aplicado`:""}.`);
  }

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
                {interno&&<button onClick={e=>{e.stopPropagation();excelSAP(cot);}}
                  title="Copia la tabla (SKU, cantidad, precio sin IVA con descuento) para pegarla en la factura de SAP"
                  style={{background:"#fff",color:"#1B7A43",border:"1.5px solid #1B7A43",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>SAP</button>}
                {onReabrir&&<button onClick={e=>{e.stopPropagation();onReabrir(cot);}}
                  title="Carga las partidas al carrito para modificarlas y generar una cotización nueva"
                  style={{background:"#fff",color:OR,border:"1.5px solid "+OR,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>REABRIR</button>}
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
  // La ficha se compactó: antes cabía UNA por pantalla y el stock
  // aparecía tres veces (badge, TLAJO/CHAPALA y TOTAL). El aviso de
  // IVA vive ahora en la franja del header, no en cada tarjeta.
  return(
    <div style={{background:CD,borderRadius:12,boxShadow:"0 2px 8px rgba(0,0,0,.08)",overflow:"hidden",borderTop:"3px solid "+OR,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px 6px"}}>
        <MarcaChip marca={p.marca} size={12}/>
        <span style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:800,color:col}}>
          <span style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0}}/>
          {stockVis(tot,vend)} pzs
        </span>
      </div>
      {/* #BBB sobre blanco daba 1.9:1 de contraste: ilegible bajo el sol. */}
      <div style={{fontFamily:"monospace",fontSize:10,color:"#8A8A8A",padding:"0 14px 4px"}}>{p.codigo}</div>
      <div style={{fontSize:22,fontWeight:900,color:DK,padding:"0 14px 6px",letterSpacing:-.5,lineHeight:1.1}}>{p.medida||"—"}</div>
      <div style={{fontSize:13,color:"#444",padding:"0 14px 12px",lineHeight:1.45,fontWeight:500}}>{p.descripcion}</div>

      {vend?(
        // Mismo orden que el CSV, el carrito y procesar_inventario.py:
        // ASOCIADO · DISTRIBUIDOR · PÚBLICO.
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",background:BG,borderTop:"1px solid "+BD}}>
          {[["ASOCIADO",p.asociado,C_ASOC],["DISTRIBUIDOR",p.distribuidor,C_DIST],["PÚBLICO",p.publico,C_PUB]].map(([l,v,st])=>(
            <div key={l} style={{padding:"10px 6px",textAlign:"center",background:st.bg}}>
              <div style={{fontSize:9,color:GRL,fontWeight:700,letterSpacing:.5,marginBottom:4}}>{l}</div>
              {esVolumen(p)?<VolBadge/>:<div style={{fontSize:16,fontWeight:800,color:st.c}}>{money(v)}</div>}
            </div>
          ))}
        </div>
      ):(
        <div style={{background:BG,borderTop:"1px solid "+BD,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:9,color:GRL,fontWeight:700,letterSpacing:.6}}>TU PRECIO ({safe(lista)||"PÚBLICO"})</div>
            <div style={{fontSize:10,color:GRL,marginTop:2}}>Almacén ppal: <strong style={{color:DK}}>{almPpal(p)}</strong></div>
          </div>
          {esVolumen(p)?<VolBadge grande/>:<span style={{fontSize:19,fontWeight:900,color:OR}}>{money(getPrecio(p,lista))}</span>}
        </div>
      )}

      <div style={{borderTop:"1px solid "+BD,background:"#FAFAFA",display:"flex",alignItems:"center",gap:12,padding:"8px 14px",flexWrap:"wrap"}}>
        <span style={{fontSize:9,fontWeight:700,color:GRL,letterSpacing:.6}}>EXISTENCIA</span>
        {ALMS.map((a,i)=>(
          <span key={a} style={{fontSize:11,color:GRL,display:"inline-flex",alignItems:"center",gap:5}}>
            {ALMS_L[i]} <StockPill v={p[a]} real={vend}/>
          </span>
        ))}
      </div>
      <button onClick={tot>0?onAdd:undefined} disabled={tot===0}
        style={{width:"100%",padding:14,background:tot>0?OR:"#C9C9C9",color:"#fff",border:"none",cursor:tot>0?"pointer":"not-allowed",fontWeight:800,fontSize:13,letterSpacing:1}}>
        {tot>0?"＋ AGREGAR A COTIZACIÓN":"SIN EXISTENCIA"}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  RED DE SEGURIDAD
//  Si algo truena al pintar, React borra TODA la pantalla y deja el
//  fondo en blanco, sin decir qué pasó. Esto lo atrapa y muestra el
//  error en pantalla, con el componente y la línea. Nunca más un
//  blanco mudo.
// ══════════════════════════════════════════════════════════════
class RedDeSeguridad extends Component {
  constructor(p){ super(p); this.state={error:null,info:null}; }
  static getDerivedStateFromError(error){ return {error}; }
  componentDidCatch(error,info){ this.setState({info}); console.error("Fallo capturado:",error,info); }
  render(){
    if(!this.state.error) return this.props.children;
    const e=this.state.error, info=this.state.info;
    return (
      <div style={{minHeight:"100vh",background:BG,fontFamily:"Arial,sans-serif",padding:24,
                   display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{maxWidth:720,width:"100%",background:"#fff",border:"1px solid "+BD,
                     borderRadius:10,padding:28,boxShadow:"0 8px 40px rgba(0,0,0,.10)"}}>
          <div style={{fontSize:13,fontWeight:800,color:"#dc2626",letterSpacing:1,marginBottom:6}}>
            EL PORTAL NO PUDO ABRIR
          </div>
          <div style={{color:GRL,fontSize:12,marginBottom:18}}>
            Manda esta pantalla completa para resolverlo. {VERSION}
          </div>
          <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,
                       padding:"12px 14px",marginBottom:14}}>
            <div style={{fontFamily:"monospace",fontSize:12,color:"#991b1b",wordBreak:"break-word"}}>
              {String(e && (e.message||e))}
            </div>
          </div>
          {info && info.componentStack &&
            <details style={{marginBottom:16}}>
              <summary style={{cursor:"pointer",fontSize:11,color:GRL,letterSpacing:1}}>DETALLE TÉCNICO</summary>
              <pre style={{fontSize:10,color:GRL,background:"#fafafa",padding:12,borderRadius:6,
                           overflowX:"auto",whiteSpace:"pre-wrap",marginTop:8,maxHeight:220}}>
                {String(info.componentStack).trim().split("\n").slice(0,12).join("\n")}
              </pre>
            </details>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>location.reload()}
              style={{background:OR,color:"#fff",border:"none",padding:"11px 20px",borderRadius:6,
                      cursor:"pointer",fontWeight:800,fontSize:12,letterSpacing:1}}>REINTENTAR</button>
            <button onClick={async()=>{ try{await signOut(auth);}catch(x){} location.reload(); }}
              style={{background:"#fff",color:GRL,border:"1px solid "+BD,padding:"11px 20px",
                      borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:12}}>SALIR Y REINTENTAR</button>
          </div>
        </div>
      </div>
    );
  }
}

function Portal(){
  const [session,setSession]=useState(null);
  const [view,setView]=useState("cargando");
  // La pestaña activa vive también en la URL (#optimizador, #quotes…):
  // así la recarga te deja donde estabas, el botón "atrás" regresa de
  // sección en vez de sacarte del portal, y se pueden guardar links
  // directos a una sección. Si el hash trae basura, cae a "products".
  const TABS_URL=["products","vendedores","clients","quotes","arribos","optimizador","settings","catalogo"];
  const hashTab=()=>{const h=window.location.hash.replace("#","");return TABS_URL.includes(h)?h:"products";};
  const [tab,_setTab]=useState(hashTab);
  const setTab=t=>{
    // El optimizador SIEMPRE se trabaja en su propia pestaña del
    // navegador (petición de Nicolás): más espacio y no interrumpe lo
    // que se esté haciendo en el portal. La pestaña nueva abre el
    // portal anclado en #optimizador, con HERRAMIENTA e HISTORIAL.
    if(t==="optimizador"&&tab!=="optimizador"){
      window.open(window.location.pathname+"#optimizador","_blank");
      return;
    }
    _setTab(t);
    if(t!==window.location.hash.replace("#",""))
      window.history.pushState(null,"","#"+t);
  };
  useEffect(()=>{
    const onPop=()=>_setTab(hashTab());
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
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
    // Se limpia ANTES de cargar: si la carga falla, la pantalla queda
    // vacía con aviso, nunca mostrando en silencio datos de otra
    // sesión (p.ej. el catálogo topado de un cliente de prueba).
    setProducts([]);
    const d = esInterno(u) ? await fbGetProductos() : await fbGetCatalogoCliente(u?.lista);
    if(d!==null) setProducts(d);
    else alert("No se pudo cargar el catálogo. Revisa tu conexión y presiona RECARGAR.");
    setProdLoad(false);
  }
  async function loadUsers(){setUserLoad(true);const d=await fbGetUsuarios();if(d!==null)setUsers(d);setUserLoad(false);}

  const marcas=useMemo(()=>{
    const s=new Set(products.map(p=>safe(p.marca)).filter(Boolean));
    // Orden comercial fijo (ORDEN_MARCAS); lo no listado va después en
    // alfabético, y el chip OTRAS siempre queda al final de la fila.
    return Array.from(s).sort((a,b)=>ordenMarca(a)-ordenMarca(b)||a.localeCompare(b,"es"));
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

  // Reabrir una cotización del historial: sus partidas pasan al
  // carrito tal cual se cotizaron (precio original respetado, decisión
  // de Nicolás) para quitar, agregar o cambiar cantidades. Al generar,
  // sale con FOLIO NUEVO; la original no se toca ni se borra.
  function reabrirCotizacion(cot){
    const items=(cot.items||[]).map(it=>({
      marca:safe(it.marca),medida:safe(it.medida),
      codigo:safe(it.codigo),descripcion:safe(it.descripcion),
      precio:safeNum(it.precio),
      tipoPrecio:safe(it.tipoPrecio)||"publico",
      cantidad:Math.max(1,safeNum(it.cantidad)),
      // sin _publico/_distribuidor/_asociado: el selector de lista se
      // queda con el precio cotizado, que es la regla acordada.
      _publico:safeNum(it._publico)||safeNum(it.precio),
      _distribuidor:safeNum(it._distribuidor)||safeNum(it.precio),
      _asociado:safeNum(it._asociado)||safeNum(it.precio),
    }));
    if(items.length===0){alert("Esta cotización no tiene partidas guardadas.");return;}
    setCart(items);
    setCartOpen(true);
    setTab("products");
  }

  function addToCart(p){
    if(esVolumen(p)){
      if(!isVendedor(session)){
        alert("Este producto se vende por volumen (precio especial por costal).\n\nNo se cotiza desde el portal: consulta condiciones con tu asesor.");
        return;
      }
      // Vendedor: captura el precio pactado. SIEMPRE con IVA incluido,
      // igual que toda la lista de precios del portal.
      const resp=window.prompt(`${safe(p.descripcion)}\n\nPrecio PACTADO por pieza, CON IVA incluido:`);
      if(resp===null) return; // canceló
      const precio=safeNum(resp);
      if(precio<=0){alert("Escribe un precio válido mayor a cero.");return;}
      setCart(prev=>{
        const idx=prev.findIndex(it=>it.codigo===p.codigo);
        if(idx>=0) return prev.map((it,i)=>i===idx?{...it,cantidad:it.cantidad+1}:it);
        return [...prev,{
          marca:safe(p.marca),medida:safe(p.medida),
          codigo:safe(p.codigo),descripcion:safe(p.descripcion),
          precio,tipoPrecio:"pactado",cantidad:1,
          _publico:precio,_distribuidor:precio,_asociado:precio,
        }];
      });
      setCartOpen(true);
      return;
    }
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
          const meli =safeNum(pick(r,"MELI","CHAPALA","CHAP06"));
          const chap3=safeNum(pick(r,"CHAP03","CHAPALA03"));
          const totalCol=safeNum(pick(r,"TOTAL","TOTALALMACEN","TOTAL ALMACÉN","EXISTENCIA"));
          return {
            marca:      pick(r,"MARCA"),
            medida:     pick(r,"MEDIDA"),
            codigo:     pick(r,"CODIGO","CÓDIGO","SKU","NUMERO DE ARTICULO","NÚMERO DE ARTÍCULO"),
            descripcion:pick(r,"DESCRIPCION","DESCRIPCIÓN"),
            asociado:     safeNum(pick(r,"ASOCIADO")),
            distribuidor: safeNum(pick(r,"DISTRIBUIDOR")),
            publico:      safeNum(pick(r,"PVP","PUBLICO","PÚBLICO","PVP PUBLICO")),
            tlajo, meli, chap3,
            total: totalCol>0?totalCol:(tlajo+meli+chap3),
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
            topar(p.tlajo), topar(p.meli), topar(p.chap3), topar(p.total),
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
      const esVendedorForm=safe(form.lista)==="VENDEDOR";
      const data={nombre:safe(form.nombre),
        empresa:esVendedorForm?EMPRESA.nombre:safe(form.empresa),
        usuario:safe(form.usuario),lista:safe(form.lista),estatus:safe(form.estatus),rol:"client",
        // Solo tiene sentido en vendedores: si se le cambia la lista a
        // cliente, el permiso se apaga solo.
        puede_catalogo: safe(form.lista)==="VENDEDOR" && form.puede_catalogo===true,
        actualizado:new Date().toISOString()};
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
    // Al crear, modal.data puede traer la lista ya elegida (el botón
    // "+ VENDEDOR" la manda), así no hay que acordarse de cambiarla.
    const [form,setForm]=useState(isEdit?{...modal.data,password:""}:{...emptyC,...(modal.data||{})});
    const esVend=safe(form.lista)==="VENDEDOR";
    const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
    return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:CD,borderRadius:10,padding:24,width:"100%",maxWidth:460,boxShadow:"0 8px 40px rgba(0,0,0,.2)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:800,fontSize:14,color:esVend?"#9333ea":OR,marginBottom:18}}>{(isEdit?"EDITAR ":"NUEVO ")+(esVend?"VENDEDOR":"CLIENTE")}</div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <Inp label="NOMBRE *" value={form.nombre} onChange={e=>upd("nombre",e.target.value)}/>
          {/* Un vendedor siempre es de LlantyMoto: preguntar la empresa
              solo estorba, así que el campo únicamente existe para
              clientes y en vendedores se llena solo al guardar. */}
          {!esVend&&<Inp label="EMPRESA" value={form.empresa||""} onChange={e=>upd("empresa",e.target.value)}/>}
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
          {esVend&&<div style={{marginBottom:12,background:"#faf5ff",border:"1px solid #e9d5ff",borderRadius:6,padding:"10px 12px"}}>
            <label style={{display:"flex",alignItems:"flex-start",gap:9,cursor:"pointer"}}>
              <input type="checkbox" checked={form.puede_catalogo===true}
                onChange={e=>upd("puede_catalogo",e.target.checked)}
                style={{width:16,height:16,marginTop:1,accentColor:"#9333ea",flexShrink:0}}/>
              <span>
                <span style={{fontSize:12,fontWeight:700,color:"#6b21a8"}}>Puede subir el catálogo diario</span>
                <span style={{display:"block",color:GRL,fontSize:10,marginTop:2,lineHeight:1.4}}>
                  Le aparece la pestaña SUBIR CATÁLOGO para cargar el CSV. No le da acceso a clientes, usuarios ni configuración.
                </span>
              </span>
            </label>
          </div>}
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

  // El header va en DOS filas en el teléfono. En una sola, el logotipo
  // (250px) + el badge de IVA (nowrap) + SALIR sumaban 400px en una
  // pantalla de 360: el badge se encimaba y SALIR quedaba cortado.
  const Hdr=session&&(
    <header ref={hdrRef} style={{background:DK,position:"sticky",top:0,zIndex:9,boxShadow:"0 2px 10px rgba(0,0,0,.4)",paddingTop:"env(safe-area-inset-top)",overflow:"hidden"}}>
      <div style={{padding:mob?"8px 12px":"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0,flex:1}}>
          <Logo h={mob?40:50} max={mob?200:250}/>
          {!mob&&<>
            <div style={{width:1,height:24,background:"rgba(255,255,255,.2)"}}/>
            <span style={{color:"rgba(255,255,255,.75)",fontSize:10,letterSpacing:2}}>{isAdminRole(session)?"PANEL ADMINISTRADOR":"PORTAL DE PRECIOS"}</span>
          </>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          {!mob&&<span style={{background:OR,color:"#fff",fontSize:10,fontWeight:700,padding:"4px 12px",borderRadius:20,letterSpacing:.5,whiteSpace:"nowrap"}}>
            {PRECIOS_CON_IVA?"PRECIOS CON IVA INCLUIDO":"PRECIOS SIN IVA"}
          </span>}
          {!mob&&<div style={{textAlign:"right"}}>
            <div style={{color:"#fff",fontSize:12,fontWeight:600}}>{session.nombre}</div>
            {session.empresa&&<div style={{color:"rgba(255,255,255,.6)",fontSize:10}}>{session.empresa}</div>}
          </div>}
          <button onClick={doLogout} style={{background:"rgba(255,255,255,.12)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",padding:"7px 14px",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:11,letterSpacing:1,flexShrink:0}}>SALIR</button>
        </div>
      </div>
      {/* Esta franja carga los dos avisos permanentes, así el teléfono
          se ahorra la barra naranja de CONTADO y el recuadro de IVA. */}
      {mob&&<div style={{background:OR,color:"#fff",fontSize:10,fontWeight:800,textAlign:"center",padding:"4px 8px",letterSpacing:.3}}>
        {PRECIOS_CON_IVA?"PRECIOS CON IVA INCLUIDO":"PRECIOS SIN IVA"} · CONTADO ANTICIPADO −3%
      </div>}
    </header>
  );

  const CartFab=cart.length>0&&!cartOpen&&(
    <button onClick={()=>setCartOpen(true)} style={{position:"fixed",bottom:"calc(20px + env(safe-area-inset-bottom))",right:"calc(16px + env(safe-area-inset-right))",zIndex:1000,background:OR,color:"#fff",border:"none",borderRadius:50,padding:"12px 20px",cursor:"pointer",fontWeight:800,fontSize:13,boxShadow:"0 4px 16px rgba(255,92,30,.5)",display:"flex",alignItems:"center",gap:8}}>
      COTIZACIÓN
      <span style={{background:"#fff",color:OR,borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{cart.length}</span>
    </button>
  );

  // Una sola pieza para pintar un grupo de usuarios: se usa dos veces,
  // una para el equipo interno y otra para los clientes. Antes era una
  // sola lista revuelta y había que ir leyendo badge por badge para
  // saber quién era vendedor.
  const BloqueUsuarios=({lista,acento,vacio})=>(
    <div>
      <div style={{borderTop:"2px solid "+acento,marginBottom:12}}/>
      {lista.length===0&&<div style={{color:GRL,fontSize:12,padding:"6px 2px 14px"}}>{vacio||"Todavía no hay nadie en este grupo."}</div>}
      {lista.length>0&&(mob?(
        <div>{lista.map(u=><div key={u.id} style={{background:isAdminRole(u)?"#eff6ff":CD,border:"1px solid "+(isAdminRole(u)?"#bfdbfe":BD),borderRadius:8,padding:14,marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>{u.nombre}
                {isAdminRole(u)&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>ADMIN</span>}
                {!isAdminRole(u)&&u.puede_catalogo===true&&<span style={{marginLeft:6,fontSize:9,background:"#f3e8ff",color:"#7e22ce",padding:"1px 6px",borderRadius:3,fontWeight:700}}>SUBE CSV</span>}
              </div>
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
            <tbody>{lista.map((u,i)=><tr key={u.id} style={{borderTop:"1px solid "+BD,background:isAdminRole(u)?"#eff6ff":i%2?"#FAFAFA":"#fff"}}>
              <td style={{padding:"9px 14px",fontWeight:600}}>{u.nombre}
                {isAdminRole(u)&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>ADMIN</span>}
                {!isAdminRole(u)&&u.puede_catalogo===true&&<span style={{marginLeft:6,fontSize:9,background:"#f3e8ff",color:"#7e22ce",padding:"1px 6px",borderRadius:3,fontWeight:700}}>SUBE CSV</span>}
              </td>
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
      ))}
    </div>
  );

  // Vendedor = usuario con lista VENDEDOR. isVendedor() ya mete ahí a
  // los administradores, que también ven las tres listas.
  const porNombre = (a,b)=>safe(a.nombre).localeCompare(safe(b.nombre),"es");
  const equipo   = users.filter(u=>isVendedor(u)).sort(porNombre);
  const clientes = users.filter(u=>!isVendedor(u)).sort(porNombre);


  // El mismo bloque sirve para el administrador y para el vendedor con
  // permiso. Plegado en el teléfono del admin (donde es una tarea de
  // una vez al día), abierto para quien entra justo a subir el CSV.
  const BloqueCatalogo=({plegable=true})=>{
    const controles=<>
      <div style={{flex:1,minWidth:180}}>
        <div style={{color:GRL,fontSize:11}}>CSV UTF-8 con las columnas:</div>
        <div style={{color:"#8A8A8A",fontSize:10,marginTop:2}}>MARCA, MEDIDA, CODIGO, DESCRIPCION, ASOCIADO, DISTRIBUIDOR, PVP, TLAJO, MELI, CHAP03, TOTAL</div>
      </div>
      <input type="file" accept=".csv,.tsv,.txt" ref={fref} onChange={handleFile} style={{display:"none"}}/>
      <Btn onClick={()=>{setMsg("");fref.current.click();}}>SUBIR CSV</Btn>
      <button onClick={loadProducts} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
      {msg&&<div style={{fontSize:11,width:"100%",padding:"8px 12px",borderRadius:6,marginTop:8,
        background:msg.startsWith("✅")?"#f0fdf4":msg.startsWith("❌")?"#fef2f2":"#fffbeb",
        color:msg.startsWith("✅")?"#16a34a":msg.startsWith("❌")?"#dc2626":"#d97706",
        border:`1px solid ${msg.startsWith("✅")?"#bbf7d0":msg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{msg}</div>}
    </>;
    const caja={background:CD,border:"1px solid "+BD,borderRadius:8,marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,.05)"};
    return (mob&&plegable)?(
      <details style={caja}>
        <summary style={{padding:"11px 14px",fontWeight:800,fontSize:12,cursor:"pointer"}}>ACTUALIZAR CATÁLOGO</summary>
        <div style={{padding:"0 14px 14px",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>{controles}</div>
      </details>
    ):(
      <div style={{...caja,padding:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        {plegable&&<div style={{fontWeight:800,fontSize:12,width:"100%"}}>ACTUALIZAR CATÁLOGO</div>}
        {controles}
      </div>
    );
  };

  const TabBar=({items})=>(
    <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto",scrollbarWidth:"none",
      ...(mob?{maskImage:"linear-gradient(to right,#000 90%,transparent)",WebkitMaskImage:"linear-gradient(to right,#000 90%,transparent)"}:{})}}>
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
          <div style={{color:GRL,fontSize:11,letterSpacing:3,textAlign:"center",marginBottom:4}}>PORTAL DE PRECIOS</div>
          <div style={{color:"#c8c8c8",fontSize:9,textAlign:"center",marginBottom:16}}>{VERSION}</div>
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
      {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} products={products} onClose={()=>setCartOpen(false)}/>}
      {CartFab}
      <TabBar items={[["products","CATÁLOGO"],["vendedores","VENDEDORES"],["clients","CLIENTES"],["quotes","COTIZACIONES"],["arribos","ARRIBOS"],["optimizador","OPTIMIZADOR"],["settings","CONFIGURACIÓN"]]}/>
      <div style={{padding:mob?12:24,maxWidth:1400,margin:"0 auto"}}>

        {tab==="products"&&<div>
          {/* En el teléfono se pliega: es una tarea de una vez al día. */}
          <BloqueCatalogo/>

          <Buscador search={search} ds={ds} onChange={setSearch} marca={marca} setMarca={setMarca} marcas={marcas} count={filtered.length} mob={mob} top={hdrH}/>
          {prodLoad&&<div style={{textAlign:"center",padding:30,color:GRL}}>Cargando catálogo...</div>}
          {!prodLoad&&products.length===0&&<div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
            <div style={{fontSize:40,marginBottom:12}}>📦</div>
            <div style={{fontSize:14,fontWeight:600}}>El catálogo está vacío</div>
            <div style={{fontSize:12,marginTop:6}}>Sube el CSV para empezar.</div>
          </div>}
          {/* En el teléfono, tarjetas: la tabla obligaba a deslizar de lado
              para alcanzar precios y existencia. */}
          {!prodLoad&&products.length>0&&mob&&(
            <div style={{paddingBottom:mob?96:0}}>{filtered.slice(0,(page+1)*PS).map((p,i)=>
              <CardProducto key={p.id||i} p={p} vend={true} lista="VENDEDOR" onAdd={()=>addToCart(p)}/>
            )}</div>
          )}
          {!prodLoad&&products.length>0&&!mob&&<div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:10,background:"#fff"}}>
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
                  {esVolumen(p)?<td colSpan={3} style={{padding:"8px",textAlign:"center"}}><VolBadge/></td>:<>
                  <td style={{padding:"8px",textAlign:"right",color:OR,fontWeight:800}}>{money(p.publico)}</td>
                  <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.distribuidor)}</td>
                  <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.asociado)}</td></>}
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
          {products.length>0&&<Pager total={filtered.length} pg={page} setPg={setPage} ps={PS} mob={mob}/>}
        </div>}

        {/* Vendedores y clientes viven en pestañas aparte: son dos
            trabajos distintos y se dan de alta con criterios distintos. */}
        {tab==="vendedores"&&<div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:800,fontSize:13,color:"#9333ea"}}>VENDEDORES Y ADMINISTRADORES</div>
              <div style={{color:GRL,fontSize:11,marginTop:2}}>
                {equipo.length} en el equipo · ven las tres listas de precios
                {userLoad&&<span style={{color:OR,marginLeft:8}}>cargando...</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
              <Btn onClick={()=>setModal({mode:"create",data:{lista:"VENDEDOR"}})}>+ NUEVO VENDEDOR</Btn>
            </div>
          </div>
          <BloqueUsuarios lista={equipo} acento="#9333ea"
            vacio="Todavía no hay vendedores dados de alta."/>
          <div style={{color:GRL,fontSize:11,lineHeight:1.6,marginTop:4}}>
            Los administradores se crean desde <strong style={{color:"#1a1a1a"}}>CONFIGURACIÓN</strong> y aparecen aquí porque también ven las tres listas.
          </div>
        </div>}

        {tab==="clients"&&<div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:800,fontSize:13,color:OR}}>CLIENTES</div>
              <div style={{color:GRL,fontSize:11,marginTop:2}}>
                {clientes.length} registrados · cada uno ve solo su lista asignada
                {userLoad&&<span style={{color:OR,marginLeft:8}}>cargando...</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
              <Btn onClick={()=>setModal({mode:"create",data:{}})}>+ NUEVO CLIENTE</Btn>
            </div>
          </div>
          <BloqueUsuarios lista={clientes} acento={OR}
            vacio="Todavía no hay clientes dados de alta."/>
        </div>}

        {tab==="quotes"&&<HistorialCotizaciones session={session} onReabrir={reabrirCotizacion}/>}
        {tab==="arribos"&&<ProximosArribos session={session} mob={mob}/>}

        {tab==="optimizador"&&<PanelOptimizador session={session} mob={mob}/>}

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
              <div>Equipo interno: <strong style={{color:"#1a1a1a"}}>{equipo.length}</strong></div>
              <div>Clientes: <strong style={{color:"#1a1a1a"}}>{clientes.filter(u=>u.estatus==="activo").length} activos · {clientes.filter(u=>u.estatus==="inactivo").length} inactivos</strong></div>
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
      {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} products={products} onClose={()=>setCartOpen(false)}/>}
      {CartFab}{Hdr}

      {/* En el teléfono este aviso viaja en la franja del header. */}
      {!mob&&<div style={{background:"linear-gradient(90deg,#FF5C1E,#E04A10)",padding:"9px 24px",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <span style={{color:"#fff",fontSize:13,fontWeight:700}}>CONTADO ANTICIPADO: <span style={{color:"#FFE0C0"}}>3% DE DESCUENTO ADICIONAL</span></span>
      </div>}

      <TabBar items={[["products","CATÁLOGO"],["quotes",vend?"COTIZACIONES":"MIS COTIZACIONES"],...(vend?[["arribos","PRÓXIMOS ARRIBOS"],["optimizador","OPTIMIZADOR"]]:[]),
        ...(puedeCatalogo(session)?[["subir","SUBIR CATÁLOGO"]]:[])]}/>

      <div style={{padding:mob?12:20,maxWidth:1400,margin:"0 auto"}}>
        {tab==="products"&&<>
          {!mob&&<div style={{background:"#FFF5F2",borderLeft:"3px solid "+OR,border:"1px solid #ffd9c9",borderRadius:6,padding:"9px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:OR,fontWeight:800}}>i</span>
            <span style={{color:GRL,fontSize:11}}>
              {PRECIOS_CON_IVA
                ? <>Todos los productos causan IVA. Los precios que ves <strong style={{color:"#1a1a1a"}}>ya lo incluyen</strong>, y tu cotización desglosa subtotal e IVA.</>
                : <>Los precios mostrados son <strong style={{color:"#1a1a1a"}}>antes de IVA</strong>.</>}
            </span>
          </div>}
          {vend&&!mob&&<div style={{background:"#f3e8ff",border:"1px solid #d8b4fe",borderRadius:6,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
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
            <div style={{paddingBottom:mob?96:0}}>{(()=>{
              const visibles=filtered.slice(0,(page+1)*PS);
              // El aviso viaja DENTRO de la lista, después de las primeras
              // fichas: se encuentra haciendo scroll normal y no le quita
              // el primer lugar a los productos.
              const corte=Math.min(4,visibles.length-1);
              return visibles.flatMap((p,i)=>[
                <CardProducto key={p.id||i} p={p} vend={vend} lista={lista} onAdd={()=>addToCart(p)}/>,
                ...(i===corte?[<LineaCredito key="credito" esCliente={!vend}/>]:[])
              ]);
            })()}</div>
          ):(
            <div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:10,background:"#fff",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:DK}}>
                  {["MARCA","MEDIDA","SKU","DESCRIPCIÓN"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}</th>)}
                  {vend
                    ? ["PÚBLICO","DIST.","ASOCIADO"].map(h=><th key={h} style={{padding:"10px 8px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>{h}<div style={{fontSize:8,fontWeight:400,letterSpacing:0,color:"rgba(255,255,255,.55)"}}>IVA incl.</div></th>)
                    : <th style={{padding:"10px 10px",textAlign:"right",color:"#fff",fontWeight:700,fontSize:10,letterSpacing:.8,whiteSpace:"nowrap"}}>PRECIO<div style={{fontSize:8,fontWeight:400,letterSpacing:0,color:"rgba(255,255,255,.55)"}}>IVA incl.</div></th>}
                  {/* Los almacenes van en su propia zona sombreada, con
                      borde a la izquierda: precios y existencia dejan de
                      leerse como una sola sopa de números. */}
                  {ALMS_L.map((a,i)=><th key={a} style={{padding:"10px 8px",textAlign:"center",color:"rgba(255,255,255,.85)",fontWeight:700,fontSize:10,letterSpacing:.8,background:"rgba(255,255,255,.07)",borderLeft:i===0?"2px solid rgba(255,255,255,.25)":"none"}}>{a}</th>)}
                  <th style={{padding:"10px 8px",textAlign:"center",color:"#fff",fontWeight:800,fontSize:10,letterSpacing:.8,background:"rgba(255,255,255,.07)"}}>TOTAL</th>
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
                      {esVolumen(p)?<td colSpan={3} style={{padding:"8px",textAlign:"center"}}><VolBadge/></td>:<>
                      <td style={{padding:"8px",textAlign:"right",color:OR,fontWeight:800}}>{money(p.publico)}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.distribuidor)}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{money(p.asociado)}</td></>}
                    </>:<td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,fontSize:14,color:OR,whiteSpace:"nowrap"}}>{esVolumen(p)?<VolBadge/>:money(getPrecio(p,lista))}</td>}
                    {ALMS.map((a,ai)=><td key={a} style={{padding:"8px",textAlign:"center",background:i%2?"#F4F4F4":"#FAFAFA",borderLeft:ai===0?"2px solid "+BD:"none"}}><StockPill v={p[a]} real={vend}/></td>)}
                    <td style={{padding:"8px",textAlign:"center",background:i%2?"#F4F4F4":"#FAFAFA"}}><StockPill v={tot} peso={800} real={vend}/></td>
                    <td style={{padding:"6px 8px"}}>
                      <button onClick={()=>addToCart(p)} title="Agregar a cotización"
                        style={{background:OR,color:"#fff",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>＋</button>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ))}
          {!mob&&filtered.length>0&&<div style={{marginTop:12}}><LineaCredito esCliente={!vend}/></div>}
          {filtered.length>0&&<Pager total={filtered.length} pg={page} setPg={setPage} ps={PS} mob={mob}/>}
        </>}

        {tab==="quotes"&&<HistorialCotizaciones session={session} onReabrir={reabrirCotizacion}/>}
        {tab==="arribos"&&vend&&<ProximosArribos session={session} mob={mob}/>}

        {/* vend blinda la pestaña: un cliente nunca la ve ni la abre. */}
        {tab==="optimizador"&&vend&&<PanelOptimizador session={session} mob={mob}/>}

        {tab==="subir"&&puedeCatalogo(session)&&<div>
          <div style={{marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:13,color:OR}}>SUBIR CATÁLOGO DEL DÍA</div>
            <div style={{color:GRL,fontSize:11,marginTop:2}}>
              Elige el archivo <strong style={{color:"#1a1a1a"}}>LLANTYAPP_fecha.csv</strong> que genera el programa de inventario, en la carpeta SALIDA.
            </div>
          </div>
          <BloqueCatalogo plegable={false}/>
          <div style={{color:GRL,fontSize:11,lineHeight:1.6,background:"#FFF5F2",border:"1px solid #ffd9c9",borderRadius:6,padding:"10px 13px"}}>
            Reemplaza el catálogo completo y guarda un respaldo del anterior. Si subes el archivo equivocado, vuelve a subir el correcto: no se pierde nada.
          </div>
        </div>}
      </div>
    </div>
  );
}

export default function App(){
  return <RedDeSeguridad><Portal/></RedDeSeguridad>;
}
