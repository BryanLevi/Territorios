/* Mide tinta de las teselas ya cargadas; nunca consulta un servicio externo. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CroquisPrintLabels = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const MAX_CANVAS_PIXELS = 4000000;
  const MAX_GRID_PIXELS = 4000000;
  const MAX_CANVAS_SIDE = 8192;

  function empty(reason, extra) {
    return Object.assign({boxes:[], reason}, extra || {});
  }

  // El paso equivale a unos dos píxeles de la tesela original. Las letras
  // se unen antes de medirlas, incluso si cruzan la unión de dos teselas.
  // Se conservan los límites de la tinta, no los del área dilatada.
  function detect(rgba, width, height, options) {
    width = Math.floor(Number(width));
    height = Math.floor(Number(height));
    if (!(width > 0 && height > 0) || !rgba || rgba.length < width * height * 4) {
      return empty('invalid-image');
    }
    const settings = options || {};
    const scale = Math.max(.05, Math.min(1, Number(settings.nativeScale) || 1));
    const step = Math.max(1, Math.round(2 * scale),
      Math.ceil(Math.sqrt(width * height / MAX_GRID_PIXELS)));
    const columns = Math.ceil(width / step), rows = Math.ceil(height / step);
    const total = columns * rows;
    const ink = new Uint8Array(total);
    const queue = new Uint32Array(total);
    let darkPixels = 0;
    for (let y = 0; y < height; y++) {
      let pixel = y * width * 4;
      const row = Math.floor(y / step) * columns;
      for (let x = 0; x < width; x++, pixel += 4) {
        const r = rgba[pixel], g = rgba[pixel + 1], b = rgba[pixel + 2];
        // Google dibuja el borde antialias de las carreteras con el mismo
        // RGB oscuro que el halo de las letras, pero con menos alfa. Pedir
        // tinta opaca evita que esos bordes unan todos los nombres del mapa.
        if (rgba[pixel + 3] < 250 || Math.max(r, g, b) > 135
          || r * .2126 + g * .7152 + b * .0722 > 90) continue;
        ink[row + Math.floor(x / step)] = 1;
        darkPixels++;
      }
    }
    if (!darkPixels) return empty('no-ink', {width, height, sampleStep:step});

    let ignoredLineComponents = 0;
    // Una carretera continua no debe unir todos los nombres en una caja.
    // Las letras se mantienen: su componente individual es mucho más corto.
    for (let index = 0; index < total; index++) {
      if (ink[index] !== 1) continue;
      let read = 0, write = 1;
      queue[0] = index;
      ink[index] = 2;
      let x0 = columns, y0 = rows, x1 = -1, y1 = -1;
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      while (read < write) {
        const cell = queue[read++], y = Math.floor(cell / columns), x = cell - y * columns;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(rows - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(columns - 1, x + 1); nx++) {
            const next = ny * columns + nx;
            if (ink[next] !== 1) continue;
            ink[next] = 2;
            queue[write++] = next;
          }
        }
      }
      const w = (x1 - x0 + 1) * step / scale;
      const h = (y1 - y0 + 1) * step / scale;
      const long = Math.max(w, h), short = Math.min(w, h);
      const occupancy = write / ((x1 - x0 + 1) * (y1 - y0 + 1));
      const xx = sxx / write - (sx / write) ** 2;
      const yy = syy / write - (sy / write) ** 2;
      const xy = sxy / write - sx * sy / (write * write);
      const difference = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
      const minor = Math.max(0, (xx + yy - difference) / 2);
      const major = Math.max(0, (xx + yy + difference) / 2);
      const minorSpread = Math.sqrt(minor) * step / scale;
      // Un halo puede unir todas las letras de un nombre muy largo: su
      // proporción sola no lo convierte en una carretera. El trazo lineal
      // también debe tener una dispersión transversal de unos dos píxeles.
      const linear = long >= 70 && (short <= 6
        || (minorSpread <= 2.2 && major > Math.max(.25, minor) * 90));
      const sprawling = long >= 400 && occupancy < .06;
      if (linear || sprawling || (w > 720 && h > 240)) {
        ignoredLineComponents++;
        for (let i = 0; i < write; i++) ink[queue[i]] = 0;
      }
    }
    for (let i = 0; i < total; i++) ink[i] = ink[i] ? 1 : 0;

    const horizontal = new Uint8Array(total), joined = new Uint8Array(total);
    // La unión horizontal salva espacios entre letras y palabras. Un margen
    // vertical menor conserva rótulos inclinados sin encadenar filas de
    // nombres cercanos en una sola caja que abarque toda la ciudad.
    const radius = Math.max(1, Math.ceil(4 * scale / step));
    const verticalRadius = Math.max(1, Math.ceil(2 * scale / step));
    for (let y = 0; y < rows; y++) {
      const start = y * columns;
      let sum = 0;
      for (let x = 0; x <= Math.min(columns - 1, radius); x++) sum += ink[start + x];
      for (let x = 0; x < columns; x++) {
        horizontal[start + x] = sum ? 1 : 0;
        if (x - radius >= 0) sum -= ink[start + x - radius];
        if (x + radius + 1 < columns) sum += ink[start + x + radius + 1];
      }
    }
    for (let x = 0; x < columns; x++) {
      let sum = 0;
      for (let y = 0; y <= Math.min(rows - 1, verticalRadius); y++) sum += horizontal[y * columns + x];
      for (let y = 0; y < rows; y++) {
        joined[y * columns + x] = sum ? 1 : 0;
        if (y - verticalRadius >= 0) sum -= horizontal[(y - verticalRadius) * columns + x];
        if (y + verticalRadius + 1 < rows) sum += horizontal[(y + verticalRadius + 1) * columns + x];
      }
    }

    const boxes = [];
    let components = 0;
    const padding = 5 * scale;
    for (let index = 0; index < total; index++) {
      if (!joined[index]) continue;
      let read = 0, write = 1, count = 0;
      queue[0] = index;
      joined[index] = 0;
      let x0 = columns, y0 = rows, x1 = -1, y1 = -1;
      while (read < write) {
        const cell = queue[read++], y = Math.floor(cell / columns), x = cell - y * columns;
        if (ink[cell]) {
          count++;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        for (let ny = Math.max(0, y - 1); ny <= Math.min(rows - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(columns - 1, x + 1); nx++) {
            const next = ny * columns + nx;
            if (!joined[next]) continue;
            joined[next] = 0;
            queue[write++] = next;
          }
        }
      }
      if (!count) continue;
      components++;
      const w = (x1 - x0 + 1) * step / scale, h = (y1 - y0 + 1) * step / scale;
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      // En mapas densos varios nombres cercanos forman una caja grande.
      // Descartarla por su tamaño volvía a cortar las palabras del borde.
      // Los trazos de carretera ya se filtraron antes de unir la tinta.
      if (count < 4 || Math.min(w, h) < 4 || Math.max(w, h) < 7
        || count / area < .008) continue;
      boxes.push({
        x0:Math.max(0, x0 * step - padding),
        y0:Math.max(0, y0 * step - padding),
        x1:Math.min(width, (x1 + 1) * step + padding),
        y1:Math.min(height, (y1 + 1) * step + padding)
      });
    }
    boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    return {boxes, reason:null, width, height, sampleStep:step, components, ignoredLineComponents};
  }

  function measure(targetMap, layer) {
    const container = targetMap?.getContainer?.(), size = targetMap?.getSize?.();
    const bounds = container?.getBoundingClientRect?.();
    if (!container || !(size?.x > 0 && size?.y > 0) || !(bounds?.width > 0 && bounds?.height > 0)) {
      return empty('unmeasured-map');
    }
    const doc = container.ownerDocument || (typeof document === 'object' ? document : null);
    if (!doc?.createElement || !layer?._tiles) return empty('canvas-unavailable');
    const tiles = Object.values(layer._tiles).filter(tile => tile?.current !== false
      && tile?.el?.complete && tile.el.naturalWidth > 0);
    if (!tiles.length) return empty('no-loaded-tiles');
    const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (size.x * size.y)),
      MAX_CANVAS_SIDE / size.x, MAX_CANVAS_SIDE / size.y);
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(size.x * scale));
    canvas.height = Math.max(1, Math.floor(size.y * scale));
    let context;
    try { context = canvas.getContext('2d', {willReadFrequently:true}); } catch (error) {
      return empty('canvas-unavailable');
    }
    if (!context?.drawImage || !context?.getImageData) return empty('canvas-unavailable');
    let drawn = 0;
    try {
      // Pintar juntas las teselas permite agrupar también palabras cortadas
      // por su borde. Sus rectángulos ya incluyen el zoom de Leaflet y del PDF.
      for (const tile of tiles) {
        const rect = tile.el.getBoundingClientRect?.();
        if (!(rect?.width > 0 && rect?.height > 0)) continue;
        const x = (rect.left - bounds.left) * size.x / bounds.width * scale;
        const y = (rect.top - bounds.top) * size.y / bounds.height * scale;
        const w = rect.width * size.x / bounds.width * scale;
        const h = rect.height * size.y / bounds.height * scale;
        if (x + w <= 0 || y + h <= 0 || x >= canvas.width || y >= canvas.height) continue;
        context.drawImage(tile.el, x, y, w, h);
        drawn++;
      }
      if (!drawn) return empty('no-visible-tiles');
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const result = detect(rgba, canvas.width, canvas.height, {nativeScale:scale});
      return Object.assign({}, result, {
        boxes:result.boxes.map(box => ({x0:box.x0 / scale, y0:box.y0 / scale,
          x1:box.x1 / scale, y1:box.y1 / scale})),
        width:size.x, height:size.y, compositeScale:scale, tiles:drawn,
        sampledPixels:canvas.width * canvas.height
      });
    } catch (error) {
      return empty('canvas-unreadable', {tiles:drawn});
    } finally {
      // Libera el respaldo RGBA entre territorios de una lámina grande.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  return Object.freeze({detect, measure});
});
