/* Service worker del croquis de territorios.
   Guarda la pagina y las teselas de Carto para poder trabajar sin internet.
   Las teselas de Google no se guardan: sus terminos no lo permiten. */

const APP_CACHE = 'croquis-app-v1';
const TILE_CACHE = 'croquis-teselas-v1';
const CACHES_VIGENTES = [APP_CACHE, TILE_CACHE];

const ARCHIVOS_BASE = [
  './',
  './index.html',
  './outputs/croquis_territorios.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

function esTesela(url){
  return url.hostname.endsWith('.basemaps.cartocdn.com');
}

function esOverpass(url){
  return url.hostname.includes('overpass');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Sin all-or-nothing: si un archivo falla, el resto igual queda guardado
    await Promise.all(ARCHIVOS_BASE.map(async archivo => {
      try{
        const respuesta = await fetch(archivo, { cache:'reload' });
        if(respuesta.ok) await cache.put(archivo, respuesta);
      }catch(e){}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.map(nombre => CACHES_VIGENTES.includes(nombre) ? null : caches.delete(nombre)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;

  let url;
  try{ url = new URL(request.url); }catch(e){ return; }

  // Teselas de Carto: primero lo guardado, para que el mapa aparezca sin internet
  if(esTesela(url)){
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const guardada = await cache.match(url.href, { ignoreVary:true });
      if(guardada) return guardada;
      try{
        const respuesta = await fetch(request);
        if(respuesta && respuesta.ok && respuesta.type !== 'opaque'){
          cache.put(url.href, respuesta.clone());
        }
        return respuesta;
      }catch(e){
        return new Response('', { status:504, statusText:'Sin internet y sin tesela guardada' });
      }
    })());
    return;
  }

  // Overpass no se guarda: sus respuestas cambian y pesan poco
  if(esOverpass(url)) return;

  // La pagina y Leaflet: red primero, y sin pasar por el cache HTTP del
  // navegador. Con un fetch normal se puede devolver una copia vieja y la
  // pagina se queda clavada en una version anterior aunque ya haya uma nueva.
  if(url.origin === self.location.origin || ARCHIVOS_BASE.includes(url.href)){
    event.respondWith((async () => {
      try{
        const respuesta = await fetch(request, { cache:'no-store' });
        if(respuesta && respuesta.ok){
          const cache = await caches.open(APP_CACHE);
          cache.put(request, respuesta.clone());
        }
        return respuesta;
      }catch(e){
        const guardada = await caches.match(request, { ignoreVary:true });
        if(guardada) return guardada;
        throw e;
      }
    })());
  }
});

self.addEventListener('message', event => {
  const datos = event.data || {};
  if(datos.tipo === 'borrar-teselas'){
    event.waitUntil((async () => {
      await caches.delete(TILE_CACHE);
      event.source?.postMessage({ tipo:'teselas-borradas' });
    })());
  }
  if(datos.tipo === 'contar-teselas'){
    event.waitUntil((async () => {
      const cache = await caches.open(TILE_CACHE);
      const claves = await cache.keys();
      event.source?.postMessage({ tipo:'conteo-teselas', total:claves.length });
    })());
  }
});
