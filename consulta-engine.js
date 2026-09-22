// consulta-engine.js — Motor de consulta del buscador de llantas (LlantyMoto).
// Portado sin cambios de reglas desde portal/engine.js del paquete
// Integracion_LlantyApp_Buscador. Normaliza medidas, construye índices
// y ejecuta la consulta. No tiene dependencias ni toca el DOM.
//
// Registros esperados (catalog.gz): {m,n,year,fd,rd,vehicle,market,sources,...}
//   m=marca, n=modelo/versión, fd/rd=medida delantera/trasera,
//   vehicle=Moto|ATV|UTV. "Offroad" agrupa ATV y UTV en la consulta.
'use strict';

const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function parseSize(v){let s=String(v||'').toUpperCase().trim().replace(/[–—−]/g,'-').replace(/×/g,'X').replace(/,/g,'.');s=s.replace(/^(\d{2,3})\s+(\d{2,3})\s+(?=(?:ZR|R|B)?\s*\d)/,'$1/$2-').replace(/-\s*(ZR|R|B)/,'$1').replace(/\s/g,'');let m=s.match(/^(\d{2,3}(?:\.\d+)?)\/(\d{2,3}(?:\.\d+)?)(ZR|R|B|-)(\d{1,2}(?:\.\d+)?)$/),parts,kind,construction;
if(m){parts=[+m[1],+m[2],+m[4]];construction=m[3];kind='metric';if(parts[0]<40||parts[0]>450||parts[1]<20||parts[1]>150||parts[2]<4||parts[2]>36)return null}
else if(m=s.match(/^(\d{2}(?:\.\d+)?)X(\d{1,2}(?:\.\d+)?)(ZR|R|B|-|X)(\d{1,2}(?:\.\d+)?)$/)){parts=[+m[1],+m[2],+m[4]];construction=m[3]==='X'?'-':m[3];kind='flotation';if(parts[0]<=parts[2]||parts[0]>60||parts[1]<2||parts[1]>20||parts[2]<4||parts[2]>36)return null}
else if(m=s.match(/^(\d(?:\.\d{1,2})?)(R|B|-)(\d{1,2}(?:\.\d+)?)$/)){parts=[+m[1],+m[3]];construction=m[2];kind='inch';if(parts[0]<2||parts[0]>8||parts[1]<4||parts[1]>36)return null}
else if(m=s.match(/^(M[A-Z]\d{2})(R|B|-)(\d{2})$/)){parts=[m[1],+m[3]];construction=m[2];kind='alpha';if(parts[1]<4||parts[1]>36)return null}else return null;
return {kind,parts,construction,key:kind+'|'+parts.join('|'),exact:kind+'|'+parts.join('|')+'|'+construction,rim:parts.at(-1),text:s};}
const aliases={hd:'harley davidson',kawa:'kawasaki',husky:'husqvarna',ital:'italika',cf:'cfmoto'};
function tokens(q){return String(q).trim().split(/\s+/).flatMap(t=>(aliases[t.toLowerCase()]||t).split(' ')).map(norm).filter(Boolean)}
function nearWord(a,b){if(a===b)return true;if(a.length<4||Math.abs(a.length-b.length)>1)return false;for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i]){if(a.length===b.length)return a.slice(i+1)===b.slice(i+1)||(a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2));return a.length>b.length?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1)}return true}
function yearsLabel(years){const ns=[...new Set(years.filter(Number.isInteger))].sort((a,b)=>a-b);if(!ns.length)return 'Año no identificado';let chunks=[],start=ns[0],last=ns[0];for(const y of ns.slice(1)){if(y===last+1){last=y;continue}chunks.push(start===last?String(start):`${start}–${last}`);start=last=y}chunks.push(start===last?String(start):`${start}–${last}`);return chunks.join(', ')}
function create(records){const rows=records.map((d,i)=>({...d,m:({KYMCO:'Kymco','GAS GAS':'GasGas'}[d.m]||d.m),_sourceBrand:d.m,_id:i,_text:norm(d.m+' '+d.n+' '+(d.line||'')+' '+(d.year||'')),_front:parseSize(d.fd),_rear:parseSize(d.rd),_family:d.line||d.n}));const category=new Map(),dimension=new Map(),identity=new Map();for(const d of rows){for(const key of ['',d.vehicle,d.vehicle==='Moto'?'Moto':'Offroad']){if(key===d.vehicle&&category.get(key)?.at(-1)===d)continue;if(!category.has(key))category.set(key,[]);if(category.get(key).at(-1)!==d)category.get(key).push(d)}for(const ax of ['_front','_rear'])if(d[ax]){const key=d[ax].key;if(!dimension.has(key))dimension.set(key,new Set());dimension.get(key).add(d)}const key=[norm(d.m),norm(d.n),d.year||'',d.market||''].join('|');if(!identity.has(key))identity.set(key,[]);identity.get(key).push(d)}
for(const group of identity.values())if(new Set(group.map(d=>d.fd+'|'+d.rd)).size>1)for(const d of group)d._conflict=true;
for(const d of rows){const f=d._front,r=d._rear;d._unusual=!!(f&&r&&f.kind===r.kind&&['metric','flotation'].includes(f.kind)&&f.parts[f.kind==='metric'?0:1]>r.parts[r.kind==='metric'?0:1])}
const configurations=new Map();for(const d of rows){const k=norm(d.m)+'|'+norm(d.n);if(!configurations.has(k))configurations.set(k,new Set());configurations.get(k).add(d.fd+'|'+d.rd)}for(const d of rows)d._multiple=configurations.get(norm(d.m)+'|'+norm(d.n)).size>1;
function query(state){const tq=tokens(state.q),size=parseSize(state.q),isSize=state.mode==='size'||state.mode==='auto'&&(!!size||/^\s*\d[\d.,]*\s*(?:[/x×]|\s+\d)/i.test(state.q));let pool=isSize&&size?[...(dimension.get(size.key)||[])]:category.get(state.category||'')||[];pool=pool.filter(d=>(!state.category||state.category==='Offroad'&&['ATV','UTV'].includes(d.vehicle)||d.vehicle===state.category)&&(!state.brand||d.m===state.brand)&&(!state.model||d._family===state.model)&&(!state.year||(state.year==='unknown'?!d.year:String(d.year)===state.year))&&(!state.version||d.n===state.version));const exactSymbol=state.construction==='exact'||state.construction!=='dimensions'&&size&&size.construction!=='-';
const match=(d,ax)=>{const t=d[ax];if(!state.q.trim())return !!t;if(size)return !!t&&t.key===size.key&&(!exactSymbol||t.construction===size.construction);let q=String(state.q).toUpperCase().replace(/\s/g,'').replace(/×/g,'X');return !!t&&t.text.startsWith(q)};
let found=pool.filter(d=>isSize?state.axis==='both'?match(d,'_front')&&match(d,'_rear'):state.axis==='front'?match(d,'_front'):state.axis==='rear'?match(d,'_rear'):match(d,'_front')||match(d,'_rear'):tq.every(t=>d._text.includes(t)));
const groups=new Map();for(const d of found){const key=[d.m,d.n,d.vehicle,d.fd,d.rd,d.market,d.year?'known':'unknown',d._conflict?'conflict':''].join('|');if(!groups.has(key))groups.set(key,{d,records:[],years:[],frontHit:false,rearHit:false});const g=groups.get(key);g.records.push(d);g.years.push(d.year);g.frontHit||=isSize&&match(d,'_front');g.rearHit||=isSize&&match(d,'_rear')}
let result=[...groups.values()].sort((a,b)=>a.d.m.localeCompare(b.d.m)||a.d.n.localeCompare(b.d.n)||(Math.max(...b.years)-Math.max(...a.years)));return {groups:result,total:found.length,isSize,size,exactSymbol,partial:isSize&&state.q.trim()&&!size};}
return {rows,query,category,dimension};}

export { norm, parseSize, tokens, nearWord, yearsLabel, create };
export default { norm, parseSize, tokens, nearWord, yearsLabel, create };
