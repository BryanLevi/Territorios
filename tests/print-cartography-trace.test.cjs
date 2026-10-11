const {test}=require('node:test');
const assert=require('node:assert/strict');
const {trace}=require('../outputs/print-cartography-trace.js');
const palette=[{r:0,g:0,b:0,a:0},{r:255,g:255,b:255,a:255},{r:25,g:26,b:28,a:255}];
function image(w=32,h=32){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};}
function fill(img,x0,y0,x1,y1,color){
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)img.data.set(color,(y*img.width+x)*4);
}
test('Cartography exports filled vector paths without embedded raster images',()=>{
  const img=image();fill(img,4,4,28,28,[32,44,35,255]);fill(img,9,9,23,23,[0,0,0,0]);
  const svg=trace(img,palette,'names');
  assert.match(svg,/<svg viewBox="0 0 32 32"/);
  assert.match(svg,/<path /);assert.match(svg,/opacity="1"/);
  assert.doesNotMatch(svg,/<image|data:image|opacity="0"/);
  // A hollow glyph (O/0) keeps the inner contour, rather than becoming a blob.
  const paths=[...svg.matchAll(/\bd="([^"]+)"/g)].map(m=>m[1]);
  assert(paths.some(d=>(d.match(/M /g)||[]).length>=2));
});
test('Tiny punctuation and disconnected accents remain in the vector output',()=>{
  const img=image();fill(img,4,12,11,24,[32,44,35,255]);fill(img,7,6,10,8,[32,44,35,255]);fill(img,24,23,26,25,[32,44,35,255]);
  const svg=trace(img,palette,'names');
  assert.equal((svg.match(/<path /g)||[]).length,6,'Each accent and period retains a contour and its backing silhouette');
});
test('White road strokes retain a smooth scalable outline and no opaque background',()=>{
  const img=image();fill(img,0,13,32,18,[255,255,255,255]);
  const svg=trace(img,palette.slice(0,2),'roads');
  assert.equal((svg.match(/<path /g)||[]).length,1);
  assert.match(svg,/fill="rgb\(255,255,255\)"/);assert.doesNotMatch(svg,/opacity="0"|<image/);
});
test('Tracing is bounded and rejects malformed or excessive blocks',()=>{
  for(const img of [image(0,3),{width:10,height:10,data:new Uint8ClampedArray(8)},image(1100,1100)]){
    assert.throws(()=>trace(img,palette),/Invalid tracing block/);
  }
});

test('Neutral antialias shades cannot become coloured speckles in printed names',()=>{
  const img=image();fill(img,4,4,28,28,[25,26,28,255]);fill(img,8,8,24,24,[200,200,200,255]);
  const colors=[...palette,{r:174,g:80,b:184,a:255}];
  const svg=trace(img,colors,'names');
  assert.match(svg,/fill="rgb\(255,255,255\)"/);
  assert.doesNotMatch(svg,/fill="rgb\(174,80,184\)"/);
});

test('Empty cartography blocks stay transparent without allocating a contour layer',()=>{
  const svg=trace(image(),palette,'names');
  assert.match(svg,/viewBox="0 0 32 32"/);
  assert.doesNotMatch(svg,/<path|<image|fill=/);
});
