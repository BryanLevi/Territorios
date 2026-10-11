const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const geometry = require('../outputs/print-clip-geometry.js');

const html = fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
const start = html.indexOf('function renderPrintVectorClip(');
const end = html.indexOf('\nfunction waitForPrintTiles(',start);
assert(start>=0&&end>start,'The vector clip and its compatible fallback are present');
const clone = value => JSON.parse(JSON.stringify(value));

function element(tag){
  const classes=new Set();
  return {tag,attributes:{},children:[],style:{},classList:{add:name=>classes.add(name)},
    setAttribute(name,value){this.attributes[name]=value;},
    appendChild(child){child.parentElement=this;this.children.push(child);},
    querySelectorAll(selector){
      assert.equal(selector,'.print-color-mask');
      return this.children.filter(child=>child.classes.has('print-color-mask'));
    },
    remove(){
      if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(child=>child!==this);
    },classes};
}

const descendants = node => [node,...node.children.flatMap(descendants)];
const savedAreas = () => Object.freeze([Object.freeze({points:Object.freeze([
  Object.freeze([10,20]),Object.freeze([10,40]),Object.freeze([30,40]),Object.freeze([30,20])
])})]);

function environment({origin={x:23,y:-11},helper=true,areas=savedAreas()}={}){
  const created=[],calls=[],container=element('container');
  container.style.background='#editor';
  const panes=Object.fromEntries([
    'tilePane','overlayPane','shadowPane','territoryColorPane','territoryRestorePane',
    'territoryOutlinePane','territoryWhiteRoadPane','territoryRoadPane','territoryBaseMaskPane',
    'territoryMaskPane','territoryLabelPane','markerPane','tooltipPane','popupPane'
  ].map(name=>[name,element(name)]));
  panes.territoryRoadPane.style.zIndex=540;
  panes.territoryLabelPane.style.zIndex=550;
  const window=helper?{CroquisPrintClipGeometry:{unionPath(polygons,boxes,radius){
    calls.push(clone({polygons,boxes,radius}));
    return geometry.unionPath(polygons,boxes,radius);
  }}}:{};
  const context=vm.createContext({window,printRenderScale:3,
    colorFondoImpresion:()=> '#ffffff',getExportColorAreasForLoc:()=>areas,
    document:{createElementNS(namespace,tag){
      assert.equal(namespace,'http://www.w3.org/2000/svg');
      const node=element(tag);created.push(node);return node;
    }}});
  vm.runInContext(html.slice(start,end),context);
  const map={getContainer:()=>container,getSize:()=>({x:1000,y:900}),
    getPane:name=>panes[name],containerPointToLayerPoint:()=>origin,
    latLngToContainerPoint:([lat,lng])=>({x:lng*10+.04,y:lat*10+.06})};
  return {context,map,panes,container,created,calls,areas,origin};
}

