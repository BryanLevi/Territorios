const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {unionPath} = require('../outputs/print-clip-geometry.js');

// Independently read the SVG pieces and evaluate their nonzero winding.
// Circles are sampled only for these membership checks, never in production.
function contours(svg) {
  const tokens = svg.match(/[MLAZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
  const result = [];
  let i = 0, points = [];
  const read = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') points = [{x:read(), y:read()}];
    else if (command === 'L') points.push({x:read(), y:read()});
    else if (command === 'A') {
      const rx = read(), ry = read(), rotation = read(), large = read(), sweep = read();
      const end = {x:read(), y:read()}, start = points[points.length - 1];
      assert(rx > 0 && rx === ry && rotation === 0 && large === 1 && sweep === 1);
      const center = {x:(start.x + end.x) / 2, y:start.y};
      assert(Math.abs(end.y - start.y) < 2e-6);
      assert(Math.abs(Math.abs(start.x - end.x) - 2 * rx) < 2e-6);
      const angle = start.x > center.x ? 0 : Math.PI;
      for (let step = 1; step <= 64; step++) {
        const a = angle + Math.PI * step / 64;
        points.push({x:center.x + rx * Math.cos(a), y:center.y + ry * Math.sin(a)});
      }
      points[points.length - 1] = end;
    } else if (command === 'Z') result.push(points);
    else assert.fail('Unexpected SVG command: ' + command);
  }
  return result;
}

function winding(points, point) {
  let result = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && side > 0) result++;
    if (a.y > point.y && b.y <= point.y && side < 0) result--;
  }
  return result;
}

function area(points) {
  return points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}

function distanceToEdge(point, points) {
  return Math.min(...points.map((a, i) => {
    const b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }));
}

test('Triangle and concave territory clips preserve their geographic interior and exterior', () => {
  const triangle = [{x:0,y:0},{x:12,y:0},{x:6,y:9}];
  const concave = [{x:20,y:0},{x:32,y:0},{x:32,y:4},{x:24,y:4},{x:24,y:12},{x:20,y:12}];
  const pieces = contours(unionPath([triangle.slice().reverse(), concave]));
  assert.equal(pieces.length, 2);
  assert(pieces.every(points => area(points) > 0));
  for (let y = -.63; y < 13; y += .71) for (let x = -.37; x < 34; x += .73) {
    const point = {x,y};
    const expected = [triangle, concave].some(polygon => winding(polygon, point) !== 0);
    assert.equal(pieces.reduce((sum, polygon) => sum + winding(polygon, point), 0) !== 0, expected,
      'Geographic membership at ' + JSON.stringify(point));
  }
  assert.equal(pieces.reduce((sum, polygon) => sum + winding(polygon,{x:29,y:9}),0),0,
    'A concave notch remains outside instead of becoming a convex hull');
});

test('Opposite input orientations and overlapping label boxes form a union without holes', () => {
  const a = [{x:0,y:0},{x:12,y:0},{x:12,y:12},{x:0,y:12}];
  const b = [{x:6,y:6},{x:18,y:6},{x:18,y:18},{x:6,y:18}].reverse();
  const boxes = [{x0:8,y0:8,x1:22,y1:14},{x0:9,y0:9,x1:15,y1:20}];
  const before = JSON.stringify({a,b,boxes});
  const pieces = contours(unionPath([a,b],boxes));
  assert(pieces.every(points => area(points) > 0));
  assert.equal(pieces.reduce((sum, polygon) => sum + winding(polygon,{x:10,y:10}),0),1,
    'Overlapping bodies are merged once instead of canceling or repeating a painted area');
  assert.equal(pieces.reduce((sum, polygon) => sum + winding(polygon,{x:21,y:12}),0),1,
    'A whole name can open its rectangle beyond the geographic border');
  assert.equal(pieces.reduce((sum, polygon) => sum + winding(polygon,{x:24,y:12}),0),0);
  assert.equal(JSON.stringify({a,b,boxes}), before, 'Saved geometry is never rewritten during export');
});

