const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fit,polygonIntersectsRect}=require('../outputs/print-frame-fit.js');

const rectangle=r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
function assertSafe(crop,plan,shapes,result){
  const a=plan.mapRect;
  assert(result.scale>0);
  assert(result.x>=a.x-1e-8&&result.y>=a.y-1e-8);
  assert(result.x+result.w<=a.x+a.w+1e-8&&result.y+result.h<=a.y+a.h+1e-8);
  for(const ornament of [plan.legendRect,plan.compassRect].filter(Boolean)){
    for(const shape of shapes){
      const points=shape.points.map(p=>({x:result.x+(p.x-crop.x)*result.scale,
        y:result.y+(p.y-crop.y)*result.scale}));
      const grow=(plan.clearance||0)+(shape.padding||0)*result.scale;
      assert(!polygonIntersectsRect(points,{x:ornament.x-grow,y:ornament.y-grow,
        w:ornament.w+2*grow,h:ornament.h+2*grow}), 'Printed ink stays clear of both corner ornaments');
    }
  }
}

test('Polygon detection distinguishes white corners, enclosed rectangles and thin roads',()=>{
  const diamond=[{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:0,y:50}];
  assert(!polygonIntersectsRect(diamond,{x:0,y:84,w:16,h:16}));
  assert(polygonIntersectsRect(diamond,{x:45,y:45,w:5,h:5}));
  assert(polygonIntersectsRect([{x:0,y:5},{x:100,y:5}],{x:10,y:0,w:5,h:10}));
  assert(!polygonIntersectsRect([{x:0,y:5},{x:100,y:5}],{x:10,y:6,w:5,h:10}));
});

test('Free white corners retain the full territory scale instead of losing a footer strip',()=>{
  const crop={x:0,y:15,w:100,h:100};
  const plan={mapRect:{x:1.6,y:6.6,w:100,h:100},safeMapRect:{x:1.6,y:6.6,w:100,h:83},
    legendRect:{x:1.6,y:90.6,w:16,h:16},compassRect:{x:91.6,y:90.6,w:10,h:16},clearance:1};
  const shapes=[{points:[{x:50,y:15},{x:100,y:65},{x:50,y:115},{x:0,y:65}]}];
  const result=fit(crop,plan,shapes);
  assert.equal(result.scale,1);
  assert(result.scale>plan.safeMapRect.h/crop.h*1.2);
  assertSafe(crop,plan,shapes,result);
});

test('A corner street or destination label is preserved rather than hidden behind the legend',()=>{
  const crop={x:0,y:0,w:100,h:100};
  const plan={mapRect:{x:0,y:0,w:100,h:100},safeMapRect:{x:0,y:0,w:100,h:59},
    legendRect:{x:0,y:60,w:30,h:40},compassRect:{x:90,y:85,w:10,h:15},clearance:1};
  const silhouette={points:[{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:0,y:50}]};
  const shapes=[silhouette,{points:rectangle({x:0,y:80,w:28,h:18}),padding:.15}];
  const result=fit(crop,plan,shapes);
  assert(result.scale<1);
  assertSafe(crop,plan,shapes,result);
});

test('Missing geometry falls back to a complete safe rectangle with complete names',()=>{
  const crop={x:20,y:15,w:150,h:90};
  const plan={mapRect:{x:1.6,y:7,w:56,h:35},safeMapRect:{x:1.6,y:7,w:56,h:23},
    legendRect:{x:1.6,y:31,w:30,h:11},compassRect:{x:51,y:34,w:6.6,h:8},clearance:1};
  const result=fit(crop,plan,[]);
  assertSafe(crop,plan,[{points:rectangle(crop)}],result);
  assert(result.scale>=Math.min(plan.safeMapRect.w/crop.w,(plan.safeMapRect.h-.02)/crop.h));
  assert.equal(fit({x:0,y:0,w:0,h:20},plan,[]),null);
});

test('Text measured at its final scale cannot be enlarged after the final fit',()=>{
  const crop={x:0,y:0,w:100,h:100};
  const plan={mapRect:{x:0,y:0,w:100,h:100},safeMapRect:{x:0,y:0,w:100,h:100}};
  const shapes=[{points:rectangle(crop)}];
  const result=fit(crop,plan,shapes,.65);
  assert.equal(result.scale,.65);
  assertSafe(crop,plan,shapes,result);
});
