const SVG={
 receipt:'<path d="M6 3H18V19L15.8 20.6 13.9 19 12 20.6 10.1 19 8.2 20.6 6 19Z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="11.5" x2="15" y2="11.5"/><line x1="9" y1="15" x2="13" y2="15"/>',
 history:'<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3 4 3 9 8 9"/><polyline points="12 7.5 12 12 15.5 14"/>',
 box:'<path d="M12 3L20.5 7.5V16.5L12 21 3.5 16.5V7.5L12 3Z"/><path d="M3.5 7.5L12 12 20.5 7.5"/><line x1="12" y1="12" x2="12" y2="21"/>',
 chart:'<line x1="4" y1="20" x2="20.5" y2="20"/><rect x="5.6" y="11" width="3.2" height="9"/><rect x="10.4" y="7" width="3.2" height="13"/><rect x="15.2" y="14" width="3.2" height="6"/>',
 wallet:'<rect x="3" y="6" width="18" height="13" rx="2.4"/><path d="M3 9.5h18"/><circle cx="16.5" cy="13.5" r="1.3" fill="currentColor" stroke="none"/>',
 sliders:'<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="7" r="2.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="2.4" fill="currentColor" stroke="none"/><circle cx="13" cy="17" r="2.4" fill="currentColor" stroke="none"/>',
 cash:'<rect x="3" y="7" width="18" height="10" rx="1.5"/><circle cx="12" cy="12" r="2.6"/><line x1="6" y1="10.5" x2="6" y2="13.5"/><line x1="18" y1="10.5" x2="18" y2="13.5"/>',
 card:'<rect x="3" y="6" width="18" height="12" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="6.5" y1="14" x2="11" y2="14"/>',
 phone:'<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>',
 plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
 minus:'<line x1="5" y1="12" x2="19" y2="12"/>',
 trash:'<line x1="4" y1="7" x2="20" y2="7"/><path d="M6.6 7L7.5 19.2A1.8 1.8 0 0 0 9.3 21H14.7A1.8 1.8 0 0 0 16.5 19.2L17.4 7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
 pencil:'<path d="M4 20L4.9 16.2 15.5 5.6A1.9 1.9 0 0 1 18.4 8.5L7.8 19.1 4 20Z"/><line x1="13.6" y1="7.5" x2="16.5" y2="10.4"/>',
 boxplus:'<rect x="4" y="4" width="16" height="16" rx="2.2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
 search:'<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>',
 printer:'<path d="M7 8V3.5H17V8"/><path d="M7 17.5H5.2A2.2 2.2 0 0 1 3 15.3V11.7A2.2 2.2 0 0 1 5.2 9.5H18.8A2.2 2.2 0 0 1 21 11.7V15.3A2.2 2.2 0 0 1 18.8 17.5H17"/><path d="M7 15H17V21H7Z"/>',
 check:'<polyline points="5 12.5 10 17.5 19 6.5"/>',
 warn:'<path d="M12 4L21 19H3L12 4Z"/><line x1="12" y1="10.5" x2="12" y2="14"/><circle cx="12" cy="16.6" r="0.7" fill="currentColor" stroke="none"/>',
 bag:'<path d="M6.5 8H17.5L16.6 20A1.2 1.2 0 0 1 15.4 21H8.6A1.2 1.2 0 0 1 7.4 20L6.5 8Z"/><path d="M9 8V6.5A3 3 0 0 1 15 6.5V8"/>',
 doc:'<path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v4h4"/><line x1="9.5" y1="12" x2="15" y2="12"/><line x1="9.5" y1="15.5" x2="15" y2="15.5"/>',
 download:'<path d="M12 4v10"/><polyline points="8 11 12 15 16 11"/><path d="M5 19h14"/>',
 mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>',
 clock:'<circle cx="12" cy="12" r="8"/><polyline points="12 8 12 12 15 14"/>',
 lock:'<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
 unlock:'<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5"/>',
 x:'<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
 user:'<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>'
};
function icon(n,s=20){const sp=document.createElement('span');sp.className='ic';sp.innerHTML='<svg viewBox="0 0 24 24" width="'+s+'" height="'+s+'" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(SVG[n]||'')+'</svg>';return sp;}
function svg(n,s=18){return '<svg viewBox="0 0 24 24" width="'+s+'" height="'+s+'" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(SVG[n]||'')+'</svg>';}
let _cid=0;


const $=(s,r=document)=>r.querySelector(s);
function el(t,p={},h=[]){const n=document.createElement(t);for(const[k,v]of Object.entries(p)){if(k==='class')n.className=v;else if(k==='html')n.innerHTML=v;else if(k==='text')n.textContent=v;else if(k.startsWith('on')&&typeof v==='function')n.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)n.setAttribute(k,v);}for(const c of [].concat(h)){if(c==null||c===false)continue;n.appendChild(typeof c==='string'?document.createTextNode(c):c);}return n;}
const money=n=>'₡'+Math.round(Number(n||0)).toLocaleString('es-CR');
const sum=a=>a.reduce((x,y)=>x+y,0);
const toNum=v=>{const n=parseFloat(String(v).replace(/[^\d.-]/g,''));return isNaN(n)?0:n;};
function toast(m,k,sub){k=k||'ok';const ic=k==='err'?'warn':'check';const t=el('div',{class:'toast '+k},[el('span',{class:'ti'},icon(ic,20)),el('div',{style:'min-width:0'},[el('div',{class:'tt2',text:m}),sub?el('div',{class:'ts',text:sub}):null])]);$('#toasts').appendChild(t);const close=()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),320);};t.addEventListener('click',close);setTimeout(close,2800);return t;}
function fmtF(d){d=new Date(d);return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getFullYear()).slice(2);}
function fmtFH(d){d=new Date(d);return fmtF(d)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function fmtVence(v){if(!v)return '—';const d=new Date(v+'T00:00:00');return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getFullYear()).slice(2);}
function sparkline(data){const w=110,h=30,mx=Math.max(...data),mn=Math.min(...data),rg=(mx-mn)||1;const pts=data.map((v,i)=>[(i/(data.length-1))*w,h-((v-mn)/rg)*(h-5)-3]);const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');const area='M0 '+h+' '+pts.map(p=>'L'+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')+' L'+w+' '+h+' Z';const lp=pts[pts.length-1];return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" preserveAspectRatio="none"><path d="'+area+'" fill="rgba(31,148,104,0.12)"/><path d="'+line+'" fill="none" stroke="#1f9468" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="'+lp[0].toFixed(1)+'" cy="'+lp[1].toFixed(1)+'" r="2.4" fill="#1f9468"/></svg>';}
function areaChart(data,labels){var w=620,h=176,pl=10,pr=10,pt=16,pb=24,iw=w-pl-pr,ih=h-pt-pb;var mx=Math.max.apply(null,data),mn=Math.min.apply(null,data),sp=(mx-mn)||1,lo=mn-sp*0.18,hi=mx+sp*0.18,rg=hi-lo;var X=function(i){return pl+(i/(Math.max(1,data.length-1)))*iw;},Y=function(v){return pt+ih-((v-lo)/rg)*ih;};var P=data.map(function(v,i){return [X(i),Y(v)];});var d='M'+P[0][0].toFixed(1)+' '+P[0][1].toFixed(1);for(var i=0;i<P.length-1;i++){var p0=P[i-1]||P[i],p1=P[i],p2=P[i+1],p3=P[i+2]||p2;var c1x=p1[0]+(p2[0]-p0[0])/6,c1y=p1[1]+(p2[1]-p0[1])/6,c2x=p2[0]-(p3[0]-p1[0])/6,c2y=p2[1]-(p3[1]-p1[1])/6;d+='C'+c1x.toFixed(1)+' '+c1y.toFixed(1)+' '+c2x.toFixed(1)+' '+c2y.toFixed(1)+' '+p2[0].toFixed(1)+' '+p2[1].toFixed(1);}var base=(pt+ih).toFixed(1);var area=d+'L'+P[P.length-1][0].toFixed(1)+' '+base+'L'+P[0][0].toFixed(1)+' '+base+'Z';var grid='';for(var k=0;k<=3;k++){var gy=(pt+ih*(k/3)).toFixed(1);grid+='<line x1="'+pl+'" y1="'+gy+'" x2="'+(w-pr)+'" y2="'+gy+'" stroke="rgba(17,22,39,.07)" stroke-width="1"/>';}var xl='';labels.forEach(function(lb,i){if(i%2===0||i===labels.length-1){xl+='<text x="'+X(i).toFixed(1)+'" y="'+(h-7)+'" text-anchor="middle" style="font:9.5px Inter,sans-serif" fill="#949bab">'+lb+'</text>';}});var L=P[P.length-1],uid='ac'+(++_cid);return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="'+uid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f9468" stop-opacity="0.22"/><stop offset="1" stop-color="#1f9468" stop-opacity="0"/></linearGradient></defs>'+grid+'<path d="'+area+'" fill="url(#'+uid+')"/><path d="'+d+'" fill="none" stroke="#1f9468" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+L[0].toFixed(1)+'" cy="'+L[1].toFixed(1)+'" r="7" fill="#1f9468" opacity="0.16"/><circle cx="'+L[0].toFixed(1)+'" cy="'+L[1].toFixed(1)+'" r="3.4" fill="#1f9468"/><circle cx="'+L[0].toFixed(1)+'" cy="'+L[1].toFixed(1)+'" r="1.4" fill="#fff"/>'+xl+'</svg>';}

