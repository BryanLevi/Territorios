const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
const pack=JSON.parse(fs.readFileSync(path.join(__dirname,'../outputs/offline-map-pack.json'),'utf8'));

function extract(name){
  let start=html.indexOf('function '+name+'(');
  assert(start>=0,name);
  if(html.slice(start-6,start)==='async ') start-=6;
  const opening=html.indexOf('{',start);
  let level=0,quote=null;
  for(let i=opening;i<html.length;i++){
    const c=html[i], next=html[i+1];
    if(quote){ if(c==='\\') i++; else if(c===quote) quote=null; continue; }
    if(c==='/'&&next==='/'){ i=html.indexOf('\n',i); continue; }
    if(c==='/'&&next==='*'){ i=html.indexOf('*/',i+2)+1; continue; }
    if(c==='"'||c==="'"||c==='`'){ quote=c; continue; }
    if(c==='{') level++;
    if(c==='}'&&--level===0) return html.slice(start,i+1);
  }
  throw new Error('Incomplete '+name);
}
const helpers=['isWaterway','boxesOverlap','canPlaceLabel','runtimeRoadLabelPriority','runtimeRoadLabelRuns','planRuntimeRoadLabels'];
function planner(){
  const context=vm.createContext({});
  vm.runInContext(helpers.map(extract).join('\n'),context);
  return context;
}
function map(zoom=16,offset=0){
  return {getSize:()=>({x:375,y:520}),getZoom:()=>zoom,
    latLngToContainerPoint:p=>({x:p.lng-offset,y:p.lat})};
}
function street(name,points,kind='residential'){
  return {name,highway:kind,latLngs:points.map(([x,y])=>({lat:y,lng:x}))};
}

test('rotula calles de muchos tramos cortos continuos y mantiene la orientación legible',()=>{
  const p=planner();
  const ways=[street('Avenida Independencia',[[25,180],[60,180],[95,180],[130,180],[165,180],[200,180],[235,180],[270,180]])];
  const labels=p.planRuntimeRoadLabels(map(),ways);
  assert.equal(labels.length,1);
  assert.equal(labels[0].name,'Avenida Independencia');
  assert.equal(labels[0].angle,0);
  const reversed=p.planRuntimeRoadLabels(map(),[street('Libertad',[[230,80],[120,210],[50,290]])]);
  assert.equal(reversed.length,1);
  assert(reversed[0].angle>=-90&&reversed[0].angle<=90);
});

test('recorta la calle a la vista actual y al desplazarla busca un nombre dentro de la pantalla',()=>{
  const p=planner();
  const ways=[street('Calle 5 de Mayo',[[-800,200],[-400,200],[0,200],[400,200],[800,200]])];
  const first=p.planRuntimeRoadLabels(map(),ways);
  const moved=p.planRuntimeRoadLabels(map(16,380),ways);
  assert.equal(first.length,1);
  assert.equal(moved.length,1);
  for(const label of [...first,...moved]){
    assert(label.box.left>=3&&label.box.right<=372);
    assert(label.point.x>=0&&label.point.x<=375);
  }
});

test('evita nombres duplicados y cruces, prioriza avenidas y limita la densidad móvil',()=>{
  const p=planner();
  const ways=[street('Calle Uno',[[50,120],[300,120]]),street('Calle Uno',[[50,250],[300,250]]),
    street('Avenida Dos',[[175,10],[175,450]],'primary'),street('Sin nombre',[[0,500],[1,500]])];
  for(let i=0;i<160;i++) ways.push(street('Calle '+i,[[20,20+i*3],[340,20+i*3]]));
  const labels=p.planRuntimeRoadLabels(map(),ways);
  assert.equal(labels.filter(label=>label.name==='Calle Uno').length<=1,true);
  assert.equal(labels[0].name,'Avenida Dos');
  assert(labels.length<=57);
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++){
    assert.equal(p.boxesOverlap(labels[i].box,labels[j].box,7),false);
  }
});

test('al acercar aparecen caminos secundarios y cambia el tamaño sin inventar nombres',()=>{
  const p=planner();
  const ways=[street('Vereda Cruz Verde',[[30,180],[330,180]],'path'),street('',[[30,250],[330,250]])];
  assert.equal(p.planRuntimeRoadLabels(map(14),ways).length,0);
  const nearby=p.planRuntimeRoadLabels(map(18),ways);
  assert.equal(nearby.length,1);
  assert.equal(nearby[0].name,'Vereda Cruz Verde');
  assert.equal(nearby[0].fontSize,12);
});

test('las descargas existentes conservan nombres reales y el paquete local ofrece calles rotulables',()=>{
  const p=planner();
  vm.runInContext(extract('unpackRoadWays'),p);
  p.L={latLng:(lat,lng)=>({lat,lng})};
  const territory=pack.territories.find(entry=>entry.name==='Ixhuatlán del Café');
  const ways=p.unpackRoadWays(territory.roads);
  assert(ways.some(way=>way.name==='Avenida Independencia'));
  const named=new Set(ways.map(way=>way.name));
  const center={lat:19.048889,lng:-96.981944},zoom=16,scale=256*Math.pow(2,zoom);
  const project=point=>({x:(point.lng+180)/360*scale,
    y:(1-Math.log(Math.tan(point.lat*Math.PI/180)+1/Math.cos(point.lat*Math.PI/180))/Math.PI)/2*scale});
  const origin=project(center);
  const live={getSize:()=>({x:375,y:520}),getZoom:()=>zoom,
    latLngToContainerPoint:point=>{ const xy=project(point); return {x:xy.x-origin.x+187.5,y:xy.y-origin.y+260}; }};
  const labels=p.planRuntimeRoadLabels(live,ways);
  assert(labels.length>=3,'Deben verse varias calles reales en el centro, no solo tramos largos');
  assert(labels.every(label=>named.has(label.name)));
});

