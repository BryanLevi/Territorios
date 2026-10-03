const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../outputs/offline-shell.js'),'utf8');
const workerSource=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const cacheName='croquis-app-shell-v15';
const options={baseURI:'https://example.test/Territorios/outputs/',cacheName,
  files:['../croquis-territorios-jw/','croquis_territorios.html?v=details-2','offline-shell.js']};
const urls=options.files.map(file=>{const url=new URL(file,options.baseURI);url.search='';url.hash='';return url.href;});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Events{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type){for(const fn of [...this.listeners.get(type)||[]])fn();}
  count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
function harness(settings={}){
  let clock=0,id=0;const timers=new Map(),channels=[],workers=[],calls={register:[],update:0,open:[],match:[],cache:[]};
  const records=new Map(),registration=new Events(),service=new Events();
  registration.active=null;registration.installing=null;registration.waiting=null;
  Object.defineProperty(service,'ready',{get(){assert.fail('No debe confiar en ready que pertenece al trabajador anterior');}});
  const timeout=(fn,delay)=>{const key=++id;timers.set(key,{fn,at:clock+delay});return key;};
  const clear=key=>timers.delete(key);
  const activate=worker=>{registration.active=worker;registration.waiting=null;registration.installing=null;worker.state='activated';worker.emit('statechange');service.emit('controllerchange');};
  function worker(version,state='activated',behavior={}){
    const result=new Events();result.state=state;result.messages=[];
    result.postMessage=(data,ports)=>{
      result.messages.push(data);
      const reply=value=>ports[0].postMessage(value);
      if(behavior.message)return behavior.message(data,reply,result);
      if(behavior.silent?.includes(data.type))return;
      if(data.type==='CHECK_SHELL')return reply({ok:true,cacheName:version});
      if(data.type==='ACTIVATE_SHELL'){
        reply({ok:true,cacheName:version});
        if(!behavior.holdActivation)timeout(()=>activate(result),10);
        return;
      }
      if(data.type==='CACHE_SHELL'){
        calls.cache.push({worker:result,version});
        if(behavior.error)return reply({ok:false,cacheName:version,message:behavior.error});
        if(!behavior.partial)urls.forEach(url=>records.set(version+' '+url,{ok:true}));
        return reply({ok:true,cacheName:behavior.cacheReplyVersion || version});
      }
    };
    workers.push(result);return result;
  }
  class Channel{
    constructor(){
      this.port1={closed:false,onmessage:null,onmessageerror:null,close(){this.closed=true;}};
      const port1=this.port1;
      this.port2={closed:false,postMessage(data){if(!port1.closed)port1.onmessage?.({data});},close(){this.closed=true;}};
      channels.push(this);
    }
  }
  const context={URL,isSecureContext:true,navigator:{serviceWorker:service},MessageChannel:Channel,
    setTimeout:timeout,clearTimeout:clear,caches:{open:async name=>{
      calls.open.push(name);return{match:async url=>{calls.match.push({name,url});return records.get(name+' '+url);}};
    }}};
  context.window=context;
  service.register=async(...args)=>{calls.register.push(args);if(settings.register)return settings.register(...args);return registration;};
  registration.update=()=>{calls.update++;assert.equal(registration.listeners.get('updatefound')?.size,1,'Observa antes de update');
    return settings.update?settings.update({registration,worker,timeout,activate}):Promise.resolve(registration);};
  vm.runInNewContext(source,context);
  async function advance(amount){
    await flush();const target=clock+amount;
    while(true){
      const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();await flush();
    }
    clock=target;await flush();
  }
  function clean(){
    assert.equal(timers.size,0,'Sin timers pendientes');assert.equal(registration.count(),0);assert.equal(service.count(),0);
    assert.ok(workers.every(w=>w.count()===0),'Sin listeners de workers');
    assert.ok(channels.every(channel=>channel.port1.closed&&channel.port2.closed),'Todos los puertos cerrados');
  }
  return{context,api:context.CroquisOfflineShell,registration,service,worker,activate,advance,clean,calls,records,timers,channels};
}

