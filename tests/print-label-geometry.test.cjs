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

test('Adjacent words and two close rows stay together while a remote name stays separate', () => {
  const bitmap = image(300, 150);
  word(bitmap, 18, 20, 4);
  word(bitmap, 64, 20, 5);
  word(bitmap, 35, 40, 6);
  word(bitmap, 210, 100, 4);
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 2);
  assert(encloses(result.boxes[0], 18, 20, 115, 54));
  assert(encloses(result.boxes[1], 210, 100, 250, 114));
});

test('An inclined street name is measured in full, including its upper and lower strokes', () => {
  const bitmap = image(230, 180);
  word(bitmap, 50, 40, 9, 34);
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 1);
  const box = result.boxes[0];
  assert(box.x0 <= 44 && box.x1 >= 128 && box.y0 <= 40 && box.y1 >= 104);
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
    for (let thickness = 0; thickness < 3; thickness++) dot(bitmap, x, y + thickness, [25, 26, 28, 203]);
  }
  const result = scan(bitmap);
  assert.equal(result.boxes.length, 2);
  assert(encloses(result.boxes[0], 15, 35, 88, 49));
  assert(encloses(result.boxes[1], 170, 115, 254, 129));
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
