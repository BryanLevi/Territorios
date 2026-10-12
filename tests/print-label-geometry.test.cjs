const {test} = require('node:test');
const assert = require('node:assert/strict');
const {detect, measure} = require('../outputs/print-label-geometry.js');

function image(width = 240, height = 120) {
  return {width, height, data:new Uint8ClampedArray(width * height * 4)};
}
function dot(bitmap, x, y, color = [28, 32, 30, 255]) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  bitmap.data.set(color, (y * bitmap.width + x) * 4);
}
function rect(bitmap, x, y, w, h) {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) dot(bitmap, col, row);
}
function word(bitmap, x, y, count = 5, angle = 0) {
  const radians = angle * Math.PI / 180;
  // Glyphs have separate stems and crossbars, as opposed to a solid blob.
  for (let character = 0; character < count; character++) {
    for (let row = 0; row < 14; row++) for (let col = 0; col < 7; col++) {
      if (col > 1 && col < 5 && row > 1 && row < 6 && row < 12) continue;
      if (col > 1 && col < 5 && row > 7 && row < 12) continue;
      const px = character * 11 + col, py = row;
      dot(bitmap, x + px * Math.cos(radians) - py * Math.sin(radians),
        y + px * Math.sin(radians) + py * Math.cos(radians));
    }
  }
}
const scan = bitmap => detect(bitmap.data, bitmap.width, bitmap.height);
const encloses = (box, left, top, right, bottom) => box.x0 <= left && box.y0 <= top
  && box.x1 >= right && box.y1 >= bottom;

test('A word crossing the geographic clipping edge yields one complete padded rectangle', () => {
  const bitmap = image();
  word(bitmap, 85, 35, 8);
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 1);
  assert(encloses(result.boxes[0], 85, 35, 169, 49));
  assert(result.boxes[0].x0 < 100 && result.boxes[0].x1 > 150,
    'The label extends beyond the old polygon edge rather than clipping there');
});

test('Adjacent words remain complete and close rows stay separate from a remote name', () => {
  const bitmap = image(300, 150);
  word(bitmap, 18, 20, 4);
  word(bitmap, 64, 20, 5);
  word(bitmap, 35, 40, 6);
  word(bitmap, 210, 100, 4);
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 3);
  assert(encloses(result.boxes[0], 18, 20, 115, 34));
  assert(encloses(result.boxes[1], 35, 40, 97, 54));
  assert(encloses(result.boxes[2], 210, 100, 250, 114));
});

test('Magnified provider lettering keeps every word in one complete row at native, double and quadruple grid sizes', () => {
  const source=image(240,120);
  word(source,20,30,4);
  word(source,68,30,8);
  word(source,20,60,6);
  for(const factor of [1,2,4]){
    const bitmap=image(source.width*factor,source.height*factor);
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
      const offset=(y*source.width+x)*4;
      if(!source.data[offset+3])continue;
      for(let dy=0;dy<factor;dy++)for(let dx=0;dx<factor;dx++)
        dot(bitmap,x*factor+dx,y*factor+dy,source.data.subarray(offset,offset+4));
    }
    const result=detect(bitmap.data,bitmap.width,bitmap.height,{glyphScale:factor});
    assert.equal(result.boxes.length,2,'Each label row remains whole without joining adjacent rows');
    assert(encloses(result.boxes[0],20*factor,30*factor,152*factor,44*factor));
    assert(encloses(result.boxes[1],20*factor,60*factor,82*factor,74*factor));
  }
});

test('A narrow first F and later words remain one complete label in the downsampled quadruple provider grid', () => {
  const bitmap=image(320,110);
  // A thin initial glyph survives the composite as a narrow stem and short
  // crossbars. Thirteen clear pixels separate it from the rest of the word;
  // the same space separates the following word. They must be joined before
  // geographic proximity is tested, so the far end of Finca remains visible.
  rect(bitmap,20,35,1,14);
  rect(bitmap,20,35,3,1);
  rect(bitmap,20,41,3,1);
  word(bitmap,36,35,4);
  word(bitmap,89,35,3);
  word(bitmap,230,35,5);
  word(bitmap,20,10,4);
  const before=Buffer.from(bitmap.data);
  for(const scale of [.2481695551432139,.25]){
    const result=detect(bitmap.data,bitmap.width,bitmap.height,{nativeScale:scale,glyphScale:4});
    assert.equal(result.boxes.length,3,'The complete nearby name, the remote name and the row above remain distinct');
    assert(encloses(result.boxes[0],20,10,60,24),'The adjacent row remains separate');
    assert(encloses(result.boxes[1],20,35,118,49),
      'The first narrow glyph and all following words share a complete rectangle');
    assert(encloses(result.boxes[2],230,35,281,49));
    assert(result.boxes[1].x1 < result.boxes[2].x0,
      'Completing a word never opens the distant label across the blank gap');
  }
  assert.deepEqual(Buffer.from(bitmap.data),before,'Detection never changes loaded cartography pixels');
});

