/* La conversión se hace fuera del hilo del mapa y sólo durante la descarga. */
'use strict';
importScripts('../vendor/imagetracer/imagetracer.js','print-cartography-trace.js');
self.onmessage=event=>{
  const {id,width,height,buffer,palette,kind}=event.data;
  try{
    const svg=self.CroquisCartographyTrace.trace({width,height,data:new Uint8ClampedArray(buffer)},palette,kind);
    self.postMessage({id,svg});
  }catch(error){self.postMessage({id,error:error.message});}
};