test('Rounded dilation matches distance to a concave polygon while label rectangles stay unchanged', () => {
  const polygon = [{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}];
  const box = {x0:20,y0:20,x1:24,y1:24}, radius = 2;
  const pieces = contours(unionPath([polygon],[box],radius));
  assert(pieces.every(points => area(points) > 0));
  for (let y = -2.73; y < 13; y += .47) for (let x = -2.39; x < 13; x += .51) {
    const point = {x,y}, distance = distanceToEdge(point,polygon);
    if (Math.abs(distance - radius) < radius * .005) continue;
    const expected = winding(polygon,point) !== 0 || distance < radius;
    assert.equal(pieces.some(part => winding(part,point) !== 0),expected,
      'Rounded geographic margin at ' + JSON.stringify(point));
  }
  assert(!pieces.some(part => winding(part,{x:19,y:22}) !== 0),
    'Measured letter padding is not enlarged a second time');
  assert(!pieces.some(part => winding(part,{x:-1.8,y:-1.8}) !== 0),
    'Round joins do not acquire square corners');
});

test('Invalid, empty and degenerate geometry never produces nonfinite SVG coordinates', () => {
  const line = [{x:0,y:0},{x:1,y:1},{x:2,y:2}];
  const valid = [{x:0,y:0},{x:8,y:0},{x:8,y:8},{x:0,y:8}];
  const svg = unionPath([null,[],line,[{x:0,y:0},{x:Infinity,y:0},{x:8,y:8}],
    [{x:0,y:0},{x:8,y:NaN},{x:8,y:8}],valid],
  [{x0:0,y0:0,x1:0,y1:8},{x0:0,y0:0,x1:Infinity,y1:8}],Infinity);
  assert.equal(contours(svg).length,1);
  assert(!/NaN|Infinity|undefined/.test(svg));
  assert.equal(unionPath(null,null,NaN),'');
  assert.equal(unionPath([valid],[], -2),unionPath([valid]));
  assert.equal(unionPath([valid.concat(valid[0])]),unionPath([valid]));
  const tiny = unionPath([valid],[],1e-8);
  assert(!/A0(?: |A)/.test(tiny), 'A positive margin never rounds to an invalid zero-radius arc');
});

test('Dense territory outlines remove at least 90 percent of overlapping clip pieces', () => {
  const count = 1024;
  const polygon = Array.from({length:count}, (_,i) => {
    const angle = Math.PI * 2 * i / count;
    return {x:100 + 40 * Math.cos(angle),y:100 + 40 * Math.sin(angle)};
  });
  const svg = unionPath([polygon],[],3);
  assert((svg.match(/M/g)||[]).length < (1 + count * 2) * .1,
    'Repeated strips and circles are reduced to a compact union boundary');
  assert.equal((svg.match(/A/g)||[]).length,0,
    'The successful boolean union avoids thousands of PDF cubic curves');
  assert(!/NaN|Infinity/.test(svg));
  const pieces = contours(svg);
  assert(pieces.some(part => winding(part,{x:142,y:100}) !== 0));
  assert(!pieces.some(part => winding(part,{x:144,y:100}) !== 0));
});

test('The same pure clip API is available in the browser without a module loader', () => {
  const source = fs.readFileSync(path.join(__dirname,'../outputs/print-clip-geometry.js'),'utf8');
  const window = {ClipperLib:require('../vendor/clipper-lib/clipper.js')};
  vm.runInNewContext(source,{window});
  assert.equal(typeof window.CroquisPrintClipGeometry.unionPath,'function');
  assert(Object.isFrozen(window.CroquisPrintClipGeometry));
  assert.equal(window.CroquisPrintClipGeometry.unionPath([], [{x0:0,y0:0,x1:3,y1:4}]),
    unionPath([], [{x0:0,y0:0,x1:3,y1:4}]));
});