test('An inclined street name is measured in full, including its upper and lower strokes', () => {
  const bitmap = image(230, 180);
  word(bitmap, 50, 40, 9, 34);
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 1);
  const box = result.boxes[0];
  assert(box.x0 <= 44 && box.x1 >= 128 && box.y0 <= 40 && box.y1 >= 104);
});

test('A dense cluster keeps each complete row without one box covering the whole map', () => {
  const bitmap=image(850,370);
  for(let row=0;row<15;row++)word(bitmap,20,30+row*20,70);
  const result=scan(bitmap);
  assert.equal(result.boxes.length,15);
  for(let row=0;row<15;row++)assert(encloses(result.boxes[row],20,30+row*20,786,44+row*20));
});

test('Road strokes and isolated dots do not create enormous label boxes', () => {
  const bitmap = image(360, 240);
  rect(bitmap, 10, 15, 310, 2);
  for (let i = 0; i < 185; i++) { dot(bitmap, 22 + i, 35 + i); dot(bitmap, 23 + i, 35 + i); }
  for (const [x, y] of [[330, 30], [315, 65], [300, 185]]) dot(bitmap, x, y);
  const lines = scan(bitmap);
  assert.deepEqual(lines.boxes, []);
  assert(lines.ignoredLineComponents >= 2);
  word(bitmap, 245, 110, 7);
  const names = scan(bitmap);
  assert.equal(names.boxes.length, 1);
  assert(encloses(names.boxes[0], 245, 110, 318, 124));
});

test('Colored background and translucent black noise are ignored; dark colored text survives', () => {
  const bitmap = image();
  for (let i = 0; i < bitmap.data.length; i += 4) bitmap.data.set([35, 220, 180, 255], i);
  for (let x = 5; x < 230; x++) dot(bitmap, x, 5, [0, 0, 0, 55]);
  word(bitmap, 40, 40, 6);
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 1);
  assert(encloses(result.boxes[0], 40, 40, 102, 54));
});

test('Translucent road edges cannot connect two otherwise distant opaque names', () => {
  const bitmap = image(320, 180);
  word(bitmap, 15, 35, 7);
  word(bitmap, 170, 115, 8);
  for (let x = 0; x < 320; x++) {
    const y = Math.round(25 + x * .4);
    for (let thickness = 0; thickness < 3; thickness++) dot(bitmap, x, y + thickness, [25, 26, 28, 239]);
  }
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 2);
  assert(encloses(result.boxes[0], 15, 35, 88, 49));
  assert(encloses(result.boxes[1], 170, 115, 254, 129));
});

test('Labels-only detection retains softened initial and middle letters before geographic clipping', () => {
  const bitmap = image(320, 150);
  word(bitmap, 20, 35, 10);
  word(bitmap, 230, 105, 5);
  for (let y = 35; y < 49; y++) for (let x = 20; x < 126; x++) {
    const index = (y * bitmap.width + x) * 4;
    if (!bitmap.data[index + 3]) continue;
    if (x < 50) bitmap.data[index + 3] = 239;
    if (x >= 70 && x < 95) bitmap.data[index + 3] = 190;
  }
  for (let x = 0; x < 310; x++) dot(bitmap, x, 75, [25, 26, 28, 55]);
  const before = Buffer.from(bitmap.data);
  const options = {nativeScale:.285128277212092, glyphScale:4};
  const defaultResult = detect(bitmap.data, bitmap.width, bitmap.height, options);
  assert(!defaultResult.boxes.some(box => encloses(box,20,35,126,49)),
    'The opaque-only detector cannot recover a downsampled prefix or missing middle glyphs');
  for (const labelsOnly of [false, 'true']) {
    assert.deepEqual(detect(bitmap.data, bitmap.width, bitmap.height,{...options,labelsOnly}),defaultResult,
      'Only the explicit labels-only layer enables softened ink');
  }
  const result = detect(bitmap.data, bitmap.width, bitmap.height,{...options,labelsOnly:true});
  assert.equal(result.boxes.length,2);
  assert(encloses(result.boxes[0],20,35,126,49),'Keep the complete nearby name, including its thin prefix');
  assert(encloses(result.boxes[1],230,105,281,119),'The distant label remains separate');
  assert.deepEqual(Buffer.from(bitmap.data),before,'Measurement preserves provider pixels');
});

