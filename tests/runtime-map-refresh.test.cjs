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
function references(view='g-road'){
  const active=[],calls={clears:0,markers:0,panel:0,refresh:0,reads:0};
  const layer={getLayers:()=>active,clearLayers(){calls.clears++;active.length=0;}};
  const c=vm.createContext({map:{},runtimeReferenceLayer:layer,LOCS:[{num:1},{num:2}],currentIndex:0,
    congregacionActivaId:'a',currentView:view,runtimeReferenceCache:null,runtimeReferenceRequestId:0,
    scale:.86,hidden:new Set(),manual:[],areas:[{}],
    referenceZoomScale:()=>c.scale,getColorAreasForLoc:()=>c.areas,
    getHiddenReferencesForLoc:()=>c.hidden,getManualIconsForLoc:()=>c.manual,
    actualizarPanelReferencias(){calls.panel++;},refreshRuntimeOfflineMap(){calls.refresh++;},
    referenceKey:ref=>ref.name,referenceLabelText:ref=>ref.name,
    isCoveredByManualIcon:(ref,icons)=>icons.some(icon=>icon.name===ref.name),
    referenceLabelHtml:(ref,print,scale)=>ref.name+'@'+scale,selectReference(){},
    getRuntimeRoadCacheKey:loc=>String(loc.num),
    readOverpassCache(){calls.reads++;return null;},fetchReferencesForBounds(){throw new Error('Unexpected network');},
    L:{divIcon:icon=>icon,marker(point,options){calls.markers++;return{point,options,addTo(){active.push(this);return this;},on(){return this;}};}}});
  c.window=c;
  vm.runInContext(['drawRuntimeReferences','updateRuntimeReferenceOverlay'].map(extract).join('\n'),c);
  return{c,calls,active,layer};
}
const refs=[{name:'Escuela',lat:19,lng:-96},{name:'Parque',lat:19.1,lng:-96.1}];

test('el final de un zoom actualiza una sola vez; desplazar el mapa sigue actualizando',()=>{
  const handlers=new Map(),calls={updates:0,directions:0};
  const map={setView(){return this;},createPane(){},getPane:()=>({style:{},classList:{add(){}}}),
    on(events,callback){for(const event of events.split(' ')){const callbacks=handlers.get(event)||[];callbacks.push(callback);handlers.set(event,callbacks);}return this;}};
  const layer=()=>({addTo(){return this;}});
  const c=vm.createContext({map:null,LOCS:[{num:1,lat:19,lon:-96}],currentIndex:0,currentView:'g-road',
    locSel:{},viewSel:{},$:()=>({}),navigator:{onLine:true},setTimeout(){},
    L:{map:()=>map,layerGroup:layer,canvas:layer,control:{scale:layer}},
    runtimeMapZoomOptions:()=>({zoomAnimation:true}),registrarCentradoUbicacion(){},
    handleColorMapClick(){},handleMapMouseMove(){},subirTransparenciasA50(){},recoverIxcatlaBlueIfMissing(){},
    changeView(){},goTo(){},loadCloudBackup(){},contourEditMode:false,selectedLine:null,
    updateLabelOverlayVisibility(){calls.updates++;},renderDirectionAnnotations(){calls.directions++;},refreshDestinationPlacementPreview(){}});
  c.window=c;vm.runInContext(extract('initApp'),c);c.initApp();
  for(const event of ['zoomend','moveend'])for(const callback of handlers.get(event)||[])callback();
  assert.equal(calls.updates,1);assert.equal(calls.directions,1);
  for(const callback of handlers.get('moveend')||[])callback();assert.equal(calls.updates,2);
});

test('acercar medio nivel y desplazar reutiliza los mismos iconos con y sin conexión',async()=>{
  for(const view of ['g-road','offline']){
    const h=references(view);h.c.runtimeReferenceCache={key:'ref:1',congregationId:'a',references:refs,offline:view==='offline'};
    await h.c.updateRuntimeReferenceOverlay();const original=h.active.slice();
    for(let i=0;i<8;i++)await h.c.updateRuntimeReferenceOverlay();
    assert.deepEqual(h.active,original,view);assert.equal(h.calls.markers,2,view);
    assert.equal(h.calls.clears,1,view);assert.equal(h.calls.reads,0,view);assert.equal(h.calls.panel,1,view);
    assert.equal(h.calls.refresh,view==='offline'?9:0,view);
  }
});

test('una nueva escala cambia el tamaño una vez y mantiene todos los iconos',()=>{
  const h=references();h.c.drawRuntimeReferences(refs);h.c.scale=1;h.c.drawRuntimeReferences(refs);
  assert.equal(h.calls.clears,2);assert.equal(h.calls.markers,4);assert.equal(h.active.length,2);
  assert.equal(h.active[0].options.icon.html,'Escuela@1');
  h.c.drawRuntimeReferences(refs);assert.equal(h.calls.clears,2);
});