test('register antiguo y updatefound tardío esperan la versión nueva sin mandar CACHE_SHELL a la vieja',async()=>{
  let next;
  const h=harness({update({registration,worker,timeout,activate}){
    timeout(()=>{next=worker(cacheName,'installing');registration.installing=next;registration.emit('updatefound');timeout(()=>activate(next),20);},4000);
    return Promise.resolve(registration);
  }});
  const old=h.worker('croquis-app-shell-v10','activated',{silent:['CHECK_SHELL']});h.registration.active=old;
  urls.forEach(url=>h.records.set('croquis-app-shell-v10 '+url,{ok:true}));
  let settled=false;const pending=h.api.prepare(options).then(value=>{settled=true;return value;});
  await h.advance(2000);assert.equal(settled,false);assert.equal(h.calls.cache.length,0);assert.equal(old.messages.some(m=>m.type==='CACHE_SHELL'),false);
  await h.advance(2020);assert.equal(await pending,true);assert.equal(h.calls.update,1);
  assert.equal(h.calls.register[0][0],'https://example.test/Territorios/sw.js');
  assert.equal(h.calls.register[0][1].scope,'https://example.test/Territorios/');assert.equal(h.calls.register[0][1].updateViaCache,'none');
  assert.equal(h.calls.cache[0].worker,next);assert.ok(urls.every(url=>h.records.has(cacheName+' '+url)));
  assert.ok(urls.every(url=>h.records.has('croquis-app-shell-v10 '+url)),'No borra la copia anterior');h.clean();
});

test('un waiting compatible debe activarse realmente antes de confirmar la caché',async()=>{
  const h=harness(),old=h.worker('croquis-app-shell-v10'),waiting=h.worker(cacheName,'installed',{holdActivation:true});
  h.registration.active=old;h.registration.waiting=waiting;
  urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  let settled=false;const pending=h.api.prepare(options).then(value=>{settled=true;return value;});await flush();
  assert.equal(settled,false);assert.ok(waiting.messages.some(m=>m.type==='ACTIVATE_SHELL'));assert.equal(h.calls.cache.length,0);
  h.activate(waiting);await flush();assert.equal(await pending,true);h.clean();
});

test('una respuesta ok de versión equivocada no valida ni siquiera una caché completa',async()=>{
  const h=harness();h.registration.active=h.worker('croquis-app-shell-v11');urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  const pending=assert.rejects(h.api.prepare(options),/versión anterior/);await h.advance(h.api.PREPARE_TIMEOUT_MS);await pending;
  assert.equal(h.calls.cache.length,0);assert.equal(h.registration.active.messages.filter(m=>m.type==='CHECK_SHELL').length,1);h.clean();
});

test('el primer arranque de un waiting tarda tres segundos y conserva tiempo para negociar y activarse',async()=>{
  const h=harness();let checks=0;
  const waiting=h.worker(cacheName,'installed',{message(data,reply,worker){
    if(data.type==='CHECK_SHELL'){checks++;h.context.setTimeout(()=>reply({ok:true,cacheName}),3000);}
    if(data.type==='ACTIVATE_SHELL'){reply({ok:true,cacheName});h.activate(worker);}
  }});
  h.registration.waiting=waiting;urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  let settled=false;const pending=h.api.prepare(options).then(value=>{settled=true;return value;});
  await h.advance(2000);assert.equal(settled,false);assert.equal(waiting.messages.some(m=>m.type==='ACTIVATE_SHELL'),false);
  await h.advance(1000);assert.equal(await pending,true);assert.equal(checks,1);assert.equal(h.api.CHECK_TIMEOUT_MS,5000);h.clean();
});

test('un CHECK sin respuesta se reintenta una vez y el waiting correcto puede recuperarse',async()=>{
  const h=harness();let checks=0;
  const waiting=h.worker(cacheName,'installed',{message(data,reply,worker){
    if(data.type==='CHECK_SHELL'){if(++checks===1)return;reply({ok:true,cacheName});}
    if(data.type==='ACTIVATE_SHELL'){reply({ok:true,cacheName});h.activate(worker);}
  }});
  h.registration.waiting=waiting;urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  const pending=h.api.prepare(options);await h.advance(h.api.CHECK_TIMEOUT_MS);assert.equal(await pending,true);
  assert.equal(checks,2);assert.equal(waiting.messages.filter(m=>m.type==='ACTIVATE_SHELL').length,1);h.clean();
});

