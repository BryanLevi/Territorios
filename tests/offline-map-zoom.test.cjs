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

function zoomContext(){const c=vm.createContext({});vm.runInContext(extract('configureRuntimeMapZoom'),c);return c;}
function targetMap(options={}){
  let zoom=16;const calls=[];
  const map={options:{zoomAnimation:true,wheelDebounceTime:40,zoomDelta:1,markerZoomAnimation:true,...options},getZoom:()=>zoom,
    setView(center,nextZoom,settings){calls.push({receiver:this,center,zoom:nextZoom,options:settings});if(nextZoom!==undefined)zoom=nextZoom;return this;}};
  return{map,calls};
}

test('offline acelera zoom y rueda, preservando opciones del llamador y animación de desplazamiento',()=>{
  const c=zoomContext(),h=targetMap(),originalOptions=plain(h.map.options);c.configureRuntimeMapZoom(h.map,true);
  assert.equal(h.map.options.zoomAnimation,false);assert.equal(h.map.options.wheelDebounceTime,16);
  assert.equal(h.map.options.zoomDelta,originalOptions.zoomDelta);assert.equal(h.map.options.markerZoomAnimation,originalOptions.markerZoomAnimation);
  const options={animate:true,zoom:{animate:true,duration:.15,noMoveStart:true},pan:{animate:true,duration:.8},reset:false},before=plain(options);
  assert.equal(h.map.setView([1,2],17,options),h.map);
  const received=h.calls[0].options;assert.equal(received.zoom.animate,false);assert.equal(received.zoom.duration,.15);assert.equal(received.zoom.noMoveStart,true);
  assert.equal(received.animate,true);assert.equal(received.reset,false);assert.equal(received.pan,options.pan);
  assert.notEqual(received,options);assert.notEqual(received.zoom,options.zoom);assert.deepEqual(options,before);assert.equal(h.calls[0].receiver,h.map);
});

test('online mantiene opciones e identidades originales y restaura la configuración propia de cada mapa',()=>{
  const c=zoomContext();for(const defaults of [{zoomAnimation:true,wheelDebounceTime:73},{zoomAnimation:false,wheelDebounceTime:55}]){
    const h=targetMap(defaults),original=plain(h.map.options),options={zoom:{animate:true},pan:{animate:true}};
    c.configureRuntimeMapZoom(h.map,false);assert.deepEqual(h.map.options,original);
    h.map.setView([1,2],17,options);assert.equal(h.calls[0].options,options);
    c.configureRuntimeMapZoom(h.map,true);c.configureRuntimeMapZoom(h.map,false);assert.deepEqual(h.map.options,original);
    h.map.setView([2,3],18,options);assert.equal(h.calls[1].options,options);assert.equal(h.calls[1].options.zoom.animate,true);
  }
});

test('reset booleano true y un paneo sin cambio de zoom llegan intactos a setView',()=>{
  const c=zoomContext(),h=targetMap();c.configureRuntimeMapZoom(h.map,true);
  h.map.setView([1,2],17,true);assert.equal(h.calls[0].options,true);
  const pan={animate:true,pan:{animate:true,duration:.6}};
  h.map.setView([2,3],17,pan);assert.equal(h.calls[1].options,pan);
  h.map.setView([3,4],undefined,pan);assert.equal(h.calls[2].options,pan);
  h.map.setView([3,4],18);assert.equal(h.calls[3].options.zoom.animate,false);
});

test('el wrapper es idempotente y solo afecta a la instancia configurada',()=>{
  const c=zoomContext(),main=targetMap(),other=targetMap(),otherSetView=other.map.setView;
  c.configureRuntimeMapZoom(main.map,true);const wrapped=main.map.setView;
  c.configureRuntimeMapZoom(main.map,true);c.configureRuntimeMapZoom(main.map,false);c.configureRuntimeMapZoom(main.map,true);
  assert.equal(main.map.setView,wrapped);assert.equal(other.map.setView,otherSetView);
  const options={zoom:{animate:true}};other.map.setView([1,2],17,options);main.map.setView([1,2],17,options);
  assert.equal(other.calls[0].options,options);assert.equal(other.map.options.zoomAnimation,true);assert.equal(other.map.options.wheelDebounceTime,40);
  assert.equal(main.calls.length,1);assert.equal(main.calls[0].options.zoom.animate,false);
});