test('Vector clips use layer coordinates for both native and displaced Leaflet origins',()=>{
  function contours(svg){
    const tokens=svg.match(/[MLZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
    const result=[];let points=[],index=0;
    while(index<tokens.length){
      const command=tokens[index++];
      if(command==='M') points=[{x:Number(tokens[index++]),y:Number(tokens[index++])}];
      else if(command==='L') points.push({x:Number(tokens[index++]),y:Number(tokens[index++])});
      else if(command==='Z') result.push(points);
      else assert.fail('Unexpected polyline command: '+command);
    }
    return result;
  }
  function winding(points,point){
    let value=0;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      const side=(b.x-a.x)*(point.y-a.y)-(point.x-a.x)*(b.y-a.y);
      if(a.y<=point.y&&b.y>point.y&&side>0) value++;
      if(a.y>point.y&&b.y<=point.y&&side<0) value--;
    }
    return value;
  }
  function assertCovered(rings,box){
    // Break the rectangle into scanline bands at every boundary vertex and
    // side intersection. Within a band, winding can change only at an edge.
    const levels=[box.y0,box.y1];
    for(const ring of rings) for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      if(a.y>box.y0&&a.y<box.y1) levels.push(a.y);
      if(a.x!==b.x) for(const x of [box.x0,box.x1]){
        const t=(x-a.x)/(b.x-a.x),y=a.y+t*(b.y-a.y);
        if(t>0&&t<1&&y>box.y0&&y<box.y1) levels.push(y);
      }
    }
    const boundaries=[...new Set(levels)].sort((a,b)=>a-b);
    for(let i=1;i<boundaries.length;i++){
      const y=(boundaries[i-1]+boundaries[i])/2,xs=[box.x0,box.x1];
      for(const ring of rings) for(let j=0;j<ring.length;j++){
        const a=ring[j],b=ring[(j+1)%ring.length];
        if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y)){
          const x=a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y);
          if(x>box.x0&&x<box.x1) xs.push(x);
        }
      }
      const intervals=[...new Set(xs)].sort((a,b)=>a-b);
      for(let j=1;j<intervals.length;j++){
        const point={x:(intervals[j-1]+intervals[j])/2,y};
        assert.notEqual(rings.reduce((sum,ring)=>sum+winding(ring,point),0),0,
          'The complete measured name remains inside the nonzero clip at '+JSON.stringify(point));
      }
    }
  }
  for(const origin of [{x:0,y:0},{x:23,y:-11}]){
    const e=environment({origin}),before=JSON.stringify(e.areas);
    const labels=Object.freeze([Object.freeze({x0:80,y0:90,x1:150,y1:110}),
      Object.freeze({x0:450,y0:200,x1:780,y1:250})]);
    const labelBefore=JSON.stringify(labels);
    assert.equal(e.context.renderPrintVectorClip(e.map,{num:7},
      {grow:2,fondo:'#ffffff',labelBoxes:labels}),true);
    assert.equal(e.calls.length,1);
    const expectedPolygons=[[{x:200+origin.x,y:100.1+origin.y},
      {x:400+origin.x,y:100.1+origin.y},{x:400+origin.x,y:300.1+origin.y},
      {x:200+origin.x,y:300.1+origin.y}]];
    const expectedBoxes=labels.map(box=>({x0:box.x0+origin.x,y0:box.y0+origin.y,
      x1:box.x1+origin.x,y1:box.y1+origin.y}));
    assert.deepEqual(e.calls[0],{polygons:expectedPolygons,boxes:expectedBoxes,radius:3});
    const svg=e.panes.territoryBaseMaskPane.children[0];
    const clip=descendants(svg).find(node=>node.tag==='clipPath');
    const clipPath=clip.children[0];
    assert.equal(clip.attributes.clipPathUnits,'userSpaceOnUse');
    assert.equal(clipPath.attributes['clip-rule'],'nonzero');
    assert.equal(clipPath.attributes.d,geometry.unionPath(expectedPolygons,expectedBoxes,3));
    const rings=contours(clipPath.attributes.d);
    for(const box of expectedBoxes) assertCovered(rings,box);
    assert.equal(svg.style.left,(origin.x-1000)+'px');
    assert.equal(svg.style.top,(origin.y-1000)+'px');
    assert.equal(JSON.stringify(e.areas),before,'Saved territory points are unchanged');
    assert.equal(JSON.stringify(labels),labelBefore,'Measured names keep their full immutable rectangles');
  }
});

test('The primary PDF path clips the base panes without SVG masks or rasterizing filters',()=>{
  const e=environment();
  e.context.renderPrintColorMask(e.map,{num:1},{fondo:'#fff',grow:1});
  const svg=e.panes.territoryBaseMaskPane.children[0];
  const clip=descendants(svg).find(node=>node.tag==='clipPath');
  const reference='url(#'+clip.attributes.id+')';
  for(const name of ['tilePane','overlayPane','shadowPane','territoryColorPane','territoryRestorePane',
    'territoryOutlinePane','territoryWhiteRoadPane']) assert.equal(e.panes[name].style.clipPath,reference);
  for(const name of ['territoryRoadPane','territoryLabelPane','markerPane','tooltipPane','popupPane']){
    assert.equal(e.panes[name].style.clipPath,undefined,'Own labels and icons are not geographically clipped: '+name);
  }
  assert.equal(e.container.style.background,'#fff');
  assert(!e.created.some(node=>node.tag==='mask'||node.tag==='filter'));
  for(const node of e.created){
    assert.equal(node.attributes.mask,undefined);
    assert.equal(node.attributes.filter,undefined);
  }
});

