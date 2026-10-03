/* App shell for the croquis. Map tiles and external APIs are never cached here. */
const APP_CACHE = 'croquis-app-shell-v11';
const APP_FILES = [
  './',
  './index.html',
  './croquis-territorios-jw/',
  './croquis-territorios-jw/index.html',
  './croquis-territorio-jw/',
  './croquis-territorio-jw/index.html',
  './coquis-territorios-jw/',
  './coquis-territorios-jw/index.html',
  './outputs/croquis_territorios.html',
  './outputs/offline-map-details.js',
  './outputs/offline-data.js',
  './outputs/destination-placement.js',
  './outputs/offline-controller.js',
  './outputs/congregation-password.js',
  './outputs/congregation-access.js',
  './outputs/favicon.svg',
  './tokens.css',
  './outputs/welcome-premium.css',
  './outputs/toolbar-premium.css',
  './outputs/editor-premium.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
];
const APP_URLS = APP_FILES.map(file => new URL(file, self.registration.scope));
const APP_PATHS = new Set(APP_URLS.map(url => url.pathname));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_URLS.map(url => new Request(url.href, { cache:'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name === 'croquis-app-v1' || name === 'croquis-teselas-v1' ||
      (name.startsWith('croquis-app-shell-') && name !== APP_CACHE)
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data?.type !== 'CACHE_SHELL') return;
  event.waitUntil((async () => {
    try{
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(APP_URLS.map(url => new Request(url.href, { cache:'reload' })));
      event.ports[0]?.postMessage({ ok:true });
    }catch(error){
      event.ports[0]?.postMessage({ ok:false, message:error.message });
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin || !APP_PATHS.has(url.pathname)) return;
  const canonical = new URL(url.pathname, self.location.origin).href;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    try{
      const response = await fetch(request);
      if(response.ok){
        await cache.put(canonical, response.clone()).catch(() => {});
        return response;
      }
    }catch(error){}
    return (await cache.match(canonical)) || Response.error();
  })());
});
