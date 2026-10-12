const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {textPoints,placeLabel}=require('../outputs/print-direction-layout.js');
const {polygonIntersectsRect}=require('../outputs/print-frame-fit.js');

const rectangle=r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
const box=(p,input)=>({x:p.x-input.width/2-input.gap,y:p.y-input.height/2-input.gap,
  w:input.width+2*input.gap,h:input.height+2*input.gap});
const overlaps=(a,b)=>a.x<=b.x+b.w && a.x+a.w>=b.x && a.y<=b.y+b.h && a.y+a.h>=b.y;
function assertClear(result,input){
  const b=box(result,input);
  assert(b.x>=0 && b.y>=0 && b.x+b.w<=input.canvas.w && b.y+b.h<=input.canvas.h,
    'The complete text and its clearance stay inside the source canvas');
  for(const polygon of input.polygons) assert(!polygonIntersectsRect(polygon,b),'Text clears the colored territory');
  for(const other of input.occupied) assert(!overlaps(b,other),'Text clears existing labels');
  const paths=input.arrowPoints.length && input.arrowPoints[0].x!==undefined ? [input.arrowPoints] : input.arrowPoints;
  for(const points of paths) for(let i=1;i<points.length;i++)
    assert(!polygonIntersectsRect([points[i-1],points[i]],b),'Text clears the shaft and arrowhead');
}
function input(overrides={}){
  return {anchor:{x:150,y:40},tip:{x:140,y:80},width:28,height:10,gap:2,unitScale:2,
    canvas:{w:300,h:220},polygons:[rectangle({x:60,y:70,w:100,h:90})],
    occupied:[{x:205,y:25,w:60,h:14}],arrowPoints:[{x:170,y:130},{x:140,y:80}],...overrides};
}
function freezeDeep(value){
  if(value && typeof value==='object'){Object.values(value).forEach(freezeDeep);Object.freeze(value);}
  return value;
}

test('A clear saved text position is preserved exactly',()=>{
  const data=input(),result=placeLabel(data);
  assert.deepEqual(result,{x:150,y:40,moved:false});
  assertClear(result,data);
});

test('An overlapping destination moves into nearby white space clear of territory, arrows and labels',()=>{
  const data=input({anchor:{x:142,y:100},tip:{x:165,y:80},
    occupied:[{x:150,y:48,w:50,h:14}],
    arrowPoints:[[{x:165,y:130},{x:165,y:80}],[{x:155,y:90},{x:165,y:80},{x:175,y:90}]]});
  const result=placeLabel(data);
  assert.equal(result.moved,true);
  assert(Math.min(Math.hypot(result.x-data.anchor.x,result.y-data.anchor.y),
    Math.hypot(result.x-data.tip.x,result.y-data.tip.y))<=36*data.unitScale+1e-8,
    'The correction remains within the physical search radius');
  assertClear(result,data);
});

test('A two-point arrow shaft blocks an otherwise clear original position',()=>{
  const data=input({anchor:{x:180,y:90},tip:{x:180,y:70},polygons:[],occupied:[],
    arrowPoints:[{x:180,y:120},{x:180,y:70}]});
  const result=placeLabel(data);
  assert.equal(result.moved,true);
  assertClear(result,data);
});

test('The gap prevents text from grazing a colored polygon or another label',()=>{
  for(const obstacles of [{polygons:[rectangle({x:80,y:80,w:50,h:60})],occupied:[]},
    {polygons:[],occupied:[{x:80,y:80,w:50,h:60}]}]){
    const data=input({anchor:{x:145,y:100},tip:{x:145,y:100},width:28,height:10,
      arrowPoints:[],...obstacles});
    assert.equal(145-28/2,131,'The actual glyph box is outside the obstacle');
    const result=placeLabel(data);
    assert.equal(result.moved,true,'Its two-pixel clearance still collides');
    assertClear(result,data);
  }
});

test('A source-edge label moves fully inside the canvas with its clearance',()=>{
  const data=input({anchor:{x:5,y:6},tip:{x:5,y:6},polygons:[],occupied:[],arrowPoints:[]});
  const result=placeLabel(data);
  assert.equal(result.moved,true);
  assertClear(result,data);
});

test('Real triangle geometry leaves an empty corner available for text',()=>{
  const data=input({anchor:{x:170,y:130},tip:{x:170,y:130},width:20,height:10,
    polygons:[[{x:30,y:30},{x:180,y:30},{x:30,y:180}]],occupied:[],arrowPoints:[]});
  assert.deepEqual(placeLabel(data),{x:170,y:130,moved:false});
  assertClear(placeLabel(data),data);
});

