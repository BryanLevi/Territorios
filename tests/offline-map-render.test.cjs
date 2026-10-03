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
  throw new Error(name);
}
const helperNames=['isWaterway','boxesOverlap','canPlaceLabel','runtimeRoadLabelPriority','runtimeRoadLabelRuns','planRuntimeRoadLabels',
  'runtimeOfflineAreaStyle','prepareRuntimeOfflineAreas','runtimeOfflineAreaVisible','runtimeOfflinePoint','runtimeOfflineNameBox','runtimeOfflinePlaceOffsets',
  'referenceLabelText','planRuntimeOfflineMapLabels'];
function context(extra={}){
  const c=vm.createContext({referenceKey:ref=>ref.name+'@'+ref.lat+','+ref.lng,...extra});
  vm.runInContext(helperNames.map(extract).join('\n'),c);return c;
}
function map(zoom=16,offset=0,scale=1){return{getSize:()=>({x:375,y:520}),getZoom:()=>zoom,
  latLngToContainerPoint:p=>({x:(Array.isArray(p)?p[1]:p.lng)*scale-offset,y:(Array.isArray(p)?p[0]:p.lat)*scale}),
  containerPointToLatLng:p=>({lat:p.y/scale,lng:(p.x+offset)/scale})};}
const street=(name,y)=>({name,highway:'residential',latLngs:[{lat:y,lng:20},{lat:y,lng:340}]});
const area=(id,kind,left,top,width=12,height=12)=>({id,kind,name:'',rings:[[[top,left],[top,left+width],[top+height,left+width],[top+height,left],[top,left]]]});
const plain=value=>JSON.parse(JSON.stringify(value));

