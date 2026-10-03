const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');

function extract(name){
  let start=html.indexOf('function '+name+'(');assert(start>=0,name);
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
const point=(lat,lng)=>({lat,lng});
const way=properties=>({name:'',latLngs:[point(19,-96),point(19.01,-96.01)],...properties});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,actual+' should equal '+expected);
function harness(view='offline'){
  const renderer={kind:'shared-offline-canvas'},calls={lines:[],clears:0,streetLabels:0,waterLabels:0};
  const group={_renderer:renderer,clearLayers(){calls.clears++;}};
  const c=vm.createContext({currentView:view,currentIndex:0,LOCS:[{num:1}],map:{},vectorRoadLayer:group,
    getColorAreasForLoc:()=>[],getPrintRoadLabelPlacement:()=>null,
    TILES:{offline:{sinNombres:true},'g-sat':{sinNombres:true},'g-road':{sinNombres:false}},
    VECTOR_ROAD_LABEL_OPACITY:.8,WATERWAY_OVERLAY_OPACITY:.8,
    WATERWAY_CASING_COLOR:'#e3f4ff',WATERWAY_COLOR:'#3086c8',CARRETERA_ORILLA:'#5c7069',
    drawRuntimeOfflineStreetLabels(){calls.streetLabels++;},drawRuntimeWaterwayLabels(){calls.waterLabels++;},
    L:{polyline(points,options){const line={points,options,target:null};calls.lines.push(line);return{addTo(target){line.target=target;return this;}};}}});
  c.window=c;
  vm.runInContext(['isWaterway','waterwayWeight','drawRuntimeWaterways','drawRuntimeVectorRoads',
    'drawWhiteRoadPolyline','drawManualRiverPolyline','drawPrintManualRivers','drawPrintManualWhiteRoads'].map(extract).join('\n'),c);
  return{c,calls,renderer,group};
}

test('calles y ríos offline comparten un Canvas sin cambiar geometría, casings, colores o trazos discontinuos',()=>{
  const h=harness(),streets=[way({highway:'primary'}),way({highway:'residential'}),way({highway:'path'})];
  const river=way({waterway:'river',intermittent:true}),invalid=way({highway:'primary',latLngs:[point(19,-96)]});
  h.c.drawRuntimeVectorRoads([...streets,river,invalid]);
  assert.equal(h.calls.lines.length,8);assert.equal(h.calls.streetLabels,1);assert.equal(h.calls.waterLabels,1);
  for(const line of h.calls.lines){
    assert.equal(line.options.renderer,h.renderer);assert.equal(line.options.pane,'territoryRoadPane');
    assert.equal(line.options.interactive,false);assert.equal(line.options.lineCap,'round');assert.equal(line.options.lineJoin,'round');
    assert.equal(line.target,h.group);
  }
  for(const [index,weight] of [[0,5],[1,3.2],[2,1.8]]){
    const casing=h.calls.lines[index*2],stroke=h.calls.lines[index*2+1];
    assert.equal(casing.points,streets[index].latLngs);assert.equal(stroke.points,casing.points);
    close(casing.options.weight,weight+2.2);close(stroke.options.weight,weight);
    assert.equal(casing.options.color,'#9ca79d');assert.equal(casing.options.opacity,.82);assert.equal(stroke.options.opacity,.98);
    assert.equal(stroke.options.color,index===2?'#e7e5d8':'#fff');assert.equal(stroke.options.dashArray,index===2?'4,5':null);
  }
  const riverCasing=h.calls.lines[6],riverStroke=h.calls.lines[7];
  assert.equal(riverCasing.points,river.latLngs);assert.equal(riverStroke.points,river.latLngs);
  close(riverCasing.options.weight,9);close(riverStroke.options.weight,5.6);
  assert.equal(riverCasing.options.color,h.c.WATERWAY_CASING_COLOR);assert.equal(riverStroke.options.color,h.c.WATERWAY_COLOR);
  close(riverCasing.options.opacity,.59);close(riverStroke.options.opacity,.55);assert.equal(riverStroke.options.dashArray,'9,7');
});

