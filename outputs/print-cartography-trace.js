/* Contornos de la cartografía de impresión. No genera ni cambia nombres. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports
    ? require('../vendor/imagetracer/imagetracer.js') : root.ImageTracer);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CroquisCartographyTrace=api;
})(typeof self==='object'?self:globalThis,function(tracer){
  'use strict';
  function trace(image,palette,kind='base'){
    if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||
      image.width<1||image.height<1||image.width*image.height>1100000||
      image.data?.length!==image.width*image.height*4)throw new Error('Invalid tracing block');
    // Alfa binario: el antialias lo dibuja el visor del PDF sobre las curvas,
    // en lugar de ampliar el borde semitransparente de una imagen.
    let hasVisible=false;
    for(let i=0;i<image.data.length;i+=4){
      if(image.data[i+3]<128){image.data[i]=image.data[i+1]=image.data[i+2]=image.data[i+3]=0;}
      else {
        hasVisible=true;
        image.data[i+3]=255;
        if(kind==='names'){
          const r=image.data[i],g=image.data[i+1],b=image.data[i+2];
          // El gris del antialias pertenece a la letra; no se cuantiza como
          // un punto de color del catálogo de comercios.
          if(Math.max(r,g,b)-Math.min(r,g,b)<20){
            image.data.set(r+g+b>450?[255,255,255,255]:[25,26,28,255],i);
          }
        }
      }
    }
    // Los bloques transparentes son frecuentes en las capas de nombres.
    // No necesitan cuantización ni asignar las matrices de contornos.
    if(!hasVisible)return `<svg viewBox="0 0 ${image.width} ${image.height}" xmlns="http://www.w3.org/2000/svg"></svg>`;
    const options={pal:palette,colorquantcycles:1,
      ltres:kind==='base'?.75:.65,qtres:kind==='base'?.75:.65,
      pathomit:kind==='base'?8:0,rightangleenhance:kind==='base',strokewidth:0,linefilter:false,
      roundcoords:2,viewbox:true,desc:false,blurradius:0};
    const visible=svg=>svg.replace(/<path\b[^>]*\bopacity="0"[^>]*\/>/g,'');
    let svg=visible(tracer.imagedataToSVG(image,options));
    if(kind==='names'){
      // Una silueta continua bajo las letras evita huecos entre las curvas
      // del relleno y el halo, ajustadas por separado sobre la imagen fuente.
      const data=new Uint8ClampedArray(image.data.length);
      for(let i=0;i<data.length;i+=4)if(image.data[i+3])data.set([25,26,28,255],i);
      const under=visible(tracer.imagedataToSVG({...image,data},{...options,
        pal:[{r:0,g:0,b:0,a:0},{r:25,g:26,b:28,a:255}]}))
        .replace(/^<svg[^>]*>|<\/svg>$/g,'');
      svg=svg.replace('>',`><g>${under}</g>`);
    }
    return svg;
  }
  return Object.freeze({trace});
});