test('The names pass clips only provider names at 540 and leaves labels and icons above it intact',()=>{
  const e=environment();
  e.context.renderPrintColorMask(e.map,{num:1},{fondo:'#ffffff'});
  const baseReference=e.panes.tilePane.style.clipPath;
  const nameBounds=Object.freeze([Object.freeze({x0:410,y0:290,x1:720,y1:350})]);
  e.context.renderPrintColorMask(e.map,{num:1},{pane:'territoryMaskPane',
    fondo:'#ffffff',grow:24,labelBoxes:nameBounds});
  const svg=e.panes.territoryMaskPane.children[0];
  const clip=descendants(svg).find(node=>node.tag==='clipPath');
  assert.equal(e.panes.territoryRoadPane.style.clipPath,'url(#'+clip.attributes.id+')');
  assert.equal(e.panes.tilePane.style.clipPath,baseReference,'The narrow base clip is retained independently');
  assert.equal(e.panes.territoryWhiteRoadPane.style.clipPath,baseReference);
  assert.equal(e.panes.territoryLabelPane.style.clipPath,undefined);
  assert.equal(e.panes.markerPane.style.clipPath,undefined);
  assert.match(html,/printMap\.getPane\('territoryRoadPane'\)\.style\.zIndex\s*=\s*540\s*;/);
  assert.match(html,/printMap\.getPane\('territoryLabelPane'\)\.style\.zIndex\s*=\s*550\s*;/);
  assert.deepEqual(e.calls[1].boxes,[{x0:433,y0:279,x1:743,y1:339}]);
});

test('Suppressed provider names retain their white overlay in container coordinates',()=>{
  const e=environment(),suppressed=Object.freeze([Object.freeze({x0:60,y0:70,x1:160,y1:100}),
    Object.freeze({x0:0,y0:0,x1:0,y1:12}),Object.freeze({x0:2,y0:2,x1:Infinity,y1:10})]);
  e.context.renderPrintColorMask(e.map,{num:1},{pane:'territoryMaskPane',fondo:'#ffffff',
    suppressedLabelBoxes:suppressed});
  const svg=e.panes.territoryMaskPane.children[0];
  const overlays=svg.children.filter(node=>node.tag==='rect');
  assert.equal(overlays.length,1,'Invalid suppressed bounds never emit invalid SVG');
  assert.deepEqual(overlays[0].attributes,{x:'60',y:'70',width:'100',height:'30',fill:'#ffffff'});
  assert.equal(svg.children[0].tag,'defs');
  assert.equal(svg.children[1],overlays[0],'The white coverage paints above the provider names');
  assert.equal(e.calls[0].boxes.length,0,'Suppressed names do not open holes in the territory clip');
});

test('Transparent output and unpainted territories preserve the original map and saved editor data',()=>{
  for(const transparent of [true,false]){
    const e=environment({areas:transparent?savedAreas():[]});
    const loc=Object.freeze({num:7,exportBounds:Object.freeze({south:10,north:30,west:20,east:40})});
    const before=JSON.stringify({loc,areas:e.areas});
    const paneBefore=Object.fromEntries(Object.entries(e.panes).map(([name,pane])=>[name,{...pane.style}]));
    e.context.renderPrintColorMask(e.map,loc,{fondo:transparent?'transparente':'#fff'});
    assert.equal(e.created.length,0);
    assert.equal(e.calls.length,0);
    assert.equal(e.container.style.background,'#editor');
    assert.deepEqual(Object.fromEntries(Object.entries(e.panes).map(([name,pane])=>[name,pane.style])),paneBefore);
    assert.equal(JSON.stringify({loc,areas:e.areas}),before);
  }
});

test('A missing vector geometry module retains the existing color-mask fallback',()=>{
  const e=environment({helper:false});
  assert.equal(e.context.renderPrintVectorClip(e.map,{num:1},{fondo:'#fff'}),false);
  e.context.renderPrintColorMask(e.map,{num:1},{fondo:'#fff',grow:1,
    labelBoxes:[{x0:450,y0:200,x1:780,y1:250}]});
  const svg=e.panes.territoryBaseMaskPane.children[0];
  assert(descendants(svg).some(node=>node.tag==='mask'));
  assert(descendants(svg).some(node=>node.tag==='polygon'));
  assert(svg.children.some(node=>node.tag==='rect'&&node.attributes.mask?.startsWith('url(#')));
  assert.equal(e.panes.tilePane.style.clipPath,undefined);
});