/* ============ persistencia: SQLite vía window.BESALU.datos ============
   Cada acción guarda SOLO lo que cambió, en segundo plano (no congela la caja). */
let DB=null;
const HAY_BD=!!(window.BESALU&&window.BESALU.datos);
function persistir(promesa){if(promesa&&promesa.catch)promesa.catch(e=>{console.error(e);toast('No se pudo guardar','err',String((e&&e.message)||e));});}
const bd={
  producto:p=>{if(HAY_BD)persistir(BESALU.datos.guardarProducto(p));},
  borrarProducto:cod=>{if(HAY_BD)persistir(BESALU.datos.borrarProducto(cod));},
  venta:(v,prods)=>{if(HAY_BD)persistir(BESALU.datos.registrarVenta(v,prods,DB.seq));},
  anulacion:(folio,prods)=>{if(HAY_BD)persistir(BESALU.datos.registrarAnulacion(folio,prods));},
  config:(clave,valor)=>{if(HAY_BD)persistir(BESALU.datos.guardarConfig(clave,valor));}
};
// Ajustes: se guardan 300 ms después de dejar de escribir (no en cada tecla).
let _tAjustes=null;
function guardarAjustes(){clearTimeout(_tAjustes);_tAjustes=setTimeout(()=>bd.config('ajustes',DB.settings),300);}
function productosDe(items){return items.map(it=>DB.products.find(x=>x.cod===it.cod)).filter(Boolean);}
function ivaBase(precio,iva){const b=precio/(1+iva/100);return {base:b,imp:precio-b};}
function mkSale(items,metodo,folio,ts,pago,sed,cli){
  let total=0,base=0,imp=0;const byRate={};
  items.forEach(it=>{const line=it.precio*it.cant;total+=line;const r=ivaBase(it.precio,it.iva);const lb=r.base*it.cant,li=r.imp*it.cant;base+=lb;imp+=li;byRate[it.iva]=byRate[it.iva]||{base:0,imp:0,total:0};byRate[it.iva].base+=lb;byRate[it.iva].imp+=li;byRate[it.iva].total+=line;});
  const su=(sed&&sed.sucursal)||'001',te=(sed&&sed.terminal)||'00001';
  const cons=su+te+'01'+String(folio).padStart(10,'0');
  return {folio,cons,ts,items,metodo,total,base,imp,byRate,pago:pago||total,cambio:Math.max(0,(pago||total)-total),anulada:false,cliente:cli||null};
}
const AJUSTES_BASE={negocio:'Besalú Mercat',cedula:'',sucursal:'001',terminal:'00001',moneda:'₡ colones',ivaIncl:true,ivaDefault:13,stockMin:5,venceDias:15,correoDuena:'',cierreDiario:true,horaCierre:'22:00',cierreMensual:true,impresora:'Predeterminada de Windows',ticket:'80 mm',imprimirAlCobrar:true,pieTicket:'¡Gracias por su compra!'};
// Base vacía para producción: sin productos ni ventas de ejemplo.
function seed(){return {products:[],sales:[],seq:{folio:1042},archivo:[],shift:{open:false},settings:Object.assign({},AJUSTES_BASE)};}

const state={vista:'caja',cart:[],metodo:'efectivo',cliente:null};
const METODOS={efectivo:'cash',tarjeta:'card',sinpe:'phone'};
const METLBL={efectivo:'Efectivo',tarjeta:'Tarjeta',sinpe:'SINPE'};

async function iniciar(){
  let d=null;
  if(HAY_BD){try{d=await BESALU.datos.cargar();}catch(e){toast('No se pudo abrir la base de datos','err',String((e&&e.message)||e));}}
  if(d&&d.settings){
    DB={products:d.products||[],sales:d.sales||[],archivo:d.archivo||[],seq:d.seq||{folio:1042},shift:d.shift||{open:false},settings:Object.assign({},AJUSTES_BASE,d.settings)};
  }else{ // primera vez: base vacía
    DB=seed();bd.config('ajustes',DB.settings);bd.config('turno',DB.shift);bd.config('consecutivo',DB.seq);bd.config('cierres',DB.archivo);
  }
  $('#app').hidden=false;buildNav();updShiftPill();go('caja');tick();
  setInterval(tick,15000); // el reloj muestra minutos: no hace falta cada segundo
}
const NAV=[{v:'caja',ic:'receipt',t:'Caja'},{v:'ventas',ic:'history',t:'Ventas'},{v:'inventario',ic:'box',t:'Inventario'},{v:'reportes',ic:'chart',t:'Reportes'},{v:'cierre',ic:'wallet',t:'Cierre'},{v:'ajustes',ic:'sliders',t:'Ajustes'}];
const TIT={caja:'Caja',ventas:'Ventas',inventario:'Inventario',reportes:'Reportes',cierre:'Cierre de caja',ajustes:'Ajustes'};
function buildNav(){const nav=$('#nav');nav.innerHTML='';NAV.forEach(n=>{const b=el('button',{class:'nav-btn',onclick:()=>go(n.v)},[icon(n.ic,19),el('span',{class:'t',text:n.t})]);b.dataset.v=n.v;if(n.v==='inventario'){const l=lowStock().length+porVencer().length;if(l)b.appendChild(el('span',{class:'badge',text:String(l)}));}nav.appendChild(b);});}
function go(v){state.vista=v;$('#titulo').textContent=TIT[v];document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.v===v));document.querySelectorAll('.vista').forEach(s=>s.classList.remove('activa'));$('#v-'+v).classList.add('activa');({caja:renderCaja,ventas:renderVentas,inventario:renderInventario,reportes:renderReportes,cierre:renderCierre,ajustes:renderAjustes}[v])();}
document.addEventListener('keydown',e=>{
  if($('#app').hidden)return;
  if($('.modal-bg')){if(e.key==='Escape')cerrarModal();return;}
  const map={F1:'caja',F2:'ventas',F3:'inventario',F4:'reportes',F5:'cierre',F6:'ajustes'};
  if(map[e.key]){e.preventDefault();go(map[e.key]);return;}
  if(state.vista==='caja'){
    if(state.done){if(e.key==='F12'||e.key==='Escape'){e.preventDefault();nuevaVenta();}}
    else if(e.key==='F12'){e.preventDefault();cobrar();}
    else if(e.key==='Escape'){e.preventDefault();if(state.cart.length){state.cart=[];paintCart();toast('Venta cancelada');}}
  }
});
function tick(){const d=new Date();const r=$('#reloj');if(r)r.innerHTML=svg('clock',15)+'<b>'+d.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})+'</b><span class="fecha" style="color:var(--ink-3)"> · '+d.toLocaleDateString('es',{weekday:'short',day:'numeric',month:'short'})+'</span>';}