test('An enclosed geographic gap retains correct winding and shrinks under round dilation', () => {
  const frame = [
    [{x:0,y:0},{x:20,y:0},{x:20,y:6},{x:0,y:6}],
    [{x:0,y:14},{x:20,y:14},{x:20,y:20},{x:0,y:20}].reverse(),
    [{x:0,y:6},{x:6,y:6},{x:6,y:14},{x:0,y:14}],
    [{x:14,y:6},{x:20,y:6},{x:20,y:14},{x:14,y:14}].reverse()
  ];
  const membership = (parts,point) => parts.reduce((sum,p) => sum + winding(p,point),0);
  const parts = contours(unionPath(frame));
  // A union may connect the inner and outer loops by a doubled zero-area
  // edge. Test the resulting nonzero clip, not its arbitrary ring splitting.
  assert.equal(membership(parts,{x:10,y:10}),0,'A real gap remains outside');
  assert.equal(membership(parts,{x:3,y:10}),1);
  for (let y = -.3; y < 21; y += .61) for (let x = -.4; x < 21; x += .67) {
    const point = {x,y};
    assert.equal(membership(parts,point)!==0,frame.some(p => winding(p,point)!==0));
  }
  const grown = contours(unionPath(frame,[],1));
  assert.equal(grown.filter(p => area(p)>0).length,1);
  assert.equal(grown.filter(p => area(p)<0).length,1,'An offset hole winds opposite to the outer boundary');
  assert.equal(membership(grown,{x:10,y:10}),0);
  assert.equal(membership(grown,{x:6.5,y:10}),1,'Dilation advances into the geographic gap');
  assert.equal(membership(grown,{x:-.5,y:10}),1,'Dilation also advances outside the outer border');
  const closed = contours(unionPath(frame,[],5));
  assert.equal(closed.length,1);
  assert.equal(membership(closed,{x:10,y:10}),1,'A gap narrower than the margin disappears');
  const restored = contours(unionPath(frame,[{x0:5,y0:5,x1:15,y1:15}]));
  assert.equal(restored.length,1,'A whole label rectangle can bridge the gap');
  assert.equal(membership(restored,{x:10,y:10}),1);
});

test('Round corner approximation stays within half a percent of the native margin', () => {
  const square = [{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
  for (const radius of [.5,2,4.5,108]) {
    const pieces = contours(unionPath([square],[],radius));
    for (let i = 0; i <= 120; i++) {
      const angle = Math.PI + Math.PI/2 * i/120;
      const inside = {x:Math.cos(angle)*radius*.995,y:Math.sin(angle)*radius*.995};
      const outside = {x:Math.cos(angle)*radius*1.005,y:Math.sin(angle)*radius*1.005};
      assert(pieces.some(part => winding(part,inside)!==0),'Missing round margin at r='+radius+' angle='+angle);
      assert(!pieces.some(part => winding(part,outside)!==0),'Round margin too large at r='+radius+' angle='+angle);
    }
  }
});

test('Missing or failing boolean dependencies retain the finite exact-arc fallback', () => {
  const source = fs.readFileSync(path.join(__dirname,'../outputs/print-clip-geometry.js'),'utf8');
  const polygon = [{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}];
  const boxes = [{x0:20,y0:20,x1:24,y1:24}], before = JSON.stringify({polygon,boxes});
  let missingPath;
  for (const ClipperLib of [undefined,{Clipper:function(){throw new Error('test failure');},ClipperOffset:function(){}}]) {
    const window = {ClipperLib};
    vm.runInNewContext(source,{window});
    const svg = window.CroquisPrintClipGeometry.unionPath([polygon],boxes,2);
    assert.equal((svg.match(/A/g)||[]).length,polygon.length*2);
    assert(!/NaN|Infinity/.test(svg));
    const pieces = contours(svg);
    assert(pieces.every(p => area(p)>0),'Fallback pieces all contribute positive winding');
    assert(pieces.some(p => winding(p,{x:-1,y:0})!==0));
    assert(!pieces.some(p => winding(p,{x:19,y:22})!==0),'Fallback never enlarges label boxes');
    if (missingPath) assert.equal(svg,missingPath); else missingPath=svg;
  }
  assert.equal(JSON.stringify({polygon,boxes}),before);
  assert.equal(unionPath([polygon],boxes,1e-8).includes('A'),true,
    'Margins below the integer grid retain exact geometry through fallback');
});
