const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');

function extract(name){
  let start=html.indexOf('function '+name+'(');assert(start>=0,name);
  if(html.slice(start-6,start)==='async ')start-=6;
  const opening=html.indexOf('{',start);let level=0,quote=null;
  for(let i=opening;i<html.length;i++){
    const c=html[i],next=html[i+1];
    if(quote){if(c==='\\')i++;else if(c===quote)quote=null;continue;}
    if(c==='/'&&next==='/'){i=html.indexOf('\n',i);continue;}
    if(c==='/'&&next==='*'){i=html.indexOf('*/',i+2)+1;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')level++;
    if(c==='}'&&--level===0)return html.slice(start,i+1);
  }
  throw new Error('Incomplete '+name);
}
const plain=value=>JSON.parse(JSON.stringify(value));

function frames(realPaint=false){
  let id=0,onDraw;const pending=new Map();
  const calls={requested:[],cancelled:[],paints:[],details:[],plans:[],roads:[],areaClears:0,nameClears:0};
  const c=vm.createContext({map:{},currentView:'offline',currentIndex:0,congregacionActivaId:'a',
    LOCS:[{num:1},{num:2}],runtimeOfflineRenderFrame:null,
    requestAnimationFrame(callback){const token=++id;pending.set(token,callback);calls.requested.push(token);return token;},
    cancelAnimationFrame(token){calls.cancelled.push(token);pending.delete(token);},
    drawRuntimeOfflineMap(){calls.paints.push({view:c.currentView,territory:c.LOCS[c.currentIndex]?.num,group:c.congregacionActivaId});onDraw?.();},
    runtimeRoadCache:null,
    runtimeOfflineAreaLayer:{clearLayers(){calls.areaClears++;}},
    runtimeOfflineLabelLayer:{clearLayers(){calls.nameClears++;}},
    getRuntimeRoadCacheKey:loc=>String(loc.num),
    drawRuntimeOfflineDetails:details=>calls.details.push(details),
    runtimeOfflineVisibleReferences:loc=>[{name:'Reference '+loc.num}],runtimeOfflineReservedLabels:()=>[],
    planRuntimeOfflineMapLabels(targetMap,ways,references,places,reserved){calls.plans.push({ways,references,places,reserved});return{roads:[],places:[],references:[]};},
    drawRuntimeOfflineStreetLabels:(ways,labels)=>calls.roads.push({ways,labels})});
  c.window=c;
  vm.runInContext(['cancelRuntimeOfflineMapRefresh','refreshRuntimeOfflineMap',...(realPaint?['drawRuntimeOfflineMap']:[])].map(extract).join('\n'),c);
  function tick(){
    // Like RAF, requests made from a callback belong to the next frame.
    const batch=[...pending];batch.forEach(([token])=>pending.delete(token));batch.forEach(([,callback])=>callback());
  }
  return{c,calls,pending,tick,onDraw:callback=>{onDraw=callback;}};
}

test('zoomend, moveend, calles y referencias pintan una vez; una ráfaga conserva solo el último cuadro',()=>{
  const h=frames();for(let i=0;i<4;i++)h.c.refreshRuntimeOfflineMap();
  assert.equal(h.calls.requested.length,1);assert.equal(h.pending.size,1);assert.equal(h.calls.paints.length,0);
  h.tick();assert.equal(h.calls.paints.length,1);assert.equal(h.c.runtimeOfflineRenderFrame,null);
  for(let i=0;i<24;i++)h.c.refreshRuntimeOfflineMap();
  assert.equal(h.calls.requested.length,2);assert.equal(h.pending.size,1);
  h.tick();assert.equal(h.calls.paints.length,2);assert.equal(h.pending.size,0);
});

test('el callback usa la congregación y territorio más recientes, no el estado del primer evento',()=>{
  const h=frames(true);h.c.runtimeRoadCache={offline:true,key:'1',congregation:'a',roadWays:[{name:'Anterior'}],details:{areas:[],places:[]}};
  h.c.refreshRuntimeOfflineMap();h.c.currentIndex=1;h.c.congregacionActivaId='b';
  const details={areas:[],places:[{name:'Actual',lat:1,lng:2}]},ways=[{name:'Calle actual'}];
  h.c.runtimeRoadCache={offline:true,key:'2',congregation:'b',roadWays:ways,details};
  h.c.refreshRuntimeOfflineMap();h.tick();
  assert.equal(h.calls.plans.length,1);assert.equal(h.calls.details[0],details);
  assert.equal(h.calls.plans[0].ways,ways);assert.equal(h.calls.plans[0].references[0].name,'Reference 2');
  assert.equal(h.calls.roads[0].ways,ways);assert.equal(h.pending.size,0);
});

test('un cambio de territorio o congregación descarta la caché anterior antes de planear nombres',()=>{
  for(const changed of ['territory','group']){
    const h=frames(true);h.c.runtimeRoadCache={offline:true,key:'1',congregation:'a',roadWays:[{name:'Vieja'}],details:{areas:[],places:[{name:'Viejo'}]}};
    h.c.refreshRuntimeOfflineMap();if(changed==='territory')h.c.currentIndex=1;else h.c.congregacionActivaId='b';h.tick();
    assert.equal(h.calls.details[0],null,changed);assert.deepEqual(plain(h.calls.plans[0].ways),[],changed);
    assert.deepEqual(plain(h.calls.plans[0].places),[],changed);assert.equal(h.calls.roads.length,0,changed);
  }
});

test('si la vista cambia antes del cuadro, no dibuja los detalles ni nombres offline sobre Google',()=>{
  const h=frames(true);h.c.refreshRuntimeOfflineMap();h.c.currentView='g-road';h.tick();
  assert.equal(h.calls.plans.length,0);assert.equal(h.calls.details.length,0);assert.equal(h.calls.areaClears,1);assert.equal(h.calls.nameClears,1);
});

test('cancelar elimina el cuadro pendiente y permite un nuevo render sin una pintura tardía',()=>{
  const h=frames();h.c.refreshRuntimeOfflineMap();const first=h.c.runtimeOfflineRenderFrame;
  h.c.cancelRuntimeOfflineMapRefresh();h.c.cancelRuntimeOfflineMapRefresh();h.tick();
  assert.deepEqual(h.calls.cancelled,[first]);assert.equal(h.calls.paints.length,0);assert.equal(h.c.runtimeOfflineRenderFrame,null);
  h.c.refreshRuntimeOfflineMap();assert.notEqual(h.c.runtimeOfflineRenderFrame,first);h.tick();assert.equal(h.calls.paints.length,1);
});

test('un refresh fuera del mapa offline cancela el frame y limpia la vista inmediatamente',()=>{
  const h=frames(true);h.c.refreshRuntimeOfflineMap();h.c.currentView='g-sat';h.c.refreshRuntimeOfflineMap();
  assert.equal(h.pending.size,0);assert.equal(h.c.runtimeOfflineRenderFrame,null);
  assert.equal(h.calls.areaClears,1);assert.equal(h.calls.nameClears,1);h.tick();assert.equal(h.calls.areaClears,1);
});

test('un repaint que solicita otro refresh conserva el siguiente frame y no entra en un bucle síncrono',()=>{
  const h=frames();let reentered=false;
  h.onDraw(()=>{if(!reentered){reentered=true;assert.equal(h.c.runtimeOfflineRenderFrame,null);h.c.refreshRuntimeOfflineMap();}});
  h.c.refreshRuntimeOfflineMap();h.tick();
  assert.equal(h.calls.paints.length,1);assert.equal(h.pending.size,1);assert.notEqual(h.c.runtimeOfflineRenderFrame,null);
  h.tick();assert.equal(h.calls.paints.length,2);assert.equal(h.pending.size,0);assert.equal(h.c.runtimeOfflineRenderFrame,null);
});

function zoomContext(reducedMotion=false){
  const queries=[];
  const window=reducedMotion===null ? {} : {matchMedia(query){queries.push(query);return{matches:reducedMotion};}};
  const c=vm.createContext({window});
  vm.runInContext(['runtimeMapZoomOptions','configureRuntimeMapZoom'].map(extract).join('\n'),c);
  return{c,queries};
}
function targetMap(options={}){
  let zoom=16;const calls=[];
  const map={options:{zoomAnimation:true,wheelDebounceTime:40,zoomDelta:1,markerZoomAnimation:true,...options},getZoom:()=>zoom,
    setView(center,nextZoom,settings){calls.push({receiver:this,center,zoom:nextZoom,options:settings});if(nextZoom!==undefined)zoom=nextZoom;return this;}};
  return{map,calls};
}

test('el zoom usa pasos de medio nivel, rueda breve y menor sensibilidad sin añadir fade',()=>{
  const {c,queries}=zoomContext(),h=targetMap({minZoom:12,maxZoom:20}),options=h.map.options;
  const expected={zoomAnimation:true,fadeAnimation:false,zoomSnap:.5,zoomDelta:.5,wheelDebounceTime:24,wheelPxPerZoomLevel:180};
  assert.deepEqual(plain(c.runtimeMapZoomOptions()),expected);
  c.configureRuntimeMapZoom(h.map);
  assert.equal(h.map.options,options);
  for(const [key,value] of Object.entries(expected))assert.equal(h.map.options[key],value,key);
  assert.equal(h.map.options.markerZoomAnimation,true);assert.equal(h.map.options.minZoom,12);assert.equal(h.map.options.maxZoom,20);
  assert.ok(queries.length>0);assert.ok(queries.every(query=>query==='(prefers-reduced-motion: reduce)'));
});

test('configurar zoom conserva setView, coordenadas y las opciones explícitas de animación del llamador',()=>{
  const {c}=zoomContext(),h=targetMap(),originalSetView=h.map.setView;
  c.configureRuntimeMapZoom(h.map);
  assert.equal(h.map.setView,originalSetView);
  const center=Object.freeze([19.048889,-96.981944]);
  for(const options of [
    {animate:true,zoom:{animate:true,duration:.15,noMoveStart:true},pan:{animate:true,duration:.8},reset:false},
    {animate:false},
    {animate:true,zoom:{animate:false}},
    {zoom:{animate:true},pan:{animate:false}}
  ]){
    const before=plain(options),nextZoom=h.map.getZoom()+.5;
    assert.equal(h.map.setView(center,nextZoom,options),h.map);
    const received=h.calls.at(-1);
    assert.equal(received.receiver,h.map);assert.equal(received.center,center);assert.equal(received.zoom,nextZoom);
    assert.equal(received.options,options);assert.deepEqual(options,before);
  }
});

test('reset booleano, paneo y zoom sin opciones llegan intactos a setView',()=>{
  const {c}=zoomContext(),h=targetMap();c.configureRuntimeMapZoom(h.map);
  h.map.setView([1,2],17,true);assert.equal(h.calls[0].options,true);
  const pan={animate:true,pan:{animate:true,duration:.6}};
  h.map.setView([2,3],17,pan);assert.equal(h.calls[1].options,pan);
  h.map.setView([3,4],undefined,pan);assert.equal(h.calls[2].options,pan);
  h.map.setView([3,4],18);assert.equal(h.calls[3].options,undefined);
});

test('alternar vistas conserva la misma animación suave sin mover ni envolver el mapa',()=>{
  const {c}=zoomContext(),h=targetMap({zoomAnimation:false,wheelDebounceTime:73}),originalSetView=h.map.setView;
  const expected=plain(c.runtimeMapZoomOptions());
  for(const offline of [false,true,false,true]){
    c.configureRuntimeMapZoom(h.map,offline);
    for(const [key,value] of Object.entries(expected))assert.equal(h.map.options[key],value,key);
    assert.equal(h.map.setView,originalSetView);assert.equal(h.map.getZoom(),16);assert.equal(h.calls.length,0);
  }
});

test('la preferencia de movimiento reducido desactiva la animación; sin esa preferencia el zoom permanece suave',()=>{
  for(const reducedMotion of [true,false,null]){
    const {c}=zoomContext(reducedMotion),h=targetMap();
    assert.equal(c.runtimeMapZoomOptions().zoomAnimation,reducedMotion!==true);
    c.configureRuntimeMapZoom(h.map);
    assert.equal(h.map.options.zoomAnimation,reducedMotion!==true);
    assert.equal(h.map.options.zoomSnap,.5);assert.equal(h.map.options.wheelDebounceTime,24);
    const options={animate:false};h.map.setView([1,2],17,options);assert.equal(h.calls[0].options,options);
  }
});

test('solo se configura la instancia principal y el mapa de impresión conserva sus opciones y API',()=>{
  const {c}=zoomContext(),main=targetMap(),print=targetMap({zoomAnimation:false,zoomSnap:0,zoomDelta:.25,wheelDebounceTime:55});
  const originalPrintOptions=plain(print.map.options),mainSetView=main.map.setView,printSetView=print.map.setView;
  c.configureRuntimeMapZoom(main.map);c.configureRuntimeMapZoom(main.map);
  assert.equal(main.map.setView,mainSetView);assert.equal(print.map.setView,printSetView);
  assert.deepEqual(print.map.options,originalPrintOptions);
  const options={zoom:{animate:false}};print.map.setView([1,2],17,options);
  assert.equal(print.calls[0].options,options);assert.equal(main.calls.length,0);
});
