/* Datos abiertos de calles y referencias para el mapa sin conexión.
   No descarga ni conserva teselas de proveedores de mapas. */
(function (global) {
  'use strict';

  const DATABASE = 'croquis-offline-v1';
  const STORE = 'territories';
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  const REFERENCE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'healthcare'];
  const ROAD_KINDS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road|track|path|footway|steps|cycleway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
  const WATER_KINDS = 'river|stream|canal|ditch|drain';
  const REQUEST_TIMEOUT_MS = 25000;
  const DOWNLOAD_BUDGET_MS = 90000;
  const endpointState = new Map();
  let opening = null;

  function abortError() {
    return new DOMException('Descarga cancelada.', 'AbortError');
  }

  function ensureNotAborted(signal) {
    if (signal && signal.aborted) throw abortError();
    if (global.navigator && global.navigator.onLine === false) {
      throw new Error('Se perdió la conexión. Lo descargado se conserva; vuelve a intentarlo cuando tengas internet.');
    }
  }

  function open() {
    if (!global.indexedDB) return Promise.reject(new Error('Este navegador no permite guardar mapas sin conexión.'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('congregation', 'congregation', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento sin conexión.'));
      request.onblocked = () => reject(new Error('Cierra otras pestañas de esta página y vuelve a intentar.'));
    }).catch(error => {
      opening = null;
      throw error;
    });
    return opening;
  }

  function normalizeId(value) {
    const id = String(value == null ? '' : value).trim();
    if (!id) throw new Error('Falta identificar la congregación o el territorio.');
    return id;
  }

  function recordId(congregation, key) {
    return JSON.stringify([normalizeId(congregation), normalizeId(key)]);
  }

  async function get(congregation, key) {
    const id = recordId(congregation, key);
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el mapa descargado.'));
    });
  }

  async function set(congregation, key, data) {
    const group = normalizeId(congregation);
    const territory = normalizeId(key);
    const record = {
      id: recordId(group, territory),
      congregation: group,
      key: territory,
      updatedAt: Date.now(),
      data
    };
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el mapa descargado.'));
      tx.onabort = () => reject(tx.error || new Error('No hay espacio suficiente para guardar el mapa.'));
    });
    return record;
  }

  async function list(congregation) {
    const group = normalizeId(congregation);
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).index('congregation').getAll(group);
      request.onsuccess = () => resolve((request.result || []).map(record => ({
        key: record.key,
        updatedAt: record.updatedAt,
        data: record.data
      })));
      request.onerror = () => reject(request.error || new Error('No se pudieron consultar los mapas descargados.'));
    });
  }

  async function clear(congregation) {
    const group = normalizeId(congregation);
    const db = await open();
    return new Promise((resolve, reject) => {
      let removed = 0;
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).index('congregation').openKeyCursor(group);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        tx.objectStore(STORE).delete(cursor.primaryKey);
        removed++;
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error || new Error('No se pudieron quitar los mapas descargados.'));
      tx.onabort = () => reject(tx.error || new Error('No se pudieron quitar los mapas descargados.'));
    });
  }

  async function status(congregation) {
    const group = normalizeId(congregation);
    const db = await open();
    return new Promise((resolve, reject) => {
      let count = 0;
      let updatedAt = 0;
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).index('congregation').openCursor(group);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        count++;
        updatedAt = Math.max(updatedAt, cursor.value.updatedAt || 0);
        cursor.continue();
      };
      tx.oncomplete = () => resolve({ count, updatedAt });
      tx.onerror = () => reject(tx.error || new Error('No se pudo consultar el mapa descargado.'));
    });
  }

  function plainBounds(bounds) {
    const value = bounds && typeof bounds.getSouth === 'function' ? {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    } : bounds || {};
    const numbers = ['south', 'west', 'north', 'east'].map(name => Number(value[name]));
    const [south, west, north, east] = numbers;
    if (numbers.some(number => !Number.isFinite(number)) || south >= north || west >= east ||
        south < -90 || north > 90 || west < -180 || east > 180) {
      throw new Error('El territorio no tiene límites válidos para la descarga.');
    }
    return numbers.map(number => number.toFixed(6)).join(',');
  }

  function buildQuery(bounds) {
    const box = plainBounds(bounds);
    // Dos conjuntos y dos salidas dentro de UNA petición. Las calles conservan
    // su geometría; los lugares, su punto central. Luego se separan por tipo.
    return '[out:json][timeout:20];' +
      '(way["highway"~"^(' + ROAD_KINDS + ')$"](' + box + ');' +
      'way["waterway"~"^(' + WATER_KINDS + ')$"](' + box + ');)->.roads;' +
      '(nw[~"^(amenity|shop|tourism|leisure|historic|healthcare)$"~"."](' + box + ');)->.places;' +
      '.roads out geom;' +
      '.places out center tags;';
  }

  function remainingTime(deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('La descarga sigue pendiente porque los servidores están ocupados. Los mapas ya guardados se conservan.');
    return remaining;
  }

  function retryAfter(response, fallback) {
    const after = response.headers && response.headers.get('Retry-After');
    const seconds = after && Number(after);
    if (after && Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
    const date = after && Date.parse(after);
    return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : fallback;
  }

  function notify(options, details) {
    if (typeof options.onProgress === 'function') options.onProgress(details);
  }

  function orderedEndpoints() {
    return ENDPOINTS.slice().sort((a, b) =>
      (endpointState.get(b)?.lastSuccess || 0) - (endpointState.get(a)?.lastSuccess || 0));
  }

  async function requestOverpass(endpoint, query, signal, deadline) {
    ensureNotAborted(signal);
    const requestTime = Math.min(REQUEST_TIMEOUT_MS, remainingTime(deadline));
    const controller = new AbortController();
    let timedOut = false;
    let disconnected = false;
    const relayAbort = () => controller.abort();
    const offline = () => {
      disconnected = true;
      controller.abort();
    };
    if (signal) signal.addEventListener('abort', relayAbort, { once: true });
    if (global.addEventListener) global.addEventListener('offline', offline, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTime);
    try {
      const response = await global.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(response.status === 429
          ? 'El servidor de calles está ocupado; vuelve a intentar en unos momentos.'
          : 'Servidor de calles: ' + response.status);
        if (response.status === 429 || response.status === 503) {
          error.retryAfterMs = retryAfter(response, response.status === 429 ? 30000 : 10000);
        }
        error.splitEligible = response.status === 504;
        throw error;
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.elements)) throw new Error('El servidor de calles devolvió una respuesta incompleta.');
      if (String(data.remark || '').trim()) {
        const error = new Error('El servidor no terminó de preparar todas las calles y referencias.');
        error.splitEligible = /timeout|timed?\s*out|out of memory|run out of memory|resource|runtime error/i.test(data.remark);
        throw error;
      }
      ensureNotAborted(signal);
      remainingTime(deadline);
      return data.elements;
    } catch (error) {
      if (signal && signal.aborted) throw abortError();
      if (disconnected) throw new Error('Se perdió la conexión. Los mapas ya guardados se conservan.');
      ensureNotAborted(signal);
      if (timedOut) {
        const timeout = new Error('El servidor de calles está tardando en responder.');
        timeout.splitEligible = true;
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', relayAbort);
      if (global.removeEventListener) global.removeEventListener('offline', offline);
    }
  }

  function subdivide(bounds) {
    const [south, west, north, east] = plainBounds(bounds).split(',').map(Number);
    const middleLat = (south + north) / 2;
    const middleLon = (west + east) / 2;
    return [
      { south, west, north:middleLat, east:middleLon },
      { south, west:middleLon, north:middleLat, east },
      { south:middleLat, west, north, east:middleLon },
      { south:middleLat, west:middleLon, north, east }
    ];
  }

  function mergeElements(collections) {
    const elements = new Map();
    const unidentified = [];
    for (const collection of collections) {
      for (const element of collection) {
        if (!element || element.id == null || !element.type) {
          if (element) unidentified.push(element);
          continue;
        }
        const key = String(element.type) + ':' + String(element.id);
        const existing = elements.get(key);
        elements.set(key, existing ? {
          ...existing, ...element,
          tags:{...existing.tags, ...element.tags},
          ...(existing.geometry && !element.geometry ? {geometry:existing.geometry} : {}),
          ...(existing.center && !element.center ? {center:existing.center} : {})
        } : element);
      }
    }
    return [...elements.values(), ...unidentified];
  }

  function splitElements(elements) {
    const roads = [];
    const references = [];
    const referenceIds = new Set();
    for (const element of elements) {
      if (!element || typeof element !== 'object') continue;
      const tags = element && element.tags || {};
      if (element.type === 'way' && Array.isArray(element.geometry) && element.geometry.length >= 2 &&
          (tags.highway || tags.waterway)) {
        roads.push(element);
      }
      if (!REFERENCE_KEYS.some(key => tags[key])) continue;
      if (!Number.isFinite(Number(element.lat ?? element.center?.lat)) ||
          !Number.isFinite(Number(element.lon ?? element.center?.lon))) continue;
      const id = String(element.type) + ':' + String(element.id);
      if (referenceIds.has(id)) continue;
      referenceIds.add(id);
      references.push(element);
    }
    return { roadElements: roads, referenceElements: references };
  }

  async function download(bounds, options) {
    options = options || {};
    const signal = options.signal;
    const deadline = Date.now() + DOWNLOAD_BUDGET_MS;
    // Se intenta cada servidor una vez. Las respuestas con errores de ejecución
    // nunca se guardan como completas, aunque contengan algunos elementos.
    async function downloadBox(box, part, total) {
      const query = buildQuery(box);
      let lastError = null;
      let splitEligible = false;
      let attempt = 0;
      for (const endpoint of orderedEndpoints()) {
        ensureNotAborted(signal);
        remainingTime(deadline);
        const state = endpointState.get(endpoint) || {};
        if (state.cooldownUntil > Date.now()) {
          lastError = state.lastError || lastError;
          continue;
        }
        try {
          notify(options, {phase:attempt ? 'retry' : 'request', endpoint, part, total,
            message:attempt ? 'Probando otro servidor de mapas…' :
              total > 1 ? 'Guardando zona ' + part + ' de ' + total + '…' : 'Consultando calles y referencias…'});
          attempt++;
          const elements = await requestOverpass(endpoint, query, signal, deadline);
          endpointState.set(endpoint, {lastSuccess:Date.now(), cooldownUntil:0});
          return elements;
        } catch (error) {
          if (signal && signal.aborted) throw abortError();
          ensureNotAborted(signal);
          lastError = error;
          splitEligible = splitEligible || !!error.splitEligible;
          endpointState.set(endpoint, {...state, lastError:error,
            cooldownUntil:error.retryAfterMs ? Date.now() + error.retryAfterMs : 0});
        }
      }
      remainingTime(deadline);
      const error = lastError || new Error('Los servidores de mapas están ocupados. Vuelve a intentarlo en unos momentos.');
      error.splitEligible = splitEligible;
      throw error;
    }
    try {
      return splitElements(mergeElements([await downloadBox(bounds, 1, 1)]));
    } catch (error) {
      ensureNotAborted(signal);
      remainingTime(deadline);
      if (!error.splitEligible) throw error;
      notify(options, {phase:'split', part:0, total:4,
        message:'Preparando el territorio en 4 zonas más pequeñas…'});
      const collections = [];
      const cells = subdivide(bounds);
      for (let index = 0; index < cells.length; index++) {
        collections.push(await downloadBox(cells[index], index + 1, cells.length));
      }
      return splitElements(mergeElements(collections));
    }
  }

  global.CroquisOfflineData = Object.freeze({ open, get, set, list, clear, status, download });
})(window);