function updShiftPill(){const p=$('#shiftpill');if(!p)return;if(DB.shift.open){p.className='shiftpill open';p.innerHTML='<span class="dot"></span>Caja abierta';}else{p.className='shiftpill closed';p.innerHTML='<span class="dot"></span>Caja cerrada';}}
function toggleCaja(){if(DB.shift.open)go('cierre');else modalAbrir();}
function modalAbrir(){
  const iF=el('input',{inputmode:'numeric',value:'50000',style:'text-align:right;font-size:18px;font-weight:700'});
  const m=el('div',{class:'modal narrow'},[el('h2',{text:'Abrir caja'}),el('div',{class:'mini',style:'margin-bottom:14px',text:'Fondo inicial en efectivo con el que arranca el turno.'}),
    el('div',{class:'campo'},[el('label',{text:'Fondo de caja'}),iF]),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--pos',onclick:()=>{DB.shift={open:true,openedAt:Date.now(),fondo:toNum(iF.value)};bd.config('turno',DB.shift);updShiftPill();cerrarModal();toast('Caja abierta');go('caja');}},'Abrir caja')])]);
  abrirModal(m);
}

function lowStock(){return DB.products.filter(p=>p.stock<(DB.settings.stockMin||5));}
function diasVence(p){if(!p.vence)return null;const h=new Date();h.setHours(0,0,0,0);return Math.ceil((new Date(p.vence+'T00:00:00')-h)/86400000);}
function porVencer(){const lim=DB.settings.venceDias||15;return DB.products.filter(p=>{const d=diasVence(p);return d!==null&&d<=lim&&p.stock>0;}).sort((a,b)=>diasVence(a)-diasVence(b));}
function valorInv(){return{v:sum(DB.products.map(p=>p.stock*p.costo)),u:sum(DB.products.map(p=>p.stock))};}
const dayStart=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x.getTime();};
function validSales(){return DB.sales.filter(s=>!s.anulada);}
function agg(sales){const r={total:0,count:sales.length,ef:0,ta:0,si:0,base:0,imp:0,byRate:{}};sales.forEach(s=>{r.total+=s.total;r.base+=s.base;r.imp+=s.imp;if(s.metodo==='efectivo')r.ef+=s.total;else if(s.metodo==='tarjeta')r.ta+=s.total;else r.si+=s.total;for(const k in s.byRate){r.byRate[k]=r.byRate[k]||{base:0,imp:0,total:0};r.byRate[k].base+=s.byRate[k].base;r.byRate[k].imp+=s.byRate[k].imp;r.byRate[k].total+=s.byRate[k].total;}});return r;}
function animNum(node,target,pfx){pfx=pfx||'';try{if(matchMedia('(prefers-reduced-motion:reduce)').matches){node.textContent=pfx+Math.round(target).toLocaleString('es-CR');return;}}catch(e){}var t0=performance.now(),dur=780;function f(t){var p=Math.min(1,(t-t0)/dur);p=1-Math.pow(1-p,3);node.textContent=pfx+Math.round(target*p).toLocaleString('es-CR');if(p<1)requestAnimationFrame(f);}requestAnimationFrame(f);}
function stat(k,v,extra){var vEl=el('div',{class:'v'});if(/^\u20a1[\d.,]+$/.test(v)){animNum(vEl,parseInt(v.replace(/[^\d]/g,''),10)||0,'\u20a1');}else vEl.textContent=v;return el('div',{class:'stat glass'},[el('div',{class:'k'},k),vEl,extra||null]);}
function delta(dir,txt){return el('span',{class:'delta '+dir,html:(dir==='up'?'▲':'▼')+' '+txt});}

function renderCaja(){
  const root=$('#v-caja');root.innerHTML='';
  if(!DB.shift.open){root.appendChild(el('div',{class:'cerrada-aviso glass'},[icon('lock',30),el('h2',{text:'La caja está cerrada',style:'margin:6px 0 4px'}),el('div',{class:'mini',style:'margin-bottom:14px',text:'Abrí la caja con el fondo inicial para empezar a vender.'}),el('button',{class:'btn btn--pos btn--lg',onclick:modalAbrir},[icon('unlock',18),'Abrir caja'])]));return;}
  const inp=el('input',{id:'cod',placeholder:'Escaneá o escribí el código / nombre…',autocomplete:'off'});
  const rap=el('div',{class:'rapidos'});DB.products.slice(0,6).forEach(p=>rap.appendChild(el('button',{class:'rapido',onclick:()=>add(p)},p.nom.split(' ').slice(0,2).join(' '))));
  const tb=el('tbody',{id:'cart-body'});
  const tabla=el('div',{class:'card pad0 glass cart'},[el('table',{},[el('thead',{},el('tr',{},[el('th',{text:'Producto'}),el('th',{text:'Precio',class:'der'}),el('th',{text:'Cant'}),el('th',{text:'Subtotal',class:'der'}),el('th',{})])),tb])]);
  const atajos=el('div',{class:'atajos'},[el('span',{html:'<kbd>Enter</kbd> agregar'}),el('span',{html:'<kbd>Enter</kbd> en vacío · cobrar'}),el('span',{html:'<kbd>F12</kbd> cobrar'}),el('span',{html:'<kbd>Esc</kbd> cancelar'})]);
  const cobro=el('div',{class:'cobro',id:'cobro'});
  root.appendChild(el('div',{class:'caja'},[el('div',{},[el('div',{class:'escaner'},[el('div',{class:'search'},[icon('search',19),inp]),el('button',{class:'btn btn--accent',onclick:()=>addCod(inp.value)},[icon('plus',18),'Agregar'])]),rap,tabla,atajos]),cobro]));
  inp.addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();if(inp.value.trim())addCod(inp.value);else if(state.cart.length&&$('#inp-paga'))$('#inp-paga').focus();else if(state.cart.length)cobrar();});
  setTimeout(()=>inp.focus(),30);paintCart();
}
function add(p){if(p.stock<=0){toast('Sin stock: '+p.nom,'err');return;}const e=state.cart.find(i=>i.cod===p.cod);const enC=e?e.cant:0;if(enC+1>p.stock){toast('Solo hay '+p.stock+' de '+p.nom,'err');return;}if(e)e.cant++;else state.cart.push({cod:p.cod,nom:p.nom,precio:p.precio,iva:p.iva,cant:1});state.done=null;paintCart();}
function addCod(v){v=(v||'').trim();if(!v)return;const p=DB.products.find(x=>x.cod===v)||DB.products.find(x=>x.nom.toLowerCase().includes(v.toLowerCase()));if($('#cod'))$('#cod').value='';if(p)add(p);else toast('Código no encontrado','err');}
function cartTotal(){return state.cart.reduce((s,i)=>s+i.precio*i.cant,0);}
function paintCart(){const tb=$('#cart-body');if(!tb)return;tb.innerHTML='';if(!state.cart.length)tb.appendChild(el('tr',{},el('td',{colspan:5},el('div',{class:'cart-empty'},[icon('bag',40),el('div',{text:'Escaneá el primer producto'})]))));else state.cart.forEach((it,i)=>tb.appendChild(el('tr',{},[el('td',{},[el('div',{style:'font-weight:600',text:it.nom}),el('div',{class:'mini',text:it.cod})]),el('td',{class:'der',text:money(it.precio)}),el('td',{},el('div',{class:'cant'},[el('button',{onclick:()=>chg(i,-1)},icon('minus',15)),el('span',{class:'n',text:String(it.cant)}),el('button',{onclick:()=>chg(i,1)},icon('plus',15))])),el('td',{class:'der',text:money(it.precio*it.cant)}),el('td',{class:'der'},el('button',{class:'icon-btn icon-btn--danger',onclick:()=>{state.cart.splice(i,1);paintCart();}},icon('trash',17)))])));paintCobro();}
function chg(i,d){const it=state.cart[i];const p=DB.products.find(x=>x.cod===it.cod);if(d>0&&p&&it.cant+1>p.stock){toast('Solo hay '+p.stock,'err');return;}it.cant+=d;if(it.cant<=0)state.cart.splice(i,1);paintCart();}
function paintCobro(){
  const p=$('#cobro');if(!p)return;p.innerHTML='';
  if(state.done){const v=state.done;const etq=v.metodo==='efectivo'?(v.cambio>0?'Cambio a entregar':'Pago exacto'):'Cobrado · '+METLBL[v.metodo];
    p.appendChild(el('div',{class:'card glass',style:'text-align:center'},[el('div',{style:'width:52px;height:52px;border-radius:50%;background:var(--pos-soft);color:var(--pos);display:grid;place-items:center;margin:2px auto 12px'},icon('check',26)),el('div',{class:'mini',text:'Venta #'+v.folio+' registrada'}),el('div',{style:'font-size:12px;color:var(--ink-2);margin-top:8px',text:etq}),el('div',{style:'font-size:34px;font-weight:800;letter-spacing:-.03em;color:var(--pos);margin:2px 0 10px',text:v.metodo==='efectivo'?(v.cambio>0?money(v.cambio):'—'):money(v.total)}),el('span',{class:'pill pill--green',style:'margin-bottom:12px;display:inline-flex;gap:6px;align-items:center'},[svgWrap('check'),(v.cliente?'Factura guardada':'Venta guardada')]),el('div',{style:'display:flex;gap:8px;margin-top:4px'},[el('button',{class:'btn btn--ghost btn--block',onclick:()=>modalTicket(v)},[icon('receipt',17),'Ver recibo']),el('button',{class:'btn btn--accent btn--block',onclick:nuevaVenta},'Nueva venta')])]));return;}
  const t=cartTotal();
  const metodos=el('div',{class:'metodos'},Object.keys(METODOS).map(k=>el('button',{class:state.metodo===k?'sel':'',onclick:()=>{state.metodo=k;paintCobro();}},[icon(METODOS[k],19),METLBL[k]])));
  const cliBar=el('button',{class:'cli-bar',onclick:modalCliente},[el('span',{style:'display:flex;align-items:center;gap:8px;min-width:0'},[icon('user',16),el('span',{class:'cli-nm',text:state.cliente?state.cliente.nombre:'Consumidor final'})]),el('span',{class:'mini',text:state.cliente?'Cambiar':'Agregar cliente'})]);
  const box=el('div',{class:'card glass',style:'display:flex;flex-direction:column;gap:13px'},[el('div',{class:'total-box'},[el('div',{class:'k',text:'Total a pagar'}),el('div',{class:'v',text:money(t)}),el('div',{class:'n',text:state.cart.reduce((s,i)=>s+i.cant,0)+' artículo(s)'})]),cliBar,metodos]);
  if(state.metodo==='efectivo'){
    const paga=el('input',{id:'inp-paga',inputmode:'numeric',placeholder:'0',style:'text-align:right;font-size:20px;font-weight:800;padding:12px 14px'});
    const hint=el('div',{class:'paga-hint'});
    paga.addEventListener('input',()=>{const x=toNum(paga.value);if(!paga.value)hint.textContent='';else if(x<t){hint.textContent='Faltan '+money(t-x);hint.className='paga-hint falta';}else{hint.textContent='Cambio '+money(x-t);hint.className='paga-hint';}});
    paga.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();cobrar();}});
    box.appendChild(el('div',{},[el('label',{for:'inp-paga',text:'Efectivo recibido'}),paga,hint]));
  }
  const b=el('button',{class:'btn btn--pos btn--lg btn--block',onclick:cobrar},'Cobrar · F12');b.disabled=!state.cart.length;
  box.appendChild(b);
  box.appendChild(el('button',{class:'btn btn--danger-ghost btn--block',onclick:()=>{if(state.cart.length){state.cart=[];paintCart();toast('Venta cancelada');}}},'Cancelar · Esc'));
  p.appendChild(box);
}
function svgWrap(n){const s=el('span',{class:'ic'});s.innerHTML=svg(n,14);return s;}
function cobrar(){
  if(!state.cart.length||state.done)return;
  if(!DB.shift.open){toast('Abrí la caja primero','err');return;}
  const t=cartTotal();let pago=t;
  if(state.metodo==='efectivo'){pago=toNum($('#inp-paga')?$('#inp-paga').value:'')||0;if(pago<t){const h=$('.paga-hint');if(h){h.textContent='El efectivo recibido es menor al total';h.className='paga-hint falta';}return;}}
  const folio=++DB.seq.folio;
  const sale=mkSale(state.cart.map(i=>({cod:i.cod,nom:i.nom,precio:i.precio,iva:i.iva,cant:i.cant})),state.metodo,folio,Date.now(),pago,DB.settings,state.cliente);
  state.cart.forEach(it=>{const p=DB.products.find(x=>x.cod===it.cod);if(p)p.stock=Math.max(0,p.stock-it.cant);});
  DB.sales.push(sale);bd.venta(sale,productosDe(sale.items));
  state.done=sale;state.cart=[];state.cliente=null;buildNav();paintCart();
  toast((sale.cliente?'Factura':'Venta')+' #'+folio+' registrada','ok',sale.cliente?('Cliente: '+sale.cliente.nombre):'Guardada en la base de datos');
  if(DB.settings.imprimirAlCobrar)imprimirTicket(sale,true);
}
function nuevaVenta(){state.done=null;state.metodo='efectivo';paintCart();if($('#cod'))$('#cod').focus();}