function compositeEnvironment(bitmap, tiles, displayScale = .5, unreadable = false) {
  const origin = {left:30, top:50, width:bitmap.width * displayScale, height:bitmap.height * displayScale};
  const calls = [];
  let canvas, composite;
  const ownerDocument = {createElement:() => {
    canvas = {width:0, height:0, getContext:() => ({
      drawImage:(tile, x, y, w, h) => {
        calls.push({tile, x, y, w, h});
        composite ||= new Uint8ClampedArray(canvas.width * canvas.height * 4);
        if (!tile.pixels) return;
        for (let row = Math.max(0, Math.ceil(y)); row < Math.min(canvas.height, y + h); row++) {
          for (let col = Math.max(0, Math.ceil(x)); col < Math.min(canvas.width, x + w); col++) {
            const sourceX = Math.min(tile.naturalWidth - 1, Math.floor((col - x) / w * tile.naturalWidth));
            const sourceY = Math.min(tile.naturalHeight - 1, Math.floor((row - y) / h * tile.naturalHeight));
            const source = (sourceY * tile.naturalWidth + sourceX) * 4;
            composite.set(tile.pixels.subarray(source, source + 4), (row * canvas.width + col) * 4);
          }
        }
      },
      getImageData:() => {
        if (unreadable) throw new Error('SecurityError');
        return {data:composite || new Uint8ClampedArray(canvas.width * canvas.height * 4)};
      }
    })};
    return canvas;
  }};
  const container = {ownerDocument, getBoundingClientRect:() => origin};
  const map = {getContainer:() => container, getSize:() => ({x:bitmap.width, y:bitmap.height})};
  const layer = {_tiles:Object.fromEntries(tiles.map((tile, i) => {
    let pixels;
    if (tile.w <= bitmap.width && tile.h <= bitmap.height) {
      pixels = new Uint8ClampedArray(tile.w * tile.h * 4);
      for (let row = 0; row < tile.h; row++) {
        const from = ((tile.y + row) * bitmap.width + tile.x) * 4;
        pixels.set(bitmap.data.subarray(from, from + tile.w * 4), row * tile.w * 4);
      }
    }
    return [i, {
    current:tile.current,
    el:{complete:tile.loaded !== false, naturalWidth:tile.loaded === false ? 0 : tile.w,
      naturalHeight:tile.h, pixels,
      getBoundingClientRect:() => ({left:origin.left + tile.x * displayScale,
        top:origin.top + tile.y * displayScale, width:tile.w * displayScale, height:tile.h * displayScale})}
    }];
  }))};
  return {map, layer, calls, canvas:() => canvas};
}

test('The tile mosaic preserves a word across a seam and returns map pixels despite PDF transforms', () => {
  const bitmap = image(256, 100);
  word(bitmap, 100, 35, 8);
  const env = compositeEnvironment(bitmap, [
    {x:0, y:0, w:128, h:100}, {x:128, y:0, w:128, h:100},
    {x:0, y:0, w:128, h:100, current:false}, {x:0, y:0, w:128, h:100, loaded:false}
  ], .25);
  const result = measure(env.map, env.layer);
  assert.equal(result.tiles, 2);
  assert.equal(result.boxes.length, 1);
  assert(encloses(result.boxes[0], 100, 35, 184, 49));
  assert.equal(env.calls[0].x, 0);
  assert.equal(env.calls[1].x, 128);
  assert.equal(env.calls[1].w, 128);
  assert.equal(env.canvas().width, 1, 'The large canvas backing buffer is released');
});

test('Tile measurement opts into softened lettering only for the labels-only print layer', () => {
  const bitmap = image(180, 90);
  word(bitmap,25,30,8);
  for(let index=3;index<bitmap.data.length;index+=4)if(bitmap.data[index])bitmap.data[index]=239;
  const tiles = [{x:0,y:0,w:180,h:90}];
  for(const printLabelsOnly of [undefined,false,'true']){
    const env = compositeEnvironment(bitmap,tiles,.25);
    env.layer.options = {tileSize:1024,printLabelsOnly};
    assert.equal(measure(env.map,env.layer).reason,'no-ink',
      'Individual maps and layers without the explicit flag keep the opaque road-safe threshold');
  }
  const env = compositeEnvironment(bitmap,tiles,.25);
  env.layer.options = {tileSize:1024,printLabelsOnly:true};
  const result = measure(env.map,env.layer);
  assert.equal(result.reason,null);
  assert.equal(result.boxes.length,1);
  assert(encloses(result.boxes[0],25,30,109,44));
  assert.equal(env.canvas().width,1);
});

test('Unreadable or unavailable canvas yields a safe explicit fallback', () => {
  const bitmap = image();
  const env = compositeEnvironment(bitmap, [{x:0, y:0, w:240, h:120}], .5, true);
  assert.equal(measure(env.map, env.layer).reason, 'canvas-unreadable');
  assert.deepEqual(measure(env.map, env.layer).boxes, []);
  assert.equal(measure(null, null).reason, 'unmeasured-map');
  assert.equal(detect([], 10, 10).reason, 'invalid-image');
});

test('Large maps are composited with a bounded pixel allocation', () => {
  const bitmap = image(1, 1);
  const env = compositeEnvironment(bitmap, [{x:0, y:0, w:6000, h:3000}]);
  env.map.getSize = () => ({x:6000, y:3000});
  const result = measure(env.map, env.layer);
  assert(result.sampledPixels <= 4000000);
  assert.equal(result.reason, 'no-ink');
  assert(result.compositeScale < 1);
  assert.equal(result.width, 6000);
  assert.equal(result.height, 3000);
  assert.equal(env.canvas().width, 1);
});