test('zoom y desplazamiento reutilizan los datos sin borrar las calles ni leer otra descarga',async()=>{
  let reads=0,clears=0,labels=0;
  const context=vm.createContext({map:{},vectorRoadLayer:{_streetLabels:{},hasLayer:()=>true,clearLayers(){clears++;}},runtimeRoadRequestId:0,
    LOCS:[{num:1}],currentIndex:0,currentView:'offline',congregacionActivaId:'a',
    runtimeRoadCache:{key:'1',congregation:'a',offline:true,roadWays:[{name:'Libertad'}]},
    getRuntimeRoadCacheKey:loc=>String(loc.num),drawRuntimeOfflineStreetLabels:()=>labels++,
    window:{CroquisOfflineData:{get:async()=>{reads++;return null;}}}});
  vm.runInContext(extract('updateRuntimeVectorRoadOverlay'),context);
  await context.updateRuntimeVectorRoadOverlay();
  await context.updateRuntimeVectorRoadOverlay();
  assert.equal(labels,2);
  assert.equal(reads,0);
  assert.equal(clears,0);
});

test('una descarga que termina después de cambiar congregación, territorio o base no dibuja nombres anteriores',async()=>{
  for(const changed of ['congregation','territory','base']){
    let resolve,drawn=0;
    const context=vm.createContext({map:{},vectorRoadLayer:{clearLayers(){}},runtimeRoadRequestId:0,
      LOCS:[{num:1},{num:2}],currentIndex:0,currentView:'offline',congregacionActivaId:'a',runtimeRoadCache:null,
      getRuntimeRoadCacheKey:loc=>String(loc.num),unpackRoadWays:ways=>ways,
      drawRuntimeVectorRoads:()=>drawn++,setStatus(){},
      window:{CroquisOfflineData:{get:()=>new Promise(done=>{resolve=done;})}}});
    vm.runInContext(extract('updateRuntimeVectorRoadOverlay'),context);
    const pending=context.updateRuntimeVectorRoadOverlay();
    if(changed==='congregation') context.congregacionActivaId='b';
    if(changed==='territory') context.currentIndex=1;
    if(changed==='base') context.currentView='g-road';
    resolve({roads:[{name:'Calle anterior'}]});
    await pending;
    assert.equal(drawn,0,changed);
    assert.equal(context.runtimeRoadCache,null,changed);
  }
});

test('si se vació la capa, la caché restaura calles y nombres juntos al volver al mapa descargado',async()=>{
  let restored=0,reads=0;
  const context=vm.createContext({map:{},vectorRoadLayer:{_streetLabels:{},hasLayer:()=>false,clearLayers(){}},
    runtimeRoadRequestId:0,LOCS:[{num:1}],currentIndex:0,currentView:'offline',congregacionActivaId:'a',
    runtimeRoadCache:{key:'1',congregation:'a',offline:true,roadWays:[{name:'Libertad'}]},
    getRuntimeRoadCacheKey:loc=>String(loc.num),drawRuntimeOfflineStreetLabels:()=>assert.fail('No hay capa de calles'),
    drawRuntimeVectorRoads:ways=>{restored++;assert.equal(ways[0].name,'Libertad');},
    window:{CroquisOfflineData:{get:async()=>{reads++;return null;}}}});
  vm.runInContext(extract('updateRuntimeVectorRoadOverlay'),context);
  await context.updateRuntimeVectorRoadOverlay();
  assert.equal(restored,1);
  assert.equal(reads,0);
});

test('los nombres se dibujan con halo y sin interceptar selección ni recibir foco',()=>{
  const p=planner(),created=[];
  const layer={clearLayers(){},addTo(){return this;}};
  p.map={containerPointToLatLng:point=>point};
  p.vectorRoadLayer={_streetLabels:layer,hasLayer:()=>true};
  p.window={L:{}};
  p.planRuntimeRoadLabels=()=>[{name:'Avenida Independencia',angle:-45,fontSize:12,point:{x:130,y:200}}];
  p.escapeHtml=text=>text;
  p.L={marker:(point,options)=>{created.push({point,options});return {addTo(){}};},divIcon:icon=>icon};
  vm.runInContext(extract('drawRuntimeOfflineStreetLabels'),p);
  p.drawRuntimeOfflineStreetLabels([]);
  assert.equal(created.length,1);
  assert.equal(created[0].options.interactive,false);
  assert.equal(created[0].options.keyboard,false);
  assert.equal(created[0].options.pane,'territoryLabelPane');
  assert.match(created[0].options.icon.html,/Avenida Independencia/);
  assert.match(created[0].options.icon.className,/is-offline/);
  assert.match(html,/\.runtime-vector-road-label\.is-offline span\{[^}]*text-shadow:/);
});
