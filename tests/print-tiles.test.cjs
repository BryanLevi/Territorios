const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const start = html.indexOf('function waitForPrintTiles(');
const end = html.indexOf('\nfunction getPrintTileUrl(', start);
assert(start >= 0 && end > start, 'Print tile wait is available');

function environment(){
  let now = 0, id = 0;
  const timers = new Map();
  const context = vm.createContext({
    setTimeout:(callback, duration) => {
      const key = ++id;
      timers.set(key, {callback, at:now + duration});
      return key;
    },
    clearTimeout:key => timers.delete(key)
  });
  vm.runInContext(html.slice(start, end), context);
  return {
    wait:context.waitForPrintTiles,
    timers,
    advance(milliseconds){
      const stop = now + milliseconds;
      while(true){
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if(!next || next[1].at > stop) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = stop;
    }
  };
}

function tile(status = 'pending', current = true){
  const complete = status !== 'pending';
  return {current, loaded:complete ? 1 : undefined,
    el:{complete, naturalWidth:status === 'loaded' ? 1024 : 0, src:'https://example.test/tile.png'}};
}

function layer(tiles = [], loading = true){
  const target = new EventEmitter();
  target._tiles = Object.fromEntries(tiles.map((item, index) => [index, item]));
  target.loading = loading;
  target.isLoading = () => target.loading;
  return target;
}

const plain = value => JSON.parse(JSON.stringify(value));
const listeners = target => ['load', 'tileload', 'tileerror'].map(name => target.listenerCount(name));
function finishTile(target, index, status){
  const item = target._tiles[index];
  item.loaded = 1;
  item.el.complete = true;
  item.el.naturalWidth = status === 'loaded' ? 1024 : 0;
  target.emit(status === 'loaded' ? 'tileload' : 'tileerror', {tile:item.el});
}

test('Already loaded print tiles are counted immediately and retained offscreen tiles do not delay printing', async () => {
  const e = environment();
  const target = layer([tile('loaded'), tile('loaded'), tile('pending', false)], false);
  assert.deepEqual(plain(await e.wait(target, 45000)), {loaded:2, failed:0, pending:0, timedOut:false});
  assert.deepEqual(listeners(target), [0, 0, 0]);
  assert.equal(e.timers.size, 0);
});

test('A labels layer that loaded before the background does not wait another 45 seconds', async () => {
  const e = environment();
  const background = layer([tile()]);
  const names = layer([tile('loaded'), tile('loaded')], false);
  const backgroundReady = e.wait(background, 180000);
  e.advance(1200);
  finishTile(background, 0, 'loaded');
  background.loading = false;
  background.emit('load');
  assert.equal((await backgroundReady).loaded, 1);
  assert.deepEqual(plain(await e.wait(names, 45000)), {loaded:2, failed:0, pending:0, timedOut:false});
  assert.equal(e.timers.size, 0);
});

test('The first failed tile does not finish a map while another tile is still arriving', async () => {
  const e = environment();
  const target = layer([tile(), tile()]);
  let ready = false;
  const result = e.wait(target, 8000).then(value => {ready = true; return value;});
  finishTile(target, 0, 'failed');
  e.advance(1200);
  await Promise.resolve();
  assert.equal(ready, false, 'A failure must not end the wait after 900 ms');
  assert.equal(target.listenerCount('tileload'), 1);
  finishTile(target, 1, 'loaded');
  target.loading = false;
  target.emit('load');
  assert.deepEqual(plain(await result), {loaded:1, failed:1, pending:0, timedOut:false});
  assert.deepEqual(listeners(target), [0, 0, 0]);
  assert.equal(e.timers.size, 0);
});

test('Timeout reports loaded, failed and pending current tiles and removes all listeners', async () => {
  const e = environment();
  const target = layer([tile('loaded'), tile('failed'), tile()]);
  const result = e.wait(target, 2000);
  e.advance(2000);
  assert.deepEqual(plain(await result), {loaded:1, failed:1, pending:1, timedOut:true});
  assert.deepEqual(listeners(target), [0, 0, 0]);
  assert.equal(e.timers.size, 0);
  finishTile(target, 2, 'loaded');
  target.loading = false;
  target.emit('load');
  assert.equal(e.timers.size, 0, 'Late events cannot restart a completed wait');
});

test('Completed layers preserve real successes and errors instead of counting duplicate load events', async () => {
  const e = environment();
  const target = layer([tile('loaded'), tile(), tile('failed')]);
  const result = e.wait(target, 8000);
  finishTile(target, 1, 'loaded');
  target.emit('tileload', {tile:target._tiles[1].el});
  target.loading = false;
  target.emit('load');
  assert.deepEqual(plain(await result), {loaded:2, failed:1, pending:0, timedOut:false});
  assert.deepEqual(listeners(target), [0, 0, 0]);
});

test('Null and empty inactive layers finish without a long timeout', async () => {
  const e = environment();
  const empty = layer([], false);
  for(const target of [null, undefined, empty]){
    assert.deepEqual(plain(await e.wait(target)), {loaded:0, failed:0, pending:0, timedOut:false});
  }
  assert.equal(e.timers.size, 0);
  assert.deepEqual(listeners(empty), [0, 0, 0]);
});

test('A layer that already failed reports those errors immediately so the caller can select a fallback', async () => {
  const e = environment();
  const target = layer([tile('failed'), tile('failed')], false);
  assert.deepEqual(plain(await e.wait(target, 180000)), {loaded:0, failed:2, pending:0, timedOut:false});
  assert.equal(e.timers.size, 0);
  assert.deepEqual(listeners(target), [0, 0, 0]);
});

test('An empty layer still requesting tiles stays bounded by the timeout', async () => {
  const e = environment();
  const target = layer([], true);
  const result = e.wait(target, 500);
  e.advance(500);
  assert.deepEqual(plain(await result), {loaded:0, failed:0, pending:0, timedOut:true});
  assert.deepEqual(listeners(target), [0, 0, 0]);
});

test('Layers without a tile inventory count events once and wait for the load signal', async () => {
  const e = environment();
  const target = layer();
  delete target._tiles;
  const image = {};
  const result = e.wait(target, 8000);
  target.emit('tileload', {tile:image});
  target.emit('tileload', {tile:image});
  target.emit('tileerror', {tile:{}});
  target.loading = false;
  target.emit('load');
  assert.deepEqual(plain(await result), {loaded:1, failed:1, pending:0, timedOut:false});
  assert.equal(e.timers.size, 0);
});