function armarTicket(v){
  const s=DB.settings;
  const rows=v.items.map(it=>el('div',{class:'it'},[el('span',{class:'nm',text:it.cant+'× '+it.nom}),el('span',{text:money(it.precio*it.cant)})]));
  const ivaRows=Object.keys(v.byRate).sort().map(r=>{const d=v.byRate[r];return el('div',{class:'row small'},[el('span',{text:'IVA '+r+'% (base '+money(d.base)+')'}),el('span',{text:money(d.imp)})]);});
  const ticket=el('div',{class:'ticket'},[
    el('div',{class:'tc'},[el('div',{class:'th',text:s.negocio}),el('div',{class:'small',text:'Minimarket Gourmet'}),s.cedula?el('div',{class:'small',text:'Céd. jurídica '+s.cedula}):null]),
    el('hr'),
    el('div',{class:'row small'},[el('span',{text:v.cliente?'Factura':'Tiquete'}),el('span',{text:'#'+v.folio})]),
    el('div',{class:'row small'},[el('span',{text:'Fecha'}),el('span',{text:fmtFH(v.ts)})]),
    el('div',{class:'small',style:'margin:2px 0',text:'Comprobante Nº '+v.cons}),
    el('div',{class:'row small'},[el('span',{text:'Cliente'}),el('span',{text:v.cliente?v.cliente.nombre:'Consumidor final'})]),
    (v.cliente&&v.cliente.cedula)?el('div',{class:'small',text:'Céd. '+v.cliente.cedula}):null,
    el('hr'),el('div',{},rows),el('hr'),
    el('div',{class:'row'},[el('span',{text:'Subtotal (sin IVA)'}),el('span',{text:money(v.base)})]),
    el('div',{},ivaRows),
    el('div',{class:'row b'},[el('span',{text:'TOTAL'}),el('span',{text:money(v.total)})]),
    el('div',{class:'row small'},[el('span',{text:'Pago'}),el('span',{text:METLBL[v.metodo]+(v.metodo==='efectivo'?' '+money(v.pago):'')})]),
    v.metodo==='efectivo'?el('div',{class:'row small'},[el('span',{text:'Cambio'}),el('span',{text:money(v.cambio)})]):null,
    el('hr'),el('div',{class:'tc small',text:s.pieTicket}),
    el('div',{class:'tc small',style:'margin-top:4px;opacity:.7',text:v.anulada?'— ANULADA —':'Comprobante interno · sin valor fiscal'})
  ]);
  return ticket;
}
// Imprime solo el ticket (ver @media print en estilos.css). En la app de escritorio
// va directo a la impresora predeterminada de Windows, sin diálogo.
async function imprimirTicket(v,automatico){
  const zona=$('#zona-impresion');zona.innerHTML='';zona.className=DB.settings.ticket==='58 mm'?'t58':'';zona.appendChild(armarTicket(v));
  try{
    if(window.BESALU&&BESALU.imprimir){const r=await BESALU.imprimir();
      if(r&&r.ok)toast('Ticket impreso','ok','#'+v.folio);
      else if(!automatico||r)toast('No se pudo imprimir','err',(r&&r.motivo)||'Revisá que haya una impresora predeterminada');}
    else window.print();
  }catch(e){toast('No se pudo imprimir','err',String((e&&e.message)||e));}
}
function modalTicket(v){
  const m=el('div',{class:'modal',style:'width:min(400px,100%)'},[el('div',{class:'card-t'},[el('h2',{text:'Recibo'}),el('button',{class:'icon-btn',onclick:cerrarModal},icon('x',18))]),
    el('div',{style:'display:grid;place-items:center'},armarTicket(v)),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cerrar'),el('button',{class:'btn btn--accent',onclick:()=>imprimirTicket(v,false)},[icon('printer',17),'Imprimir'])])]);
  abrirModal(m);
}

function renderVentas(){
  const root=$('#v-ventas');root.innerHTML='';
  const hoy=dayStart(Date.now());
  const sales=[...DB.sales].sort((a,b)=>b.ts-a.ts);
  const a=agg(validSales().filter(s=>s.ts>=hoy));
  const st=el('div',{class:'stats'});
  st.append(stat([icon('receipt',15),'Ventas de hoy'],money(a.total),el('div',{class:'foot'},el('span',{class:'mini',text:a.count+' tiquetes'}))),stat([icon('cash',15),'Efectivo hoy'],money(a.ef),null),stat([icon('card',15),'Tarjeta + SINPE hoy'],money(a.ta+a.si),null));
  root.appendChild(st);
  const tb=el('tbody');
  sales.slice(0,150).forEach(s=>{tb.appendChild(el('tr',{style:s.anulada?'opacity:.5':''},[
    el('td',{},[el('div',{style:'font-weight:600',text:'#'+s.folio}),el('div',{class:'mini',text:fmtFH(s.ts)})]),
    el('td',{},el('span',{class:'pill '+(s.metodo==='efectivo'?'pill--green':s.metodo==='tarjeta'?'pill--accent':''),text:METLBL[s.metodo]})),
    el('td',{class:'mini',text:s.cliente?s.cliente.nombre:'Consumidor final'}),
    el('td',{class:'mini',text:s.items.reduce((x,i)=>x+i.cant,0)+' art.'}),
    el('td',{class:'der',style:'font-weight:700',text:money(s.total)}),
    el('td',{class:'der'},[el('button',{class:'icon-btn',title:'Ver recibo',onclick:()=>modalTicket(s)},icon('receipt',17)),s.anulada?el('span',{class:'pill pill--red',text:'Anulada'}):el('button',{class:'icon-btn icon-btn--danger',title:'Anular',onclick:()=>modalAnular(s)},icon('x',17))])
  ]));});
  root.appendChild(el('div',{class:'card pad0 glass'},[el('div',{class:'tabla-wrap'},[el('table',{},[el('thead',{},el('tr',{},[el('th',{text:'Tiquete'}),el('th',{text:'Pago'}),el('th',{text:'Cliente'}),el('th',{text:'Art.'}),el('th',{text:'Total',class:'der'}),el('th',{text:'',class:'der'})])),tb])])]));
}
function modalAnular(s){
  const m=el('div',{class:'modal narrow'},[el('h2',{text:'Anular tiquete #'+s.folio}),el('div',{style:'color:var(--ink-2)',text:'Se marca como anulada y el stock de sus productos vuelve al inventario. (En producción se emitiría una nota de crédito.)'}),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--danger-ghost',onclick:()=>{s.anulada=true;s.items.forEach(it=>{const p=DB.products.find(x=>x.cod===it.cod);if(p)p.stock+=it.cant;});bd.anulacion(s.folio,productosDe(s.items));buildNav();cerrarModal();renderVentas();toast('Tiquete #'+s.folio+' anulado');}},'Anular tiquete')])]);
  abrirModal(m);
}

function renderInventario(){
  const root=$('#v-inventario');root.innerHTML='';
  const bajos=lowStock();
  if(bajos.length)root.appendChild(el('div',{class:'alert red glass'},[icon('warn',16),el('div',{},[el('span',{class:'t',text:bajos.length+' con inventario bajo'}),el('div',{class:'lista'},bajos.slice(0,10).map(p=>el('span',{class:'it',html:p.nom+' · <b>'+p.stock+'</b>'})))])]));
  const pv=porVencer();
  if(pv.length)root.appendChild(el('div',{class:'alert amber glass'},[icon('clock',16),el('div',{},[el('span',{class:'t',text:pv.length+' por vencer o vencidos'}),el('div',{class:'lista'},pv.slice(0,10).map(p=>{const d=diasVence(p);return el('span',{class:'it',html:p.nom+' · <b>'+(d<0?'vencido':d+' d')+'</b>'});}))])]));
  const vi=valorInv();
  root.appendChild(el('div',{class:'card glass'},[
    el('div',{class:'valor-inv'},[el('span',{class:'k',text:'Valor del inventario (al costo)'}),el('span',{class:'v',text:money(vi.v)}),el('span',{class:'u',text:vi.u+' unidades · '+DB.products.length+' productos'})]),
    el('div',{class:'toolbar'},[
      el('div',{class:'search',style:'max-width:300px;flex:1'},[icon('search',18),el('input',{placeholder:'Buscar producto o código…',style:'padding-left:40px',oninput:e=>window.__f(e.target.value)})]),
      el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'},[el('button',{class:'btn btn--accent',onclick:()=>modalProducto()},[icon('plus',18),'Agregar producto']),el('button',{class:'btn btn--ghost btn--sm',onclick:exportInv},[icon('download',16),'CSV'])])]),
    el('div',{class:'tabla-wrap'},[el('table',{},[el('thead',{},el('tr',{},[el('th',{text:'Producto'}),el('th',{text:'IVA',class:'der'}),el('th',{text:'Costo',class:'der'}),el('th',{text:'Precio',class:'der'}),el('th',{text:'Margen',class:'der'}),el('th',{text:'Vence',class:'der'}),el('th',{text:'Stock',class:'der'}),el('th',{text:'',class:'der'})])),el('tbody',{id:'inv-body'})])])
  ]));
  const tb=$('#inv-body');window.__f=q=>fillInv(tb,q);fillInv(tb,'');
}
function fillInv(tb,q){tb.innerHTML='';DB.products.filter(p=>!q||p.nom.toLowerCase().includes(q.toLowerCase())||p.cod.includes(q)).forEach(p=>{
  const m=p.costo>0?Math.round((p.precio-p.costo)/p.costo*100):0;const d=diasVence(p);
  let vc;if(d===null)vc=el('span',{class:'mini',text:'—'});else if(d<0)vc=el('span',{class:'pill pill--red',text:'Vencido'});else if(d<=(DB.settings.venceDias||15))vc=el('span',{class:'pill pill--amber',text:d+' d'});else vc=el('span',{class:'mini',text:fmtVence(p.vence)});
  tb.appendChild(el('tr',{},[
    el('td',{},[el('div',{style:'font-weight:600',text:p.nom}),el('div',{class:'mini',text:p.cod})]),
    el('td',{class:'der'},el('span',{class:'pill '+(p.iva===1?'pill--accent':''),text:p.iva+'%'})),
    el('td',{class:'der',text:money(p.costo)}),el('td',{class:'der',text:money(p.precio)}),
    el('td',{class:'der',style:'font-weight:700;color:'+(m>0?'var(--pos)':'var(--neg)'),text:(m>0?'+':'')+m+'%'}),
    el('td',{class:'der'},vc),
    el('td',{class:'der'},el('span',{class:'pill '+(p.stock<(DB.settings.stockMin||5)?'pill--red':''),text:String(p.stock)})),
    el('td',{class:'der'},[el('button',{class:'icon-btn',title:'Reabastecer',onclick:()=>modalEntrada(p)},icon('boxplus',18)),el('button',{class:'icon-btn',title:'Editar',onclick:()=>modalProducto(p)},icon('pencil',18)),el('button',{class:'icon-btn icon-btn--danger',title:'Eliminar',onclick:()=>modalEliminar(p)},icon('trash',18))])
  ]));
});}

function renderReportes(){
  const root=$('#v-reportes');root.innerHTML='';
  const now=Date.now();const dias=[],labels=[],serie=[];
  for(let i=13;i>=0;i--){const ds=dayStart(now-i*86400000);dias.push(ds);labels.push(String(new Date(ds).getDate()).padStart(2,'0'));}
  const vs=validSales();
  dias.forEach(ds=>{const de=ds+86400000;serie.push(sum(vs.filter(s=>s.ts>=ds&&s.ts<de).map(s=>s.total)));});
  const mes0=new Date();mes0.setDate(1);mes0.setHours(0,0,0,0);
  const mes=agg(vs.filter(s=>s.ts>=mes0.getTime()));
  const hoyA=agg(vs.filter(s=>s.ts>=dayStart(now)));
  const ayerA=agg(vs.filter(s=>s.ts>=dayStart(now-86400000)&&s.ts<dayStart(now)));
  const tk=mes.count?mes.total/mes.count:0;
  const dHoy=ayerA.total?Math.round((hoyA.total-ayerA.total)/ayerA.total*100):0;
  const st=el('div',{class:'stats'});
  st.append(
    stat([icon('chart',15),'Ventas del mes'],money(mes.total),el('div',{class:'foot'},[el('span',{html:sparkline(serie)}),el('span',{class:'mini',text:mes.count+' tiquetes'})])),
    stat([icon('receipt',15),'Ticket promedio'],money(tk),null),
    stat([icon('cash',15),'Ventas hoy'],money(hoyA.total),el('div',{class:'foot'},[dHoy>=0?delta('up',dHoy+'%'):delta('down',Math.abs(dHoy)+'%'),el('span',{class:'mini',text:'vs. ayer'})]))
  );
  root.appendChild(st);
  const grid=el('div',{class:'grid2'});
  grid.appendChild(el('div',{class:'card glass'},[el('div',{class:'card-t'},[el('h2',{text:'Ventas por día (14 días)'}),el('button',{class:'btn btn--ghost btn--sm',onclick:exportVentas},[icon('download',16),'CSV'])]),el('div',{html:areaChart(serie,labels)})]));
  const cnt={};vs.filter(s=>s.ts>=mes0.getTime()).forEach(s=>s.items.forEach(it=>{cnt[it.nom]=cnt[it.nom]||{q:0,ing:0};cnt[it.nom].q+=it.cant;cnt[it.nom].ing+=it.precio*it.cant;}));
  const top=Object.entries(cnt).sort((a,b)=>b[1].ing-a[1].ing).slice(0,6);
  const tb=el('tbody');top.forEach((e,i)=>tb.appendChild(el('tr',{},[el('td',{class:'mini',text:String(i+1)}),el('td',{text:e[0]}),el('td',{class:'der mini',text:e[1].q+' u'}),el('td',{class:'der',style:'font-weight:600',text:money(e[1].ing)})])));
  grid.appendChild(el('div',{class:'card pad0 glass'},[el('div',{style:'padding:18px 20px 4px'},el('h2',{text:'Más vendidos del mes'})),el('div',{class:'tabla-wrap',style:'max-height:230px'},[el('table',{},[el('thead',{},el('tr',{},[el('th',{text:'#'}),el('th',{text:'Producto'}),el('th',{text:'Cant',class:'der'}),el('th',{text:'Ingresos',class:'der'})])),tb])])]));
  root.appendChild(grid);
  const grid2=el('div',{class:'grid2',style:'margin-top:16px'});
  const fb=el('tbody');['1','13'].forEach(r=>{const d=mes.byRate[r]||{base:0,imp:0,total:0};fb.appendChild(el('tr',{},[el('td',{text:'IVA '+r+'%'}),el('td',{class:'der',text:money(d.base)}),el('td',{class:'der',text:money(d.imp)}),el('td',{class:'der',style:'font-weight:600',text:money(d.total)})]));});
  fb.appendChild(el('tr',{},[el('td',{style:'font-weight:700',text:'Total mes'}),el('td',{class:'der',style:'font-weight:700',text:money(mes.base)}),el('td',{class:'der',style:'font-weight:700',text:money(mes.imp)}),el('td',{class:'der',style:'font-weight:700',text:money(mes.total)})]));
  grid2.appendChild(el('div',{class:'card pad0 glass'},[el('div',{style:'padding:18px 20px 4px'},el('h2',{text:'Resumen de IVA del mes (Hacienda)'})),el('div',{class:'tabla-wrap'},[el('table',{},[el('thead',{},el('tr',{},[el('th',{text:'Tarifa'}),el('th',{text:'Base',class:'der'}),el('th',{text:'IVA',class:'der'}),el('th',{text:'Total',class:'der'})])),fb])])]));
  const mp=[['Efectivo',mes.ef,'cash'],['Tarjeta',mes.ta,'card'],['SINPE',mes.si,'phone']];
  grid2.appendChild(el('div',{class:'card glass'},[el('div',{class:'card-t'},[el('h2',{text:'Medios de pago (mes)'})]),
    el('div',{style:'display:flex;flex-direction:column;gap:12px'},mp.map(m=>{const pct=mes.total?Math.round(m[1]/mes.total*100):0;return el('div',{},[el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:5px'},[el('span',{style:'display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600'},[icon(m[2],16),m[0]]),el('span',{style:'font-weight:700',text:money(m[1])+' · '+pct+'%'})]),el('div',{style:'height:7px;border-radius:99px;background:rgba(17,22,39,.06);overflow:hidden'},el('div',{style:'height:100%;width:'+pct+'%;border-radius:99px;background:var(--accent)'}))]);}))]));
  root.appendChild(grid2);
  root.appendChild(el('div',{class:'card glass',style:'margin-top:16px;display:flex;align-items:center;gap:13px;flex-wrap:wrap'},[el('span',{class:'ic',style:'width:40px;height:40px;border-radius:12px;background:var(--pos-soft);color:var(--pos);display:grid;place-items:center;flex:none'},icon('mail',20)),el('div',{style:'flex:1;min-width:0'},[el('div',{style:'font-weight:700',text:'Reportes por correo a la dueña'}),el('div',{class:'mini',text:'Diario y mensual'+(DB.settings.correoDuena?' · '+DB.settings.correoDuena:'')+' · el envío automático se activa más adelante'})]),el('span',{class:'pill',text:'Próximamente'})]));
}

function renderCierre(){
  const root=$('#v-cierre');root.innerHTML='';
  if(!DB.shift.open){const last=DB.archivo[DB.archivo.length-1];
    root.appendChild(el('div',{class:'cerrada-aviso glass'},[icon('wallet',30),el('h2',{text:'No hay un turno abierto',style:'margin:6px 0 4px'}),el('div',{class:'mini',style:'margin-bottom:14px',text:last?('Último cierre: '+fmtFH(last.closedAt)+' · '+money(last.ventas)+' en ventas.'):'Abrí la caja para iniciar un turno.'}),el('button',{class:'btn btn--pos btn--lg',onclick:modalAbrir},[icon('unlock',18),'Abrir caja'])]));return;}
  const sh=DB.shift;const vs=validSales().filter(s=>s.ts>=sh.openedAt);const a=agg(vs);const espEf=sh.fondo+a.ef;
  const resumen=el('div',{class:'card glass'},[el('h2',{text:'Turno abierto'}),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Apertura'}),el('span',{class:'v',text:fmtFH(sh.openedAt)})]),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Fondo inicial'}),el('span',{class:'v',text:money(sh.fondo)})]),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Tiquetes'}),el('span',{class:'v',text:String(a.count)})]),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Ventas del turno'}),el('span',{class:'v',text:money(a.total)})])]);
  const medios=el('div',{class:'card glass'},[el('h2',{text:'Por medio de pago'}),
    el('div',{class:'arqueo'},[el('span',{style:'display:flex;gap:8px;align-items:center'},[icon('cash',16),'Efectivo']),el('span',{class:'v',text:money(a.ef)})]),
    el('div',{class:'arqueo'},[el('span',{style:'display:flex;gap:8px;align-items:center'},[icon('card',16),'Tarjeta (datáfono)']),el('span',{class:'v',text:money(a.ta)})]),
    el('div',{class:'arqueo'},[el('span',{style:'display:flex;gap:8px;align-items:center'},[icon('phone',16),'SINPE']),el('span',{class:'v',text:money(a.si)})])]);
  const iCont=el('input',{inputmode:'numeric',placeholder:'0',style:'text-align:right;font-size:18px;font-weight:700'});
  const diffEl=el('span',{class:'v',text:'—'});
  iCont.addEventListener('input',()=>{const c=toNum(iCont.value);const diff=c-espEf;diffEl.textContent=(diff>=0?'+':'')+money(diff);diffEl.className='v '+(Math.abs(diff)<1?'diff-ok':(diff<0?'diff-bad':''));});
  const arqueo=el('div',{class:'card glass'},[el('h2',{text:'Arqueo de efectivo'}),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Efectivo esperado (fondo + ventas)'}),el('span',{class:'v',text:money(espEf)})]),
    el('div',{class:'campo',style:'margin:12px 0 4px'},[el('label',{text:'Efectivo contado en caja'}),iCont]),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Diferencia'}),diffEl]),
    el('button',{class:'btn btn--accent btn--lg btn--block',style:'margin-top:14px',onclick:()=>confirmarCierre(espEf,toNum(iCont.value),a)},[icon('lock',18),'Cerrar caja y generar Z'])]);
  root.appendChild(el('div',{class:'grid2'},[resumen,medios]));
  root.appendChild(el('div',{style:'margin-top:16px'},arqueo));
}
function confirmarCierre(esp,cont,a){
  const diff=cont-esp;
  const m=el('div',{class:'modal narrow'},[el('h2',{text:'Cerrar caja'}),
    el('div',{style:'color:var(--ink-2);margin-bottom:6px',text:'Se cierra el turno y se genera el reporte Z. Las ventas quedan en el historial.'}),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Esperado'}),el('span',{class:'v',text:money(esp)})]),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Contado'}),el('span',{class:'v',text:money(cont)})]),
    el('div',{class:'arqueo'},[el('span',{class:'mini',text:'Diferencia'}),el('span',{class:'v '+(Math.abs(diff)<1?'diff-ok':'diff-bad'),text:(diff>=0?'+':'')+money(diff)})]),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--accent',onclick:()=>{
      DB.archivo.push({openedAt:DB.shift.openedAt,closedAt:Date.now(),fondo:DB.shift.fondo,esperado:esp,contado:cont,diferencia:diff,ventas:a.total,tiquetes:a.count,ef:a.ef,ta:a.ta,si:a.si});
      DB.shift={open:false};bd.config('cierres',DB.archivo);bd.config('turno',DB.shift);updShiftPill();cerrarModal();go('cierre');toast('Caja cerrada · Z generado');
    }},'Confirmar cierre')])]);
  abrirModal(m);
}

