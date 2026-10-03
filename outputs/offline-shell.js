/* Versioned preparation of the app page. Downloaded maps stay in IndexedDB. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CroquisOfflineShell = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PREPARE_TIMEOUT_MS = 45000;
  const CHECK_TIMEOUT_MS = 5000;
  const MAX_NEGOTIATION_ATTEMPTS = 2;

  function prepare(options) {
    if (!root.isSecureContext || !root.navigator?.serviceWorker || !root.caches || !root.MessageChannel) {
      return Promise.reject(new Error('Para guardar la página, ábrela con HTTPS en este navegador.'));
    }
    if (!options?.baseURI || typeof options.cacheName !== 'string' || !options.cacheName || !Array.isArray(options.files) || !options.files.length) {
      return Promise.reject(new Error('No se pudo identificar la versión de la página que debe guardarse.'));
    }
    let scope, script, files;
    try {
      scope = new root.URL('../', options.baseURI).href;
      script = new root.URL('../sw.js', options.baseURI).href;
      files = [...new Set(options.files.map(file => {
        const url = new root.URL(file, options.baseURI);
        url.search = ''; url.hash = '';
        return url.href;
      }))];
    } catch (error) {
      return Promise.reject(new Error('No se pudo identificar la dirección de la página.'));
    }
    const expected = options.cacheName;
    const service = root.navigator.serviceWorker;
    return new Promise((resolve, reject) => {
      let registration = null, finished = false;
      let lastProblem = 'La página tardó en actualizarse. Recarga y vuelve a intentar; tus mapas guardados se conservan.';
      const removals = [], workers = new Map(), requests = new Set();
      const finish = error => {
        if (finished) return;
        finished = true;
        root.clearTimeout(deadline);
        removals.splice(0).forEach(remove => remove());
        for (const cancel of [...requests]) cancel(new Error('La preparación de la página terminó.'));
        workers.clear();
        error ? reject(error) : resolve(true);
      };
      const deadline = root.setTimeout(() => finish(new Error(lastProblem)), PREPARE_TIMEOUT_MS);
      const listen = (object, type, handler) => {
        if (!object?.addEventListener) return;
        object.addEventListener(type, handler);
        removals.push(() => object.removeEventListener(type, handler));
      };
      const message = (worker, type, timeout) => new Promise((done, fail) => {
        const channel = new root.MessageChannel();
        let ended = false, timer;
        const end = (error, value) => {
          if (ended) return;
          ended = true;
          root.clearTimeout(timer);
          channel.port1.onmessage = null;
          channel.port1.onmessageerror = null;
          channel.port1.close();
          channel.port2.close();
          requests.delete(cancel);
          error ? fail(error) : done(value);
        };
        const cancel = error => end(error);
        requests.add(cancel);
        channel.port1.onmessage = event => end(null, event.data);
        channel.port1.onmessageerror = () => end(new Error('La página no pudo confirmar su versión. Recarga y vuelve a intentar.'));
        timer = root.setTimeout(() => end(Object.assign(new Error(type === 'CHECK_SHELL'
          ? 'La versión anterior de la página todavía no se ha actualizado. Recarga y vuelve a intentar.'
          : type === 'ACTIVATE_SHELL'
            ? 'La nueva versión de la página tardó en activarse. Recarga y vuelve a intentar; tus mapas guardados se conservan.'
            : 'La página tardó demasiado en guardarse. Lo descargado se conserva; vuelve a intentar.'), {code:'SHELL_MESSAGE_TIMEOUT'})), timeout);
        try { worker.postMessage({ type, cacheName:expected }, [channel.port2]); }
        catch (error) { end(error); }
      });
      const compatible = reply => reply?.ok === true && reply.cacheName === expected;
      const active = worker => !finished && worker.state === 'activated' && registration?.active === worker;
      const complete = async () => {
        const cache = await root.caches.open(expected);
        const matches = await Promise.all(files.map(file => cache.match(file)));
        return matches.every(response => response && response.ok !== false);
      };
      const save = async (worker, entry) => {
        if (!entry.compatible || !active(worker) || entry.saving) return;
        entry.saving = true;
        try {
          if (!await complete()) {
            if (!entry.compatible || !active(worker)) return;
            const reply = await message(worker, 'CACHE_SHELL', 30000);
            if (finished) return;
            if (!compatible(reply)) throw new Error(reply?.message || 'La página no confirmó la versión que se necesita guardar. Recarga y vuelve a intentar.');
            if (!entry.compatible || !active(worker)) return;
            if (!await complete()) throw new Error('No se pudo guardar la página completa. Tus mapas anteriores siguen guardados; vuelve a intentar con conexión.');
          }
          if (entry.compatible && active(worker)) finish();
        } catch (error) {
          if (!finished && active(worker)) finish(error);
        } finally { entry.saving = false; }
      };
      const advance = async (worker, entry) => {
        if (finished || worker.state === 'redundant') return;
        if (entry.compatible) {
          if (worker.state === 'installed' && !entry.activating && entry.activationAttempts < MAX_NEGOTIATION_ATTEMPTS) {
            entry.activating = true;
            entry.activationAttempts++;
            let retry = false;
            try {
              const reply = await message(worker, 'ACTIVATE_SHELL', CHECK_TIMEOUT_MS);
              entry.activationAttempts = MAX_NEGOTIATION_ATTEMPTS;
              if (!finished && !compatible(reply)) {
                entry.compatible = false;
                entry.checked = true;
                lastProblem = reply?.message || 'La página no confirmó la versión que se necesita activar. Recarga y vuelve a intentar.';
              }
            } catch (error) {
              if (!finished) {
                lastProblem = error.message;
                retry = error.code === 'SHELL_MESSAGE_TIMEOUT' && entry.activationAttempts < MAX_NEGOTIATION_ATTEMPTS;
              }
            } finally { entry.activating = false; }
            if (retry && !finished && worker.state === 'installed') advance(worker, entry);
          }
          save(worker, entry);
          return;
        }
        if (entry.checking || entry.checked || worker.state === 'installing' || worker.state === 'parsed') return;
        entry.checking = true;
        entry.checkAttempts++;
        let retry = false;
        try {
          const reply = await message(worker, 'CHECK_SHELL', CHECK_TIMEOUT_MS);
          if (finished) return;
          entry.checked = true;
          if (compatible(reply)) {
            entry.compatible = true;
            advance(worker, entry);
          } else lastProblem = 'La página todavía usa una versión anterior. Recarga y vuelve a intentar; tus mapas guardados se conservan.';
        } catch (error) {
          retry = error.code === 'SHELL_MESSAGE_TIMEOUT' && entry.checkAttempts < MAX_NEGOTIATION_ATTEMPTS;
          entry.checked = !retry;
          if (!finished) lastProblem = error.message;
        } finally {
          entry.checking = false;
          if (retry && !finished) advance(worker, entry);
        }
      };
      const inspect = () => {
        if (finished || !registration) return;
        for (const worker of [registration.installing, registration.waiting, registration.active]) {
          if (!worker) continue;
          let entry = workers.get(worker);
          if (!entry) {
            entry = {checking:false,checked:false,checkAttempts:0,compatible:false,activating:false,activationAttempts:0,saving:false};
            workers.set(worker, entry);
            listen(worker, 'statechange', () => {
              inspect();
              if (worker.state === 'redundant') lastProblem = 'No se pudo actualizar la página. Recarga y vuelve a intentar; tus mapas guardados se conservan.';
              else advance(worker, entry);
            });
          }
          advance(worker, entry);
        }
      };
      Promise.resolve().then(() => service.register(script, {scope,updateViaCache:'none'})).then(result => {
        if (finished) return;
        registration = result;
        listen(registration, 'updatefound', inspect);
        listen(service, 'controllerchange', inspect);
        inspect();
        // updatefound can arrive after register resolves with an old active worker.
        // Observe it before asking the browser to check the script again.
        if (typeof registration.update === 'function') {
          try {
            Promise.resolve(registration.update()).then(inspect, error => {
              if (!finished) { lastProblem = 'No se pudo actualizar la página. Conéctate y vuelve a intentar; tus mapas guardados se conservan.'; inspect(); }
            });
          } catch (error) { lastProblem = error.message; inspect(); }
        }
      }).catch(error => { if (!finished) finish(new Error('No se pudo preparar la página sin conexión. ' + error.message)); });
    });
  }
  return Object.freeze({prepare,PREPARE_TIMEOUT_MS,CHECK_TIMEOUT_MS});
});