test('un ACTIVATE sin respuesta libera su bandera y reintenta antes de exigir activación real',async()=>{
  const h=harness();let activations=0;
  const waiting=h.worker(cacheName,'installed',{message(data,reply,worker){
    if(data.type==='CHECK_SHELL')reply({ok:true,cacheName});
    if(data.type==='ACTIVATE_SHELL'){if(++activations===1)return;reply({ok:true,cacheName});h.activate(worker);}
  }});
  h.registration.waiting=waiting;urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  const pending=h.api.prepare(options);await h.advance(h.api.CHECK_TIMEOUT_MS);assert.equal(await pending,true);
  assert.equal(activations,2);assert.equal(h.registration.active,waiting);h.clean();
});

test('los timeouts persistentes tienen dos intentos como máximo y liberan recursos al vencer el límite global',async()=>{
  for(const silent of ['CHECK_SHELL','ACTIVATE_SHELL']){
    const h=harness();const waiting=h.worker(cacheName,'installed',{silent:[silent]});h.registration.waiting=waiting;
    const pending=assert.rejects(h.api.prepare(options),silent==='ACTIVATE_SHELL'?/activarse/:/versión anterior/);
    await h.advance(h.api.PREPARE_TIMEOUT_MS);await pending;
    assert.equal(waiting.messages.filter(m=>m.type===silent).length,2);assert.equal(h.calls.cache.length,0);h.clean();
  }
});

test('una respuesta ACTIVATE de versión incorrecta no se reintenta ni permite validar la página',async()=>{
  const h=harness();const waiting=h.worker(cacheName,'installed',{message(data,reply,worker){
    if(data.type==='CHECK_SHELL')reply({ok:true,cacheName});
    if(data.type==='ACTIVATE_SHELL'){reply({ok:true,cacheName:'croquis-app-shell-v11'});h.activate(worker);}
  }});
  h.registration.waiting=waiting;urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  const pending=assert.rejects(h.api.prepare(options),/versión.*activar/);await h.advance(h.api.PREPARE_TIMEOUT_MS);await pending;
  assert.equal(waiting.messages.filter(m=>m.type==='ACTIVATE_SHELL').length,1);assert.equal(h.calls.cache.length,0);h.clean();
});

test('un waiting que nunca se activa termina con error y libera todos los recursos',async()=>{
  const h=harness();h.registration.waiting=h.worker(cacheName,'installed',{holdActivation:true});
  const pending=assert.rejects(h.api.prepare(options),/actualizarse/);await h.advance(h.api.PREPARE_TIMEOUT_MS);await pending;
  assert.equal(h.calls.cache.length,0);h.clean();
});

test('un fallo al guardar conserva datos y devuelve el error sin dejar puertos o listeners abiertos',async()=>{
  const h=harness();h.registration.active=h.worker(cacheName,'activated',{error:'No queda espacio para guardar la página.'});
  h.records.set('mapa anterior',{geometry:'guardada'});
  const pending=assert.rejects(h.api.prepare(options),/No queda espacio/);await flush();await pending;
  assert.equal(h.records.get('mapa anterior').geometry,'guardada');assert.equal(h.calls.cache.length,1);h.clean();
});

test('CACHE_SHELL ok exige la versión correcta y los archivos completos en rutas canónicas',async()=>{
  for(const behavior of [{cacheReplyVersion:'croquis-app-shell-v11'},{partial:true}]){
    const h=harness();h.registration.active=h.worker(cacheName,'activated',behavior);
    const pending=assert.rejects(h.api.prepare(options),/versión|completa/);await flush();await pending;
    assert.ok(h.calls.match.every(({url})=>!url.includes('?')));assert.ok(h.calls.match.some(({url})=>url.endsWith('/outputs/croquis_territorios.html')));h.clean();
  }
});