function renderAjustes(){
  const root=$('#v-ajustes');root.innerHTML='';const S=DB.settings;const g=el('div',{class:'cfg-grid'});
  function campoB(k,l){const i=el('input',{value:S[k]||''});i.addEventListener('input',()=>{S[k]=i.value;guardarAjustes();if(k==='sucursal'||k==='terminal'||k==='negocio')updShiftPill();});return el('div',{class:'campo'},[el('label',{text:l}),i]);}
  function rowInp(k,l){const i=el('input',{value:S[k]||''});i.addEventListener('input',()=>{S[k]=i.value;guardarAjustes();});return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),i]);}
  function rowInpN(k,l){const i=el('input',{value:S[k],inputmode:'numeric',style:'min-width:90px'});i.addEventListener('input',()=>{S[k]=toNum(i.value);guardarAjustes();});return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),i]);}
  function rowSel(k,l,opts){const s=el('select');opts.forEach(o=>s.appendChild(el('option',{text:o})));s.value=S[k]||opts[0];s.addEventListener('change',()=>{S[k]=s.value;guardarAjustes();});return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),s]);}
  function rowSelNB(l,opts){const s=el('select');opts.forEach(o=>s.appendChild(el('option',{text:o})));return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),s]);}
  function rowTime(k,l){const i=el('input',{type:'time',value:S[k]||'22:00'});i.addEventListener('change',()=>{S[k]=i.value;guardarAjustes();});return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),i]);}
  function rowSw(k,l){const w=el('label',{class:'sw'});const i=el('input',{type:'checkbox'});if(S[k])i.checked=true;i.addEventListener('change',()=>{S[k]=i.checked;guardarAjustes();});w.append(i,el('span',{class:'tr'}));return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),w]);}
  function rowStatic(l,node){return el('div',{class:'cfg-row'},[el('div',{class:'l',text:l}),node]);}
  g.appendChild(el('div',{class:'card glass'},[el('h2',{text:'Negocio'}),campoB('negocio','Nombre'),campoB('cedula','Cédula jurídica'),el('div',{class:'g2'},[campoB('sucursal','Sucursal'),campoB('terminal','Terminal')])]));
  g.appendChild(el('div',{class:'card glass'},[el('h2',{text:'Impresora'}),rowSel('impresora','Impresora',['Predeterminada de Windows']),rowSel('ticket','Tamaño del ticket',['80 mm','58 mm','Carta / A4']),rowSw('imprimirAlCobrar','Imprimir al cobrar'),rowInp('pieTicket','Pie del ticket')]));
  g.appendChild(el('div',{class:'card glass'},[el('h2',{text:'Reportes por correo'}),campoB('correoDuena','Enviar a (dueña)'),rowStatic('Cierre diario',el('span',{class:'pill pill--green',text:'Próximamente'})),rowStatic('Cierre mensual',el('span',{class:'pill pill--green',text:'Próximamente'})),el('div',{class:'note',html:'Cuando se active, el cierre diario y el mensual se enviarán <b>solos</b> a este correo, sin que la caja tenga que hacer nada.'})]));
  g.appendChild(el('div',{class:'card glass'},[el('h2',{text:'Factura electrónica'}),rowStatic('Hacienda',el('span',{class:'pill',text:'Desactivada por ahora'})),el('div',{class:'note',html:'Por ahora el POS <b>guarda las facturas internamente</b> (qué se vende y a quién). La conexión con Hacienda se activa más adelante.'})]));
  g.appendChild(el('div',{class:'card glass'},[el('h2',{text:'General'}),rowSelNB('Moneda',['₡ colones']),rowSw('ivaIncl','Precios con IVA incluido'),rowInpN('stockMin','Alerta de stock bajo'),rowInpN('venceDias','Avisar vencimiento (días)')]));
  g.appendChild(el('div',{class:'card glass'},[el('h2',{text:'Base de datos'}),rowStatic('Motor',el('span',{class:'pill pill--accent',text:'SQLite (local)'})),rowStatic('Estado',el('span',{class:'pill pill--green',text:HAY_BD?'Conectada':'Sin base (modo prueba)'})),
    el('div',{style:'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap'},[el('button',{class:'btn btn--ghost btn--sm',onclick:exportVentas},[icon('download',16),'Exportar ventas']),el('button',{class:'btn btn--ghost btn--sm',onclick:exportInv},[icon('download',16),'Exportar inventario']),el('button',{class:'btn btn--ghost btn--sm',onclick:backupJSON},[icon('download',16),'Respaldo JSON'])]),
    el('div',{style:'margin-top:10px'},el('button',{class:'btn btn--danger-ghost btn--sm',onclick:modalReset},[icon('trash',15),'Borrar todos los datos'])),
    el('div',{class:'note',html:'Todo se guarda en <b>besalu.sqlite</b>, en esta computadora. Exportá a CSV o hacé un respaldo JSON cuando quieras.'})]));
  root.appendChild(g);
  root.appendChild(el('div',{style:'margin-top:18px'},el('button',{class:'btn btn--accent btn--lg',onclick:()=>toast('Ajustes guardados')},'Guardar ajustes')));
}

