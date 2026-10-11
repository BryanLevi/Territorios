/* Unión vectorial para recortar la impresión sin máscaras rasterizadas. */
(function (root, factory) {
  'use strict';
  let clipping = root?.ClipperLib;
  if (typeof module === 'object' && module.exports) {
    try { clipping = require('../vendor/clipper-lib/clipper.js'); } catch (error) {}
  }
  const api = factory(clipping);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CroquisPrintClipGeometry = api;
})(typeof window === 'object' ? window : globalThis, function (clipping) {
  'use strict';

  const grid = 1000;

  function number(value) {
    // Evita -0 y conserva precisión por debajo de un píxel de impresión.
    const rounded = Number(value.toFixed(6));
    return String(rounded === 0 && value !== 0 ? value : rounded);
  }

  function positivePolygon(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const clean = [];
    for (const point of points) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
      const previous = clean[clean.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y) {
        clean.push({x:point.x, y:point.y});
      }
    }
    const first = clean[0], last = clean[clean.length - 1];
    if (clean.length > 1 && first.x === last.x && first.y === last.y) clean.pop();
    if (clean.length < 3) return null;
    // Las diferencias respecto al origen evitan restar productos enormes
    // cuando un polígono pequeño está lejos del origen del mapa.
    let twiceArea = 0;
    for (let i = 1; i + 1 < clean.length; i++) {
      const a = clean[i], b = clean[i + 1];
      twiceArea += (a.x - first.x) * (b.y - first.y)
        - (a.y - first.y) * (b.x - first.x);
    }
    if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= 1e-9) return null;
    if (twiceArea < 0) clean.reverse();
    return clean;
  }

  function polygonPath(points) {
    return 'M' + points.map(point => number(point.x) + ' ' + number(point.y)).join('L') + 'Z';
  }

  function unmergedPath(polygons, boxes = [], radius = 0) {
    const paths = [];
    const grow = Number.isFinite(radius) && radius > 0 ? radius : 0;
    for (const input of Array.isArray(polygons) ? polygons : []) {
      const points = positivePolygon(input);
      if (!points) continue;
      paths.push(polygonPath(points));
      if (!grow) continue;
      // clipPath ignora stroke. Rectángulos en cada segmento y círculos en
      // cada vértice producen el mismo margen con uniones redondas.
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length > 0 && Number.isFinite(length)) {
          const nx = -dy / length * grow, ny = dx / length * grow;
          const strip = positivePolygon([
            {x:a.x - nx, y:a.y - ny}, {x:b.x - nx, y:b.y - ny},
            {x:b.x + nx, y:b.y + ny}, {x:a.x + nx, y:a.y + ny}
          ]);
          if (strip) paths.push(polygonPath(strip));
        }
        const left = a.x - grow, right = a.x + grow;
        if (Number.isFinite(left) && Number.isFinite(right)) {
          const r = number(grow), y = number(a.y);
          paths.push('M' + number(right) + ' ' + y
            + 'A' + r + ' ' + r + ' 0 1 1 ' + number(left) + ' ' + y
            + 'A' + r + ' ' + r + ' 0 1 1 ' + number(right) + ' ' + y + 'Z');
        }
      }
    }
    // Las cajas ya incluyen el aire medido alrededor de las letras. No se
    // amplían otra vez: así conservan exactamente el recorte anterior.
    for (const box of Array.isArray(boxes) ? boxes : []) {
      if (!box || !['x0','y0','x1','y1'].every(key => Number.isFinite(box[key]))
        || box.x1 <= box.x0 || box.y1 <= box.y0) continue;
      const points = positivePolygon([
        {x:box.x0, y:box.y0}, {x:box.x1, y:box.y0},
        {x:box.x1, y:box.y1}, {x:box.x0, y:box.y1}
      ]);
      if (points) paths.push(polygonPath(points));
    }
    // Todas las piezas giran en el mismo sentido: con clip-rule="nonzero"
    // sus intersecciones siguen dentro del recorte, nunca abren agujeros.
    return paths.join('');
  }

  function integerPath(points) {
    const result = points.map(point => {
      const X = Math.round(point.x * grid), Y = Math.round(point.y * grid);
      if (!Number.isSafeInteger(X) || !Number.isSafeInteger(Y)
        || Math.abs(X) > 4503599627370495 || Math.abs(Y) > 4503599627370495) {
        throw new Error('clip-coordinate-range');
      }
      return {X,Y};
    });
    if (Math.abs(clipping.Clipper.Area(result)) < 1) throw new Error('clip-grid-degenerate');
    if (!clipping.Clipper.Orientation(result)) result.reverse();
    return result;
  }

  function merge(paths) {
    if (!paths.length) return [];
    const clip = new clipping.Clipper(), result = [];
    clip.AddPaths(paths,clipping.PolyType.ptSubject,true);
    if (!clip.Execute(clipping.ClipType.ctUnion,result,
      clipping.PolyFillType.pftNonZero,clipping.PolyFillType.pftNonZero)) {
      throw new Error('clip-union-failed');
    }
    return result;
  }

  function mergedPath(polygons, boxes, radius) {
    const bodies = [];
    for (const input of Array.isArray(polygons) ? polygons : []) {
      const points = positivePolygon(input);
      if (points) bodies.push(integerPath(points));
    }
    const rectangles = [];
    for (const box of Array.isArray(boxes) ? boxes : []) {
      if (!box || !['x0','y0','x1','y1'].every(key => Number.isFinite(box[key]))
        || box.x1 <= box.x0 || box.y1 <= box.y0) continue;
      const points = positivePolygon([
        {x:box.x0,y:box.y0},{x:box.x1,y:box.y0},
        {x:box.x1,y:box.y1},{x:box.x0,y:box.y1}
      ]);
      if (points) rectangles.push(integerPath(points));
    }
    const grow = Number.isFinite(radius) && radius > 0 ? radius : 0;
    let pieces = bodies;
    if (grow && bodies.length) {
      // La unión previa elimina bordes internos. ClipperOffset dilata sólo
      // los contornos resultantes y contrae sus huecos, con uniones redondas.
      // El error circular es <= 0.2% del radio, más 0.001 píxel de la rejilla.
      if (grow * grid < 1 || !Number.isSafeInteger(Math.round(grow * grid))) {
        throw new Error('clip-radius-range');
      }
      const body = merge(bodies), offset = new clipping.ClipperOffset(2,Math.max(.5,grow*grid*.002));
      offset.AddPaths(body,clipping.JoinType.jtRound,clipping.EndType.etClosedPolygon);
      pieces = [];
      offset.Execute(pieces,grow*grid);
    }
    pieces = pieces.concat(rectangles);
    if (!pieces.length) return '';
    const merged = merge(pieces);
    if (!merged.length) throw new Error('empty-clip-union');
    const paths = [];
    // Clipper devuelve exteriores positivos y huecos negativos.
    // Conservar ambos sentidos mantiene patios y otros vacíos de la unión.
    for (const boundary of merged) {
      if (!Array.isArray(boundary) || boundary.length < 3) throw new Error('invalid-clip-ring');
      const points = boundary.map(point => {
        if (!Number.isFinite(point.X) || !Number.isFinite(point.Y)) throw new Error('invalid-clip-point');
        return {x:point.X/grid,y:point.Y/grid};
      });
      paths.push(polygonPath(points));
    }
    return paths.join('');
  }

  function unionPath(polygons, boxes = [], radius = 0) {
    if (typeof clipping?.Clipper === 'function' && typeof clipping?.ClipperOffset === 'function') {
      try { return mergedPath(polygons,boxes,radius); } catch (error) {}
    }
    // Una carga incompleta o un caso numérico rechazado conserva el recorte
    // vectorial anterior, con arcos exactos y sin depender de la biblioteca.
    return unmergedPath(polygons,boxes,radius);
  }

  return Object.freeze({unionPath});
});