test('ocultar y reemplazar una referencia con un icono manual actualiza la vista',()=>{
  const h=references();h.c.drawRuntimeReferences(refs);
  h.c.hidden.add('Escuela');h.c.drawRuntimeReferences(refs);assert.equal(h.active.length,1);
  assert.equal(h.active[0].options.icon.html,'Parque@0.86');
  h.c.manual.push({name:'Parque'});h.c.drawRuntimeReferences(refs);assert.equal(h.active.length,0);
  h.c.hidden.clear();h.c.manual=[];h.c.drawRuntimeReferences(refs);assert.equal(h.active.length,2);
});

test('cambiar colores, territorio, congregación, fondo o datos invalida los iconos anteriores',()=>{
  for(const mutate of [h=>{h.c.areas=[];},h=>{h.c.currentIndex=1;},h=>{h.c.congregacionActivaId='b';},h=>{h.c.currentView='offline';}]){
    const h=references();h.c.drawRuntimeReferences(refs);const original=h.active[0];mutate(h);h.c.drawRuntimeReferences(refs);
    assert.notEqual(h.active[0],original);assert.equal(h.calls.clears,2);
    if(!h.c.areas.length)assert.equal(h.active[0].options.opacity,.9);
  }
  const h=references();h.c.drawRuntimeReferences(refs);h.c.drawRuntimeReferences([{...refs[0],name:'Escuela nueva'}]);
  assert.equal(h.active.length,1);assert.equal(h.active[0].options.icon.html,'Escuela nueva@0.86');
});

test('reconstruye iconos si otra acción limpió la capa, incluso con datos en caché',()=>{
  const h=references();h.c.drawRuntimeReferences(refs);h.layer.clearLayers();h.c.drawRuntimeReferences(refs);
  assert.equal(h.active.length,2);assert.equal(h.calls.markers,4);
  h.c.drawRuntimeReferences([]);h.c.drawRuntimeReferences([]);assert.equal(h.active.length,0);
});

test('cambiar el fondo sólo carga mosaicos visibles y conserva las calles y nombres vectoriales',()=>{
  const tiles=[],removed=[],updates=[];
  const pane={classList:{toggle(){}}};
  const map={options:{},setView(){},removeLayer:layer=>removed.push(layer),getContainer:()=>pane,
    attributionControl:{addAttribution(){},removeAttribution(){}}};
  const c=vm.createContext({map,navigator:{onLine:true},currentView:'g-road',lastOnlineView:'g-road',offlineAutoView:false,
    LOCS:[{num:1}],currentIndex:0,viewSel:{dataset:{}},tileLayer:null,colorRestoreLayer:null,labelOverlayLayer:null,roadOverlayLayer:null,
    vectorRoadLayer:{},runtimeOfflineLabelLayer:null,runtimeRoadCache:null,runtimeReferenceCache:null,tileErrorCount:0,
    TILES:{'g-road':{url:'base/{z}/{x}/{y}',labelUrl:'labels/{z}/{x}/{y}',roadUrl:'roads/{z}/{x}/{y}',maxZ:20,attr:'Calles'},offline:{attr:'Guardado'}},
    MAP_DETAIL_RESTORE_OPACITY:.28,getColorAreasForLoc:()=>[{}],configureRuntimeMapZoom(){},cancelRuntimeOfflineMapRefresh(){},
    drawRuntimeOfflineDetails(){},updateButtons(){},setStatus(){},
    updateRuntimeVectorRoadOverlay:()=>updates.push('roads'),updateRuntimeReferenceOverlay:()=>updates.push('refs'),
    getRuntimeRoadTileSource(){throw new Error('Hidden road tiles must not load');},getRuntimeLabelTileSource(){throw new Error('Hidden label tiles must not load');},
    L:{tileLayer(url,options){const layer={url,options,addTo(){tiles.push(this);return this;},on(){return this;}};return layer;}}});
  c.window=c;vm.runInContext(extract('changeView'),c);c.changeView('g-road',true);
  assert.equal(tiles.length,2);assert.deepEqual(tiles.map(t=>t.url),['base/{z}/{x}/{y}','base/{z}/{x}/{y}']);
  assert.equal(tiles[1].options.pane,'territoryRestorePane');assert.equal(tiles[1].options.opacity,.28);
  assert.equal(c.roadOverlayLayer,null);assert.equal(c.labelOverlayLayer,null);assert.deepEqual(updates,['roads','refs']);
  c.changeView('offline',true);assert.equal(removed.length,2);assert.equal(tiles.length,2);
  assert.equal(c.tileLayer,null);assert.equal(c.colorRestoreLayer,null);assert.deepEqual(updates,['roads','refs','roads','refs']);
});
