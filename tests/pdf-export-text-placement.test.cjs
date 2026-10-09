const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function extractFunction(name){
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `Function available: ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0, quote = null;
  for(let i = open; i < html.length; i++){
    const char = html[i], next = html[i + 1];
    if(quote){
      if(char === '\\'){ i++; continue; }
      if(char === quote) quote = null;
      continue;
    }
    if(char === '/' && next === '/'){ i = html.indexOf('\n', i); continue; }
    if(char === '/' && next === '*'){ i = html.indexOf('*/', i + 2) + 1; continue; }
    if(char === '"' || char === "'" || char === '`'){ quote = char; continue; }
    if(char === '{') depth++;
    if(char === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Incomplete function: ${name}`);
}
const functions = ['isPrintZoneNumber', 'splitColonyLabelText', 'printOwnTextPoints',
  'printOwnTextStyle', 'getPrintOwnTextExportBoundsPlain', 'medidaDeNombresImpresos',
  'buildPrintZoneShapes', 'isInsidePrintZones', 'recolocarNumerosImpresos'].map(extractFunction).join('\n');
const copy = value => JSON.parse(JSON.stringify(value));
function environment(labels = [], areas = []){
  const context = vm.createContext({
    printRenderScale:3,
    PRINT_ZONE_NUMBER_SIZE_PT:Number(html.match(/const PRINT_ZONE_NUMBER_SIZE_PT\s*=\s*([\d.]+)\s*;/)[1]),
    getTextLabelsForLoc:() => labels,
    getExportColorAreasForLoc:() => areas,
    medidaDeLasZonas:() => ({x0:100,y0:200,x1:700,y1:800})
  });
  vm.runInContext(functions, context);
  return context;
}
function cssProperties(css){
  return Object.fromEntries(css.split(';').filter(s => s.includes(':')).map(s => {
    const colon = s.indexOf(':');
    return [s.slice(0,colon).trim(),s.slice(colon+1).trim()];
  }));
}
function intersects(a,b){
  return Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))
    * Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
}
function exportMap(labels, names, areas, options = {}){
  const size = {x:1000,y:1000}, containerWidth = options.containerWidth || 1000;
  const containerRect = {left:50,top:100,width:containerWidth,height:containerWidth};
  const placements = labels.map(label => {
    let position = {lat:label.lat,lng:label.lng};
    const calls = [];
    const marker = {
      setLatLng:value => {
        position = Array.isArray(value) ? {lat:value[0],lng:value[1]} : {...value};
        calls.push({...position});
        return marker;
      },
      getLatLng:() => ({...position}),
      getElement:() => ({querySelector:selector => {
        assert.equal(selector,'.print-zone-number');
        return {getBoundingClientRect:() => {
          const scale=containerWidth/size.x, width=20*scale, height=14*scale;
          return {left:50+position.lng*scale-width/2,top:100+position.lat*scale-height/2,
            right:50+position.lng*scale+width/2,bottom:100+position.lat*scale+height/2,width,height};
        }};
      }})
    };
    return {label,marker,calls,box:() => ({x0:position.lng-12,x1:position.lng+12,
      y0:position.lat-9,y1:position.lat+9})};
  });
  const map = {
    _printNameBoxes:names,
    _printTextMarkers:placements,
    _printLoc:{num:1},
    getSize:() => size,
    getContainer:() => ({getBoundingClientRect:() => containerRect}),
    latLngToContainerPoint:point => ({x:Number(point[1]),y:Number(point[0])}),
    latLngToLayerPoint:point => ({x:Number(point[1]),y:Number(point[0])}),
    containerPointToLayerPoint:point => Array.isArray(point) ? {x:point[0],y:point[1]} : {...point},
    containerPointToLatLng:point => ({lat:point.y,lng:point.x})
  };
  return {context:environment(labels,areas),map,placements};
}

test('The PDF crop includes the complete measured names beyond its original mask margin', () => {
  const context=environment(), names=Object.freeze([
    Object.freeze({x0:40,y0:240,x1:140,y1:270}),
    Object.freeze({x0:650,y0:730,x1:920,y1:890})
  ]);
  const map={_printNameBleed:12,_printNameBoxes:names};
  const snapshot=JSON.stringify(names);
  assert.deepEqual(copy(context.medidaDeNombresImpresos(map,{num:1})),{x0:40,y0:188,x1:920,y1:890});
  assert.equal(JSON.stringify(names),snapshot,'Measured names are never rewritten by the crop');
  const withoutNames={_printNameBleed:12,_printNameBoxes:[]};
  assert.deepEqual(copy(context.medidaDeNombresImpresos(withoutNames,{num:1})),{x0:88,y0:188,x1:712,y1:812});
});

test('Unreadable raster ink preserves the full layer instead of cutting names at a guessed margin', () => {
  const context=environment();
  for(const reason of ['canvas-unreadable','unavailable','missing-tiles']){
    const map={_printNameBleed:12,_printNameBoxes:[],_printNameDetection:{reason},getSize:()=>({x:1000,y:950})};
    assert.deepEqual(copy(context.medidaDeNombresImpresos(map,{num:1})),{x0:0,y0:0,x1:1000,y1:950});
  }
});

test('Long multiline text outside the territory reserves full text dimensions at both page scales', () => {
  const labels=Object.freeze([
    Object.freeze({text:'COLONIA INDEPENDENCIA / CALLE PRINCIPAL HACIA SAN FRANCISCO',type:'texto',lat:1.2,lng:-.2,size:18}),
    Object.freeze({text:'Avenida principal\nSalida hacia Tomatlán',type:'carretera',lat:-.1,lng:1.3,size:38})
  ]);
  const context=environment(labels), original=Object.freeze({south:0,north:1,west:0,east:1});
  const snapshot=JSON.stringify(labels);
  let previous=null;
  for(const scale of [1,.5,.25]){
    const bounds=context.getPrintOwnTextExportBoundsPlain({num:1},original,scale,32);
    assert(Object.values(bounds).every(Number.isFinite));
    for(const label of labels){
      const font=context.printOwnTextPoints(label)*25.4/72;
      const lines=context.splitColonyLabelText(label.text);
      const halfWidth=(Math.max(...Array.from(lines,line => Math.min(32,line.length*font*.68)))+1.5)/2;
      const halfHeight=(Array.from(lines,line => Math.max(1,Math.ceil(line.length*font*.68/32))).reduce((a,b)=>a+b,0)*font*1.12+1.5)/2;
      assert((label.lng-bounds.west)/(bounds.east-bounds.west)*297*scale >= halfWidth);
      assert((bounds.east-label.lng)/(bounds.east-bounds.west)*297*scale >= halfWidth);
      assert((bounds.north-label.lat)/(bounds.north-bounds.south)*189*scale >= halfHeight);
      assert((label.lat-bounds.south)/(bounds.north-bounds.south)*189*scale >= halfHeight);
    }
    if(previous){
      assert(bounds.west<previous.west && bounds.east>previous.east);
      assert(bounds.south<previous.south && bounds.north>previous.north);
    }
    previous=bounds;
    assert.equal(JSON.stringify(labels),snapshot,'Export does not move the saved labels');
    assert.deepEqual(original,{south:0,north:1,west:0,east:1});
  }
});

test('Own PDF text preserves its physical font and wrapping width in large and small map frames', () => {
  const context=environment();
  for(const scale of [.2,.5,1,2]) for(const renderScale of [2,3,12]){
    const css=cssProperties(context.printOwnTextStyle(9,renderScale,scale,32));
    assert(Math.abs(parseFloat(css['font-size'])*scale/renderScale*72/96-9)<1e-9);
    assert(Math.abs(parseFloat(css['max-width'])*scale/renderScale*25.4/96-32)<1e-9);
    assert.equal(css['white-space'],'normal');
    assert.equal(css['overflow-wrap'],'break-word');
  }
});

test('A numeric badge crossing a raster name moves only its exported marker into the same territory', () => {
  const label=Object.freeze({text:'12',type:'texto',lat:500,lng:590,size:22});
  const labels=Object.freeze([label]);
  const areas=Object.freeze([
    Object.freeze({points:[[100,100],[100,600],[700,600],[700,100]]}),
    Object.freeze({points:[[100,601],[100,900],[700,900],[700,601]]})
  ]);
  const names=Object.freeze([Object.freeze({x0:550,y0:495,x1:680,y1:505})]);
  const snapshot=JSON.stringify({labels,areas,names});
  for(const containerWidth of [1000,500]){
    const {context,map,placements}=exportMap(labels,names,areas,{containerWidth});
    context.recolocarNumerosImpresos(map,1);
    const number=placements[0], point=number.marker.getLatLng(), box=number.box();
    assert(number.calls.length>1,'A colliding exported badge receives a new temporary position');
    assert.notDeepEqual(point,{lat:label.lat,lng:label.lng});
    assert.equal(intersects(box,names[0]),0,'The complete number box clears the raster name');
    assert(box.x0>=100 && box.x1<=600 && box.y0>=100 && box.y1<=700,
      'Every corner remains inside the original zone, even beside another territory');
    assert(Math.hypot(point.lat-label.lat,point.lng-label.lng)<140,'The correction stays near the saved position');
    assert(box.x0>=0 && box.y0>=0 && box.x1<=1000 && box.y1<=1000);
    assert.equal(JSON.stringify({labels,areas,names}),snapshot,'Only temporary Leaflet markers move');
  }
});

test('No raster names means no numeric marker receives a position change', () => {
  const labels=Object.freeze([Object.freeze({text:'12',lat:500,lng:500})]);
  const {context,map,placements}=exportMap(labels,[],[{points:[[100,100],[100,800],[800,800],[800,100]]}]);
  context.recolocarNumerosImpresos(map,.25);
  assert.equal(placements[0].calls.length,0);
  assert.deepEqual(placements[0].marker.getLatLng(),{lat:500,lng:500});
});

test('No free space keeps the original number inside its frame instead of moving it into another zone', () => {
  const label=Object.freeze({text:'1',lat:20,lng:20});
  const names=[{x0:-100,y0:-100,x1:1100,y1:1100}];
  const areas=[{points:[[0,0],[0,90],[90,90],[90,0]]},
    {points:[[0,100],[0,1000],[1000,1000],[1000,100]]}];
  const {context,map,placements}=exportMap([label],names,areas);
  context.recolocarNumerosImpresos(map,1);
  assert.deepEqual(placements[0].marker.getLatLng(),{lat:20,lng:20});
  assert.equal(placements[0].calls.length,1,'Only reset to the saved position; no poorer or out-of-frame candidate is accepted');
  const box=placements[0].box();
  assert(box.x0>=0 && box.y0>=0 && box.x1<=1000 && box.y1<=1000);
  assert.deepEqual(label,{text:'1',lat:20,lng:20});
});

test('Relocated exported numbers also avoid number boxes that have already been placed', () => {
  const labels=Object.freeze([
    Object.freeze({text:'12',lat:500,lng:500}),Object.freeze({text:'13',lat:500,lng:500})
  ]);
  const names=[{x0:460,y0:495,x1:540,y1:505}];
  const {context,map,placements}=exportMap(labels,names,[{points:[[100,100],[100,900],[900,900],[900,100]]}]);
  context.recolocarNumerosImpresos(map,1);
  placements.forEach(number => assert.equal(intersects(number.box(),names[0]),0));
  assert.equal(intersects(placements[0].box(),placements[1].box()),0,'Number boxes remain separately readable');
  assert.deepEqual(labels.map(label=>[label.lat,label.lng]),[[500,500],[500,500]]);
});

test('Two overlapping exported numbers separate even when the background has no raster names', () => {
  const labels=Object.freeze([
    Object.freeze({text:'12',lat:500,lng:500}),Object.freeze({text:'13',lat:500,lng:500})
  ]);
  const {context,map,placements}=exportMap(labels,[],[{points:[[100,100],[100,900],[900,900],[900,100]]}]);
  context.recolocarNumerosImpresos(map,1);
  assert.equal(intersects(placements[0].box(),placements[1].box()),0);
  assert.deepEqual(labels.map(label=>[label.lat,label.lng]),[[500,500],[500,500]]);
});

test('Relocating a number also avoids names and icons added by the user', () => {
  const labels=Object.freeze([Object.freeze({text:'12',lat:500,lng:500})]);
  const {context,map,placements}=exportMap(labels,[],[{points:[[100,100],[100,900],[900,900],[900,100]]}]);
  const mark={left:530,right:600,top:585,bottom:615,width:70,height:30};
  map.getContainer=()=>({getBoundingClientRect:()=>({left:50,top:100,width:1000,height:1000}),
    querySelectorAll:()=>[{getBoundingClientRect:()=>mark}]});
  context.recolocarNumerosImpresos(map,1);
  assert.equal(intersects(placements[0].box(),{x0:479,x1:551,y0:484,y1:516}),0);
  assert.deepEqual(labels[0],{text:'12',lat:500,lng:500});
});

test('A fully covered narrow zone moves only the exported badge outside with a physical-scale leader', () => {
  const label=Object.freeze({text:'38',lat:500,lng:500});
  const areas=Object.freeze([Object.freeze({points:[[480,480],[480,520],[520,520],[520,480]]})]);
  const {context,map,placements}=exportMap(Object.freeze([label]),[],areas);
  const mark={left:460,right:640,top:550,bottom:650,width:180,height:100};
  map.getContainer=()=>({getBoundingClientRect:()=>({left:50,top:100,width:1000,height:1000}),
    querySelectorAll:()=>[{getBoundingClientRect:()=>mark}]});
  const leaders=[];
  context.L={polyline:(points,options)=>{
    const leader={points,options,removed:false,addTo:target=>{assert.equal(target,map);leaders.push(leader);return leader;},
      remove:()=>{leader.removed=true;}};
    return leader;
  }};
  const snapshot=JSON.stringify({label,areas});
  context.recolocarNumerosImpresos(map,1);
  const box=placements[0].box(), point=placements[0].marker.getLatLng();
  assert.equal(intersects(box,{x0:409,x1:591,y0:449,y1:551}),0,
    'The complete badge clears the long own label covering its entire zone');
  assert(point.lat<480 || point.lat>520 || point.lng<480 || point.lng>520);
  assert(box.x0>=0 && box.y0>=0 && box.x1<=1000 && box.y1<=1000);
  assert.equal(leaders.length,1);
  assert.equal(map._printNumberLeaders[0],leaders[0]);
  assert.deepEqual(copy(leaders[0].points[0]),[500,500]);
  assert.deepEqual(copy(leaders[0].points[1]),point);
  assert.equal(leaders[0].options.pane,'territoryLabelPane');
  assert.equal(leaders[0].options.interactive,false);
  assert(Math.abs(leaders[0].options.weight / 3 * 72 / 96 - .45)<1e-9);
  assert.equal(JSON.stringify({label,areas}),snapshot,'The leader never edits saved coordinates');

  context.recolocarNumerosImpresos(map,.5);
  assert.equal(leaders[0].removed,true,'Reflow removes the previous leader instead of accumulating lines');
  assert.equal(map._printNumberLeaders.length,1);
  assert.equal(map._printNumberLeaders[0],leaders[1]);
  assert(Math.abs(leaders[1].options.weight * .5 / 3 * 72 / 96 - .45)<1e-9);
  assert.equal(JSON.stringify({label,areas}),snapshot);
});
