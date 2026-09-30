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
  let opening = null;

  function abortError() {
    return new DOMException('Descarga cancelada.', 'AbortError');
  }

  function ensureNotAborted(signal) {
    if (signal && signal.aborted) throw abortError();
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
    return '[out:json][timeout:50];' +
      '(way["highway"~"^(' + ROAD_KINDS + ')$"](' + box + ');' +
      'way["waterway"~"^(' + WATER_KINDS + ')$"](' + box + ');)->.roads;' +
      '(nw[~"^(amenity|shop|tourism|leisure|historic|healthcare)$"~"."](' + box + ');)->.places;' +
      '.roads out geom;' +
      '.places out center tags;';
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      ensureNotAborted(signal);
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function requestOverpass(endpoint, query, signal) {
    ensureNotAborted(signal);
    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 65000);
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
          const after = response.headers.get('Retry-After');
          const seconds = Number(after);
          const dateMs = after && !Number.isFinite(seconds) ? Date.parse(after) - Date.now() : NaN;
          error.retryAfterMs = Math.max(1000, Math.min(30000,
            Number.isFinite(seconds) && after ? seconds * 1000 :
              Number.isFinite(dateMs) ? dateMs : response.status === 429 ? 5000 : 2500));
        }
        throw error;
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.elements)) throw new Error('El servidor de calles devolvió una respuesta incompleta.');
      return data.elements;
    } catch (error) {
      if (signal && signal.aborted) throw abortError();
      if (timedOut) throw new Error('El servidor de calles tardó demasiado.');
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', relayAbort);
    }
  }

  function splitElements(elements) {
    const roads = [];
    const references = [];
    const referenceIds = new Set();
    for (const element of elements) {
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
    const signal = options && options.signal;
    const query = buildQuery(bounds);
    let lastError = null;
    for (let round = 0; round < 2; round++) {
      let retryDelay = 0;
      for (const endpoint of ENDPOINTS) {
        ensureNotAborted(signal);
        try {
          const elements = await requestOverpass(endpoint, query, signal);
          return splitElements(elements);
        } catch (error) {
          if (signal && signal.aborted) throw abortError();
          lastError = error;
          retryDelay = Math.max(retryDelay, Number(error.retryAfterMs) || 0);
        }
      }
      if (round === 0) await pause(Math.max(2000, retryDelay), signal);
    }
    throw lastError || new Error('No se pudieron descargar las calles.');
  }

  global.CroquisOfflineData = Object.freeze({ open, get, set, list, clear, status, download });
})(window);