test('el renderer compartido se conserva al vaciar/reconstruir caminos y al dibujar agua continua o intermitente',()=>{
  const h=harness(),stream=way({waterway:'stream'}),ditch=way({waterway:'ditch',intermittent:true});
  h.c.drawRuntimeWaterways([stream,ditch],.9);
  assert.equal(h.calls.lines.length,4);assert.equal(h.calls.lines[1].options.dashArray,null);assert.equal(h.calls.lines[3].options.dashArray,'9,7');
  close(h.calls.lines[0].options.weight,7.4);close(h.calls.lines[2].options.weight,6.6);
  h.c.drawRuntimeVectorRoads([way({highway:'residential'})]);h.c.drawRuntimeVectorRoads([]);
  assert.equal(h.group._renderer,h.renderer);assert.equal(h.calls.clears,2);
  assert.ok(h.calls.lines.every(line=>line.options.renderer===h.renderer));
});

test('online conserva el renderer predeterminado y no añade calles de la copia offline',()=>{
  for(const view of ['g-road','g-sat']){
    const h=harness(view),river=way({waterway:'river'});
    h.c.drawRuntimeVectorRoads([way({highway:'residential'}),river]);
    assert.equal(h.calls.streetLabels,0);assert.equal(h.calls.lines.length,view==='g-sat'?2:0);
    assert.ok(h.calls.lines.every(line=>line.options.renderer===undefined));
    h.c.drawRuntimeWaterways([river],.5);
    assert.ok(h.calls.lines.every(line=>line.options.renderer===undefined));assert.equal(h.group._renderer,h.renderer);
  }
});

test('carreteras y ríos manuales mantienen su pane y renderer normal aunque la vista esté offline',()=>{
  const h=harness(),manualRenderer={kind:'manual-svg'},target={_renderer:manualRenderer},points=[point(19,-96),point(19.01,-96.01)];
  h.c.drawWhiteRoadPolyline(target,points,8,'territoryRoadPane',1,'#ffdc28');
  h.c.drawManualRiverPolyline(target,points,6,'territoryRiverPane');
  assert.equal(h.calls.lines.length,4);assert.equal(target._renderer,manualRenderer);
  for(const line of h.calls.lines){assert.equal(line.target,target);assert.equal(line.options.renderer,undefined);assert.equal(line.points,points);}
  assert.equal(h.calls.lines[0].options.pane,'territoryRoadPane');assert.equal(h.calls.lines[1].options.color,'#ffdc28');
  assert.equal(h.calls.lines[2].options.pane,'territoryRiverPane');assert.equal(h.calls.lines[3].options.color,h.c.WATERWAY_COLOR);
});

test('los trazos del PDF usan su mapa, escala y pane de impresión sin heredar el Canvas runtime',()=>{
  const h=harness(),printRenderer={kind:'print-svg'},printMap={options:{renderer:printRenderer},getPane:name=>name==='territoryWhiteRoadPane'?{}:null};
  h.c.getManualRiversForLoc=()=>[{width:6,points:[[19,-96],[19.01,-96.01]]}];
  h.c.getWhiteRoadsForLoc=()=>[{width:8,points:[[19,-96],[19.01,-96.01]],color:'#ffdc28'}];
  h.c.pointsToLatLngs=points=>points.map(([lat,lng])=>point(lat,lng));h.c.printVectorRoadScale=()=>2;
  h.c.drawPrintManualRivers(printMap,{num:1});h.c.drawPrintManualWhiteRoads(printMap,{num:1});
  assert.equal(h.calls.lines.length,4);assert.equal(printMap.options.renderer,printRenderer);
  for(const line of h.calls.lines){assert.equal(line.target,printMap);assert.equal(line.options.renderer,undefined);assert.equal(line.options.pane,'territoryWhiteRoadPane');}
  assert.equal(h.calls.lines[1].options.weight,12);assert.equal(h.calls.lines[3].options.weight,16);assert.equal(h.group._renderer,h.renderer);
});