let _dlns,_dltried=false;
async function getDL(){if(!_dltried){_dltried=true;try{_dlns=(window.claude&&claude.use)?await claude.use('downloads'):null;}catch(e){_dlns=null;}}return _dlns;}
async function dl(name,text){const d=await getDL();if(!d){toast('La descarga no está disponible en esta vista','err');return;}try{const r=await d.save({filename:name,data:text});if(!r||r.status==='saved')toast('Guardado: '+name);}catch(e){if(e&&e.code==='declined')return;toast('No se pudo exportar','err');}}
function csv(rows){return '﻿sep=;\n'+rows.map(r=>r.map(c=>{c=String(c==null?'':c);return /[;"\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c;}).join(';')).join('\n');}
function exportInv(){const rows=[['Codigo','Producto','IVA','Costo','Precio','Stock','Vence']];DB.products.forEach(p=>rows.push([p.cod,p.nom,p.iva+'%',p.costo,p.precio,p.stock,p.vence||'']));dl('inventario-besalu.csv',csv(rows),'text/csv');}
function exportVentas(){const rows=[['Folio','Fecha','Metodo','Base','IVA','Total','Anulada']];validSales().forEach(s=>rows.push([s.folio,fmtFH(s.ts),s.metodo,Math.round(s.base),Math.round(s.imp),Math.round(s.total),s.anulada?'si':'no']));dl('ventas-besalu.csv',csv(rows),'text/csv');}
function backupJSON(){dl('respaldo-besalu-'+fmtF(Date.now()).replace(/\//g,'-')+'.json',JSON.stringify(DB,null,2),'application/json');}
function modalReset(){const m=el('div',{class:'modal narrow'},[el('h2',{text:'Borrar todos los datos'}),el('div',{style:'color:var(--ink-2)',text:'Se borran productos, ventas, cierres y ajustes de esta computadora. Exportá un respaldo antes. No se puede deshacer.'}),el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--danger-ghost',onclick:()=>{DB=seed();if(HAY_BD)persistir(BESALU.datos.reiniciar().then(()=>Promise.all([BESALU.datos.guardarConfig('ajustes',DB.settings),BESALU.datos.guardarConfig('turno',DB.shift),BESALU.datos.guardarConfig('consecutivo',DB.seq),BESALU.datos.guardarConfig('cierres',DB.archivo)])));cerrarModal();buildNav();updShiftPill();go('caja');toast('Datos reiniciados');}},'Reiniciar')])]);abrirModal(m);}

function abrirModal(node){const f=el('div',{class:'modal-bg',onclick:e=>{if(e.target===f)cerrarModal();}},[node]);$('#modalRoot').appendChild(f);const first=node.querySelector('input,select');if(first)setTimeout(()=>first.focus(),40);}
function cerrarModal(){$('#modalRoot').innerHTML='';}
function modalCliente(){
  const c=state.cliente||{};
  const iN=el('input',{value:c.nombre||'',placeholder:'Nombre del cliente'}),iC=el('input',{value:c.cedula||'',placeholder:'Cédula o identificación'});
  const m=el('div',{class:'modal narrow'},[el('h2',{text:'Cliente de la factura'}),el('div',{class:'mini',style:'margin-bottom:12px',text:'Opcional. Si lo dejás vacío, la venta es un tiquete a consumidor final.'}),
    el('div',{class:'campo'},[el('label',{text:'Nombre'}),iN]),
    el('div',{class:'campo'},[el('label',{text:'Cédula / identificación'}),iC]),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:()=>{state.cliente=null;cerrarModal();paintCobro();}},'Consumidor final'),el('button',{class:'btn btn--accent',onclick:()=>{const n=iN.value.trim();state.cliente=n?{nombre:n,cedula:iC.value.trim()}:null;cerrarModal();paintCobro();}},'Guardar cliente')])]);
  abrirModal(m);
}
function modalProducto(p){
  const ed=!!p;
  const base0=p?(p.base!=null?p.base:p.costo):'',imp0=p&&p.imp!=null?p.imp:'',env0=p&&p.envio!=null?p.envio:'',mar0=p?(p.margen!=null?p.margen:(p.costo>0?Math.round((p.precio-p.costo)/p.costo*100):30)):30;
  const iCod=el('input',{value:p?p.cod:'',placeholder:'Escaneá o escribí'}),iNom=el('input',{value:p?p.nom:''});
  const iCos=el('input',{value:base0,inputmode:'numeric',placeholder:'0'}),iImp=el('input',{value:imp0,inputmode:'numeric',placeholder:'0'}),iEnv=el('input',{value:env0,inputmode:'numeric',placeholder:'0'}),iMar=el('input',{value:mar0,inputmode:'numeric',placeholder:'30'});
  const iPre=el('input',{value:p?p.precio:'',inputmode:'numeric',placeholder:'0'}),iSto=el('input',{value:p?p.stock:'0',inputmode:'numeric'});
  const iIva=el('select');['13 %','1 %','exento'].forEach(o=>iIva.appendChild(el('option',{text:o})));if(p)iIva.value=p.iva===1?'1 %':(p.iva===13?'13 %':'exento');
  const iVence=el('input',{type:'date',value:p&&p.vence?p.vence:''}),iCab=el('input',{value:p&&p.cabys?p.cabys:'',placeholder:'13 dígitos'});
  const sugV=el('div',{class:'cv'}),sugSub=el('div',{class:'mini'}),ivaInfo=el('div',{class:'mini',style:'margin:-6px 0 12px'});
  const usar=el('button',{class:'btn btn--ghost btn--sm',type:'button',onclick:()=>{const ct=toNum(iCos.value)+toNum(iImp.value)+toNum(iEnv.value);iPre.value=Math.round(ct*(1+toNum(iMar.value)/100)/5)*5;calc();}},'Usar');
  function calc(){const base=toNum(iCos.value),imp=toNum(iImp.value),env=toNum(iEnv.value),mar=toNum(iMar.value),ct=base+imp+env,sug=Math.round(ct*(1+mar/100)/5)*5;sugV.textContent=money(sug);const pre=toNum(iPre.value),gan=pre-ct,gm=ct>0?Math.round(gan/ct*100):0;sugSub.textContent='Costo total '+money(ct)+(pre?'  ·  ganás '+money(gan)+' ('+gm+'%)':'');sugSub.style.color=(pre&&gan<0)?'var(--neg)':'';const t=iIva.value.indexOf('1 ')===0?1:(iIva.value.indexOf('13')===0?13:0);if(pre&&t>0){const b=pre/(1+t/100);ivaInfo.textContent='IVA incluido: base '+money(b)+' + IVA '+money(pre-b)+' ('+t+'%)';}else ivaInfo.textContent=t>0?'El precio incluye '+t+'% de IVA':'Producto exento de IVA';}
  [iCos,iImp,iEnv,iMar,iPre].forEach(x=>x.addEventListener('input',calc));iIva.addEventListener('change',calc);
  const m=el('div',{class:'modal'},[el('h2',{text:ed?'Editar producto':'Agregar producto'}),
    el('div',{class:'campo'},[el('label',{text:'Código de barras'}),iCod]),
    el('div',{class:'campo'},[el('label',{text:'Nombre'}),iNom]),
    el('div',{class:'g2'},[el('div',{class:'campo'},[el('label',{text:'Costo (compra)'}),iCos]),el('div',{class:'campo'},[el('label',{text:'Impuestos pagados'}),iImp])]),
    el('div',{class:'g2'},[el('div',{class:'campo'},[el('label',{text:'Envío'}),iEnv]),el('div',{class:'campo'},[el('label',{text:'Margen deseado %'}),iMar])]),
    el('div',{class:'calcbox'},[el('div',{style:'min-width:0'},[el('div',{class:'mini',text:'Precio sugerido'}),sugV,sugSub]),usar]),
    el('div',{class:'g2'},[el('div',{class:'campo'},[el('label',{text:'Precio de venta (manual)'}),iPre]),el('div',{class:'campo'},[el('label',{text:'Stock'}),iSto])]),
    ivaInfo,
    el('div',{class:'g2'},[el('div',{class:'campo'},[el('label',{text:'IVA'}),iIva]),el('div',{class:'campo'},[el('label',{text:'Fecha de caducidad'}),iVence])]),
    el('div',{class:'campo'},[el('label',{text:'CABYS'}),iCab]),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--accent',onclick:()=>{
      const iva=iIva.value.indexOf('1 ')===0?1:(iIva.value.indexOf('13')===0?13:0),base=toNum(iCos.value),imp=toNum(iImp.value),env=toNum(iEnv.value);
      const cod=iCod.value.trim(),nom=iNom.value.trim();if(!cod||!nom){toast('Falta código o nombre','err');return;}
      if(DB.products.some(x=>x.cod===cod&&x!==p)){toast('Ya existe un producto con ese código','err');return;}
      const codViejo=ed?p.cod:null;
      const obj={cod,nom,precio:toNum(iPre.value),base,imp,envio:env,margen:toNum(iMar.value),costo:base+imp+env,stock:toNum(iSto.value),iva,vence:iVence.value,cabys:iCab.value.trim()};
      if(ed){Object.assign(p,obj);if(codViejo!==cod)bd.borrarProducto(codViejo);bd.producto(p);toast('Cambios guardados');}else{obj.id=Date.now();DB.products.unshift(obj);bd.producto(obj);toast('Producto agregado');}
      cerrarModal();buildNav();renderInventario();
    }},ed?'Guardar':'Agregar')])]);
  abrirModal(m);calc();
}
function modalEntrada(p){
  const iC=el('input',{inputmode:'numeric',placeholder:'Cantidad'}),iK=el('input',{inputmode:'numeric',value:p.costo}),iV=el('input',{type:'date',value:p.vence||''});
  const m=el('div',{class:'modal narrow'},[el('h2',{text:'Entrada de inventario'}),el('div',{class:'mini',style:'margin-bottom:12px',text:p.nom+' · stock actual '+p.stock}),
    el('div',{class:'g2'},[el('div',{class:'campo'},[el('label',{text:'Cantidad que entra'}),iC]),el('div',{class:'campo'},[el('label',{text:'Costo unitario'}),iK])]),
    el('div',{class:'campo'},[el('label',{text:'Fecha de caducidad del lote'}),iV]),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--accent',onclick:()=>{const c=toNum(iC.value);if(c<=0){toast('Escribí una cantidad','err');return;}p.stock+=c;p.costo=toNum(iK.value)||p.costo;if(iV.value)p.vence=iV.value;bd.producto(p);cerrarModal();buildNav();renderInventario();toast('Entrada registrada');}},'Registrar')])]);
  abrirModal(m);
}
function modalEliminar(p){
  const m=el('div',{class:'modal narrow'},[el('h2',{text:'Eliminar producto'}),el('div',{style:'color:var(--ink-2)',text:'¿Eliminar "'+p.nom+'" del inventario? Las ventas registradas se conservan.'}),
    el('div',{class:'modal-acc'},[el('button',{class:'btn btn--ghost',onclick:cerrarModal},'Cancelar'),el('button',{class:'btn btn--danger-ghost',onclick:()=>{DB.products=DB.products.filter(x=>x!==p);bd.borrarProducto(p.cod);cerrarModal();buildNav();renderInventario();toast('Producto eliminado');}},'Eliminar')])]);
  abrirModal(m);
}

iniciar();