test('el timeout de guardado cierra el canal pendiente y no deja una preparación infinita',async()=>{
  const h=harness();h.registration.active=h.worker(cacheName,'activated',{silent:['CACHE_SHELL']});
  const pending=assert.rejects(h.api.prepare(options),/tardó demasiado/);await h.advance(30000);await pending;h.clean();
});

test('registro colgado o rechazado devuelve un error acotado sin observar un registro tardío',async()=>{
  let finishRegister;
  const h=harness({register:()=>new Promise(resolve=>{finishRegister=resolve;})});
  const pending=assert.rejects(h.api.prepare(options),/tardó/);await h.advance(h.api.PREPARE_TIMEOUT_MS);await pending;
  finishRegister(h.registration);await flush();assert.equal(h.calls.update,0);h.clean();
  const failed=harness({register:async()=>{throw new Error('Permiso denegado');}});
  await assert.rejects(failed.api.prepare(options),/Permiso denegado/);failed.clean();
});

test('un worker activo correcto con archivos válidos evita volver a descargar la página',async()=>{
  const h=harness();h.registration.active=h.worker(cacheName);urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  assert.equal(await h.api.prepare(options),true);assert.equal(h.calls.cache.length,0);h.clean();
});

test('una página completa y versión activa correcta sigue disponible si update falla sin internet',async()=>{
  const h=harness({update:async()=>{throw new Error('Sin conexión');}});h.context.navigator.onLine=false;
  h.registration.active=h.worker(cacheName);urls.forEach(url=>h.records.set(cacheName+' '+url,{ok:true}));
  assert.equal(await h.api.prepare(options),true);assert.equal(h.calls.cache.length,0);assert.equal(h.calls.update,1);h.clean();
});

function workerHarness(settings={}){
  const events={},replies=[],requests=[],opens=[];let skips=0;
  const context={URL,Request,Response,fetch:async()=>({ok:true}),
    self:{registration:{scope:'https://example.test/Territorios/'},location:{origin:'https://example.test'},
      addEventListener:(type,handler)=>{events[type]=handler;},skipWaiting:async()=>{skips++;},clients:{claim:async()=>{}}},
    caches:{open:async name=>{opens.push(name);return{addAll:async list=>{requests.push(...list);if(settings.error)throw new Error(settings.error);}};},keys:async()=>[],delete:async()=>{assert.fail('La negociación no borra mapas');}}};
  vm.runInNewContext(workerSource,context);
  async function dispatch(type,name){let work;events.message({data:{type,cacheName:name},ports:[{postMessage:data=>replies.push(data)}],waitUntil:promise=>{work=promise;}});await work;return replies.at(-1);}
  return{dispatch,replies,requests,opens,skips:()=>skips};
}

test('service worker identifica su versión y rechaza peticiones de otra sin cachear ni activar',async()=>{
  const h=workerHarness();const valid=await h.dispatch('CHECK_SHELL',cacheName);assert.equal(valid.ok,true);assert.equal(valid.cacheName,cacheName);
  for(const type of ['CHECK_SHELL','CACHE_SHELL','ACTIVATE_SHELL']){const reply=await h.dispatch(type,'croquis-app-shell-v11');assert.equal(reply.ok,false);assert.equal(reply.cacheName,cacheName);}
  assert.equal(h.requests.length,0);assert.equal(h.skips(),0);
});

test('service worker prepara la caché correcta con reload y responde errores con su versión',async()=>{
  const h=workerHarness();const reply=await h.dispatch('CACHE_SHELL',cacheName);
  assert.equal(reply.ok,true);assert.equal(reply.cacheName,cacheName);assert.deepEqual(h.opens,[cacheName]);
  assert.ok(h.requests.length>20);assert.ok(h.requests.every(request=>request.cache==='reload'));
  assert.ok(h.requests.some(request=>request.url.endsWith('/outputs/offline-shell.js')));
  const activation=await h.dispatch('ACTIVATE_SHELL',cacheName);assert.equal(activation.ok,true);assert.equal(h.skips(),1);
  const failed=workerHarness({error:'Servidor no disponible'}),error=await failed.dispatch('CACHE_SHELL',cacheName);
  assert.equal(error.ok,false);assert.equal(error.cacheName,cacheName);assert.equal(error.message,'Servidor no disponible');
});