test('A concave territory leaves its white bay available without replacing it by a bounding box',()=>{
  const polygon=[{x:20,y:20},{x:220,y:20},{x:220,y:180},{x:170,y:180},
    {x:170,y:70},{x:70,y:70},{x:70,y:180},{x:20,y:180}];
  const data=input({anchor:{x:120,y:120},tip:{x:120,y:120},polygons:[polygon],occupied:[],arrowPoints:[]});
  assert.deepEqual(placeLabel(data),{x:120,y:120,moved:false});
  assertClear(placeLabel(data),data);
});

test('An interior white bay is preferred to a patch that would expand the printed map crop',()=>{
  const polygon=[{x:40,y:40},{x:240,y:40},{x:240,y:240},{x:200,y:240},
    {x:200,y:80},{x:80,y:80},{x:80,y:240},{x:40,y:240}];
  const data=input({anchor:{x:140,y:50},tip:{x:140,y:110},width:20,height:20,unitScale:1,
    canvas:{w:300,h:300},polygons:[polygon],occupied:[],arrowPoints:[{x:140,y:70},{x:140,y:110}]});
  const result=placeLabel(data),b=box(result,data);
  assert.equal(result.moved,true);
  assert(b.x>=40 && b.y>=40 && b.x+b.w<=240 && b.y+b.h<=240,
    'The relocated label does not add a margin outside existing map ink');
  assertClear(result,data);
});

test('The search preserves all source data and keeps the saved anchor when no white space exists',()=>{
  const data=freezeDeep(input({anchor:{x:110,y:110},polygons:[rectangle({x:0,y:0,w:300,h:220})]}));
  const snapshot=JSON.stringify(data);
  assert.deepEqual(placeLabel(data),{x:110,y:110,moved:false});
  assert.equal(JSON.stringify(data),snapshot);
  const movable=freezeDeep(input({anchor:{x:140,y:100}})),before=JSON.stringify(movable);
  assert.equal(placeLabel(movable).moved,true);
  assert.equal(JSON.stringify(movable),before,'A successful correction also leaves inputs untouched');
});

test('Printed destination fonts are compact, finite and bounded in narrow and wide frames',()=>{
  assert.equal(textPoints(10,64),6);
  assert.equal(textPoints(7,64),5);
  assert.equal(textPoints(18,64),7);
  assert.equal(textPoints(18,32),5.5);
  for(const size of [-100,0,1,7,10,18,999,NaN,Infinity,undefined])
    for(const width of [12,32,48,64,999,0,-1,NaN,Infinity,undefined]){
      const value=textPoints(size,width),maximum=Math.max(5.5,Math.min(7,
        (Number.isFinite(Number(width)) ? Number(width) : 64)*.12));
      assert(Number.isFinite(value));
      assert(value>=5 && value<=maximum);
    }
});

test('Only grouped destination fonts shrink while all saved sizes remain available to individual PDFs',()=>{
  assert(Math.abs(textPoints(10,64,true)-4.8)<1e-8);
  assert(Math.abs(textPoints(18,32,true)-4.4)<1e-8);
  for(const size of [-100,0,1,7,10,18,999,NaN,Infinity,undefined])
    for(const width of [12,32,48,64,999,0,-1,NaN,Infinity,undefined]){
      assert.equal(textPoints(size,width,true),textPoints(size,width)*.8);
      assert.equal(textPoints(size,width,false),textPoints(size,width));
    }
});

test('The browser UMD export uses frame-fit geometry and bounds the candidate search',()=>{
  let collisions=0;
  const window={CroquisPrintFrameFit:{polygonIntersectsRect:()=>{collisions++;return true;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../outputs/print-direction-layout.js'),'utf8'),{window});
  assert.equal(typeof window.CroquisPrintDirectionLayout.textPoints,'function');
  const data=input({polygons:[rectangle({x:0,y:0,w:300,h:220})],occupied:[],arrowPoints:[]});
  assert.equal(window.CroquisPrintDirectionLayout.placeLabel(data).moved,false);
  assert(collisions<=113,'The original plus 112 trial positions is the fixed search bound');
  assert(collisions>1,'Free-space detection uses the shared polygon helper');
});

test('Distant dense polygons are rejected by their bounds before polygon collision checks',()=>{
  let collisions=0;
  const window={CroquisPrintFrameFit:{polygonIntersectsRect:(points,b)=>{
    collisions++;
    return polygonIntersectsRect(points,b);
  }}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../outputs/print-direction-layout.js'),'utf8'),{window});
  const distant=Array.from({length:10000},(_,i)=>({x:250+Math.cos(i)*5,y:180+Math.sin(i)*5}));
  const data=input({polygons:[distant],occupied:[],arrowPoints:[]});
  assert.equal(window.CroquisPrintDirectionLayout.placeLabel(data).moved,false);
  assert.equal(collisions,0,'A clear text far from a brush polygon never scans its edges');
});
