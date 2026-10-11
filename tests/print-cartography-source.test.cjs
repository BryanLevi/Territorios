const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const window={document:{currentScript:{src:'https://map.test/outputs/print-cartography-vector.js'}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../outputs/print-cartography-vector.js'),'utf8'),{window});
test('Cartography tracing accepts map drawings and excludes satellite photographs',()=>{
  const {canVectorize}=window.CroquisPrintCartography;
  for(const url of ['https://mt0.google.com/vt/lyrs=m&x=1&y=2&z=3',
    'https://mt1.google.com/vt/lyrs=h&x=1&y=2&z=3',
    'https://basemaps.cartocdn.com/rastertiles/voyager/3/1/2.png',
    'https://tile.openstreetmap.org/3/1/2.png'])assert.equal(canVectorize(url),true);
  for(const url of ['https://mt0.google.com/vt/lyrs=s&x=1&y=2&z=3',
    'https://server.arcgisonline.com/World_Imagery/3/1/2.png'])assert.equal(canVectorize(url),false);
});
test('A browser without workers retains its existing export path',async()=>{
  assert.equal(await window.CroquisPrintCartography.vectorize({},{}),null);
});