test('edificios visibles desde zoom15 según tamaño y áreas verdes/agua conservan sus huecos',()=>{
  const c=context(),building=area('b','building',20,20),tiny=area('s','building',22,22,.1,.1);
  const park=area('p','park',10,10,40,40);park.rings.push([[20,20],[20,30],[30,30],[30,20],[20,20]]);
  const prepared=c.prepareRuntimeOfflineAreas({areas:[building,tiny,park],places:[]});
  assert.equal(prepared[0].area.kind,'park');
  assert.equal(c.runtimeOfflineAreaVisible(map(15),prepared.find(p=>p.area.id==='b')),true);
  assert.equal(c.runtimeOfflineAreaVisible(map(15),prepared.find(p=>p.area.id==='s')),false);
  assert.equal(c.runtimeOfflineAreaVisible(map(14),prepared.find(p=>p.area.id==='b')),false);
  assert.equal(c.runtimeOfflineAreaVisible(map(14),prepared[0]),true);
  assert.deepEqual(plain(prepared[0].area.rings),park.rings);
  assert.equal(c.runtimeOfflineAreaStyle('water').fillRule,'evenodd');
  assert.equal(c.runtimeOfflineAreaStyle('building').interactive,false);
  assert.match(html,/runtimeOfflineDetailPane'\)\.style\.zIndex=300/);
});

test('detalles filtran por viewport y reutilizan la misma geometría al desplazar y acercar',()=>{
  let created=0;const active=new Set(),layer={clearLayers(){active.clear();},hasLayer:p=>active.has(p),removeLayer:p=>active.delete(p)};
  const c=context({map:map(16),currentView:'offline',runtimeOfflineAreaLayer:layer,
    L:{polygon(rings,options){created++;return{rings,options,addTo(){active.add(this);return this;}};}}});
  vm.runInContext(extract('drawRuntimeOfflineDetails'),c);
  const details={areas:[area('near','building',40,60),area('far','building',600,60),area('green','park',20,150)],places:[]};
  c.drawRuntimeOfflineDetails(details);assert.equal(created,2);assert.equal(active.size,2);
  const original=layer._shapes.get('near');
  c.map=map(17,500);c.drawRuntimeOfflineDetails(details);assert.equal(created,3);assert.equal(active.size,1);
  c.map=map(16);c.drawRuntimeOfflineDetails(details);assert.equal(created,3);assert.equal(layer._shapes.get('near'),original);assert.equal(active.size,2);
  c.currentView='g-road';c.drawRuntimeOfflineDetails(null);assert.equal(active.size,0);
});

test('nombres de calles, localidades y POI comparten colisiones y respetan números/manuales',()=>{
  const c=context(),reserved=[{left:140,right:225,top:180,bottom:215}];
  const plan=c.planRuntimeOfflineMapLabels(map(),[street('Libertad',200),street('Avenida Uno',300)],
    [{name:'Escuela del Centro',kind:'Escuela',lat:370,lng:90},{name:'Parque Central',kind:'Parque',lat:120,lng:260}],
    [{name:'Ixhuatlán del Café',kind:'town',lat:60,lng:190}],reserved);
  assert.ok(plan.roads.length);assert.ok(plan.places.length);assert.ok(plan.references.length);
  const labels=[...plan.roads,...plan.places,...plan.references];
  for(let i=0;i<labels.length;i++){
    assert.equal(c.boxesOverlap(labels[i].box,reserved[0],5),false);
    for(let j=i+1;j<labels.length;j++)assert.equal(c.boxesOverlap(labels[i].box,labels[j].box,5),false);
  }
  assert.equal(plan.roads.some(label=>label.name==='Libertad'),false);
});

test('zoom controla barrios y POI, datos fuera del viewport no desplazan nombres visibles',()=>{
  const c=context(),places=[{name:'Colonia Norte',kind:'neighbourhood',lat:120,lng:190},{name:'Lejos',kind:'town',lat:4000,lng:4000}];
  const refs=[{name:'Farmacia Norte',lat:300,lng:170}];
  const low=c.planRuntimeOfflineMapLabels(map(14),[],refs,places);
  assert.equal(low.places.length,0);assert.equal(low.references.length,0);
  const detail=c.planRuntimeOfflineMapLabels(map(16),[],refs,places);
  assert.equal(detail.places.length,1);assert.equal(detail.places[0].name,'Colonia Norte');assert.equal(detail.references.length,1);
  const status=c.planRuntimeOfflineMapLabels(map(16),[],[{name:'Farmacia Norte abierto hasta las 9',lat:300,lng:170}],[]);
  assert.equal(status.references[0].name,'Farmacia Norte');
});

test('plan final es estable cuando calles y referencias llegan en diferente orden',()=>{
  const c=context(),ways=[street('Uno',100),street('Dos',300)],refs=[{name:'Clínica',lat:220,lng:160},{name:'Panadería',lat:420,lng:160}];
  const first=c.planRuntimeOfflineMapLabels(map(),ways,refs,[]);
  const second=c.planRuntimeOfflineMapLabels(map(),ways.slice().reverse(),refs.slice().reverse(),[]);
  assert.deepEqual(plain(first),plain(second));
});

test('Ixhuatlán encuentra el hueco real cercano aunque sus tres posiciones iniciales estén ocupadas',()=>{
  const c=context(),place={name:'Ixhuatlán del Café',kind:'town',lat:19.050833,lng:-96.984167};
  const reserved=[[600,632,404,428],[775,807,311,335],[584,616,292,316],[735,767,380,404],
    [662,694,357,381],[635,667,332,356],[678,710,274,298],[708,740,337,361]]
    .map(([left,right,top,bottom])=>({left,right,top,bottom}));
  const coordinates=[[19.030082,-97.00906535],[19.0511998,-96.98356385],[19.05283495,-96.98449085],
    [19.0497709,-96.97741735],[19.04965275,-96.97713465],[19.0496182,-96.97673595],
    [19.02827855,-97.00850365],[19.0520558,-96.98448055],[19.04945385,-96.976093],
    [19.0521051,-96.9849139],[19.0488688,-96.9866381],[19.0475656,-96.9855782],
    [19.05084465,-96.98538095],[19.050824,-96.9841434]];
  const references=coordinates.map(([lat,lng],i)=>({name:'Referencia '+i,lat,lng}));
  const project=(lat,lng)=>({x:(lng+180)/360*2**14*256,
    y:(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*2**14*256});
  const origin=project(place.lat,place.lng),anchor={x:695,y:328};
  const target={getSize:()=>({x:1440,y:705}),getZoom:()=>14,latLngToContainerPoint:pair=>{
    const p=project(pair[0],pair[1]);return{x:p.x-origin.x+anchor.x,y:p.y-origin.y+anchor.y};}};
  const obstacles=reserved.concat(references.map(ref=>c.runtimeOfflineNameBox(target.latLngToContainerPoint([ref.lat,ref.lng]),16,16)));
  for(const offset of [0,-18,18]) assert.equal(c.canPlaceLabel(c.runtimeOfflineNameBox({x:anchor.x,y:anchor.y+offset},191.6,24.06),obstacles,5),false);
  const planned=c.planRuntimeOfflineMapLabels(target,[],references,[place],reserved);
  assert.equal(planned.places.length,1);assert.equal(planned.places[0].name,place.name);
  assert.equal(planned.places[0].point.x,anchor.x);assert.equal(planned.places[0].point.y,anchor.y-72);
  assert.equal(c.canPlaceLabel(planned.places[0].box,obstacles,5),true);
  assert.deepEqual(place,{name:'Ixhuatlán del Café',kind:'town',lat:19.050833,lng:-96.984167});
});

test('una localidad cerca del borde prueba un hueco lateral sin mover su nodo ni tapar etiquetas',()=>{
  const c=context(),place={name:'Ixhuatlán del Café',kind:'town',lat:120,lng:30};
  const planned=c.planRuntimeOfflineMapLabels(map(14),[],[],[place],[]),label=planned.places[0];
  assert.ok(label);assert.ok(label.box.left>=5);assert.ok(Math.hypot(label.point.x-30,label.point.y-120)<=136);
  assert.equal(place.lng,30);assert.equal(place.lat,120);
  assert.equal(c.runtimeOfflinePlaceOffsets('hamlet').length,3,'Un caserío pequeño no se desplaza como una localidad extensa');
});

test('descarga antigua sin details sigue dibujando calles y referencias sin nuevas solicitudes',async()=>{
  let drawn=0,refresh=0;
  const c=vm.createContext({map:{},vectorRoadLayer:{clearLayers(){}},runtimeOfflineLabelLayer:null,runtimeRoadRequestId:0,
    LOCS:[{num:1}],currentIndex:0,currentView:'offline',congregacionActivaId:'a',runtimeRoadCache:null,
    getRuntimeRoadCacheKey:loc=>String(loc.num),unpackRoadWays:roads=>roads,drawRuntimeVectorRoads(){drawn++;},
    drawRuntimeOfflineDetails(){},refreshRuntimeOfflineMap(){refresh++;},setStatus(){},
    window:{CroquisOfflineData:{get:async()=>({roads:[{name:'Libertad'}],refs:[]})},CroquisOfflineDetails:{valid:()=>false}}});
  vm.runInContext(extract('updateRuntimeVectorRoadOverlay'),c);await c.updateRuntimeVectorRoadOverlay();
  assert.equal(drawn,1);assert.equal(refresh,1);assert.equal(c.runtimeRoadCache.details,null);assert.equal(c.runtimeRoadCache.roadWays[0].name,'Libertad');
});

test('referencias offline usan memoria y un resultado tardío no cruza vista, territorio ni congregación',async()=>{
  for(const changed of ['view','territory','congregation']){
    let resolve,draws=0,reads=0;
    const c=vm.createContext({map:{},runtimeReferenceLayer:{clearLayers(){}},runtimeReferenceRequestId:0,runtimeReferenceCache:null,
      LOCS:[{num:1},{num:2}],currentIndex:0,currentView:'offline',congregacionActivaId:'a',
      getRuntimeRoadCacheKey:loc=>String(loc.num),dedupeReferences:v=>v,drawRuntimeReferences(){draws++;},
      window:{CroquisOfflineData:{get:()=>{reads++;return new Promise(done=>{resolve=done;});}}}});
    vm.runInContext(extract('updateRuntimeReferenceOverlay'),c);
    const pending=c.updateRuntimeReferenceOverlay();
    if(changed==='view')c.currentView='g-road';if(changed==='territory')c.currentIndex=1;if(changed==='congregation')c.congregacionActivaId='b';
    resolve({refs:[{name:'Clínica anterior'}]});await pending;
    assert.equal(draws,0,changed);assert.equal(c.runtimeReferenceCache,null,changed);assert.equal(reads,1);
    c.currentView='offline';c.currentIndex=0;c.congregacionActivaId='a';
    c.runtimeReferenceCache={key:'ref:1',congregationId:'a',offline:true,references:[{name:'Clínica'}]};
    await c.updateRuntimeReferenceOverlay();await c.updateRuntimeReferenceOverlay();
    assert.equal(reads,1);assert.equal(draws,2);
  }
});

test('etiquetas extra son no interactivas y sólo se crean offline, con texto escapado y halo',()=>{
  const markers=[],layer={clearLayers(){},addTo(){return this;}};
  const c=vm.createContext({map:map(),currentView:'offline',LOCS:[{num:1}],currentIndex:0,congregacionActivaId:'a',
    runtimeRoadCache:{key:'1',congregation:'a',offline:true,roadWays:[],details:{areas:[],places:[]}},
    runtimeOfflineAreaLayer:layer,runtimeOfflineLabelLayer:layer,getRuntimeRoadCacheKey:loc=>String(loc.num),
    drawRuntimeOfflineDetails(){},runtimeOfflineVisibleReferences:()=>[],runtimeOfflineReservedLabels:()=>[],drawRuntimeOfflineStreetLabels(){},
    planRuntimeOfflineMapLabels:()=>({roads:[],places:[{point:{x:70,y:70},fontSize:12,width:100,name:'<Barrio>'}],references:[]}),
    escapeHtml:value=>value.replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    L:{divIcon:icon=>icon,marker(point,options){markers.push({point,options});return{addTo(){}};}}});
  vm.runInContext(extract('refreshRuntimeOfflineMap'),c);c.refreshRuntimeOfflineMap();
  assert.equal(markers.length,1);assert.equal(markers[0].options.interactive,false);assert.equal(markers[0].options.keyboard,false);
  assert.match(markers[0].options.icon.html,/&lt;Barrio&gt;/);assert.match(html,/\.runtime-offline-name span\{[^}]*text-shadow:/);
  c.currentView='g-road';c.refreshRuntimeOfflineMap();assert.equal(markers.length,1);
});
