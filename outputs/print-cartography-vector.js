(function(root){
  'use strict';
  const script=root.document.currentScript?.src;
  const NS='http://www.w3.org/2000/svg';
  const transparent={r:0,g:0,b:0,a:0},white={r:255,g:255,b:255,a:255};
  const names=[transparent,white,{r:25,g:26,b:28,a:255},
    ...[[84,99,108],[130,147,156],[0,164,235],[0,125,188],[0,130,76],
      [43,163,88],[242,128,37],[216,62,54],[174,80,184],[218,190,66]]
      .map(([r,g,b])=>({r,g,b,a:255}))];
  const canVectorize=url=>/google\.com\/vt[/?].*lyrs=[mh](?:&|$)|basemaps\.cartocdn\.com\/.*voyager|tile\.openstreetmap\.org\//.test(String(url));
  function createClient(){
    const worker=new root.Worker(new URL('print-cartography-worker.js',script));
    let serial=0;
    const pending=new Map();
    worker.onmessage=({data})=>{
      const call=pending.get(data.id);if(!call)return;
      pending.delete(data.id);clearTimeout(call.timer);
      data.error?call.reject(new Error(data.error)):call.resolve(data.svg);
    };
    worker.onerror=()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('Vector worker unavailable'));}pending.clear();};
    return {trace(image,palette,kind){return new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Vector tracing timeout'));},30000);
      pending.set(id,{resolve,reject,timer});
      worker.postMessage({id,width:image.width,height:image.height,buffer:image.data.buffer,palette,kind},[image.data.buffer]);
    });},close(){worker.terminate();for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('Vector tracing stopped'));}pending.clear();}};
  }
  function basePalette(pieces){
    const canvas=root.document.createElement('canvas');canvas.width=canvas.height=32;
    const context=canvas.getContext('2d',{willReadFrequently:true}),hist=new Map();
    try{
      for(const piece of pieces){
        context.clearRect(0,0,32,32);context.drawImage(piece.image,0,0,32,32);
        const data=context.getImageData(0,0,32,32).data;
        for(let i=0;i<data.length;i+=4){
          if(data[i+3]<96)continue;
          const rgb=[data[i],data[i+1],data[i+2]],key=rgb.map(v=>v>>3).join(',');
          const item=hist.get(key)||{count:0,sum:[0,0,0]};item.count++;
          rgb.forEach((v,k)=>item.sum[k]+=v);hist.set(key,item);
        }
      }
      const palette=[transparent,white];
      for(const item of [...hist.values()].sort((a,b)=>b.count-a.count)){
        const [r,g,b]=item.sum.map(v=>Math.round(v/item.count));
        if(palette.some(c=>c.a===255&&Math.abs(c.r-r)+Math.abs(c.g-g)+Math.abs(c.b-b)<18))continue;
        palette.push({r,g,b,a:255});if(palette.length>=32)break;
      }
      return palette;
    }finally{canvas.width=canvas.height=1;}
  }
  async function vectorize(targetMap,layer,plan,cache=new Map()){
    if(!script||!root.Worker||!canVectorize(layer._url))return null;
    const original=layer.getContainer?.(),pane=original?.parentElement;
    if(!original||!pane)return null;
    const kind=layer.options?.pane==='territoryRoadPane'?'names':layer.options?.pane==='territoryWhiteRoadPane'?'roads':'base';
    // El texto se traza con sus píxeles nativos, aun en recuadros pequeños.
    // Cada bloque tiene memoria limitada; no requiere un lienzo de la hoja
    // completa ni reducir las letras al presupuesto de un mosaico raster.
    const nativeScale=kind==='names'?Math.min(4,...plan.pieces.map(p=>
      Math.min(p.image.naturalWidth/p.w,p.image.naturalHeight/p.h))):plan.scale;
    if(!Number.isFinite(nativeScale)||nativeScale<=0)return null;
    const key=JSON.stringify([kind,plan.x,plan.y,plan.width,plan.height,nativeScale,
      ...plan.pieces.map(p=>[p.image.src,p.x,p.y,p.w,p.h])]);
    let svg=cache.get(key)?.cloneNode(true),blocks=0;
    if(!svg){
      svg=root.document.createElementNS(NS,'svg');
      svg.setAttribute('viewBox',`0 0 ${plan.width} ${plan.height}`);
      const palette=kind==='base'?basePalette(plan.pieces):kind==='roads'?[transparent,white]:names;
      const client=createClient(),canvas=root.document.createElement('canvas');
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const step=512/nativeScale,pad=2/nativeScale;
      try{
        for(let y=0;y<plan.height;y+=step)for(let x=0;x<plan.width;x+=step){
          const w=Math.min(step,plan.width-x),h=Math.min(step,plan.height-y);
          const left=plan.x+x-pad,top=plan.y+y-pad;
          const pieces=plan.pieces.filter(p=>p.x+p.w>left&&p.y+p.h>top&&p.x<left+w+2*pad&&p.y<top+h+2*pad);
          if(!pieces.length)continue;
          canvas.width=Math.ceil((w+2*pad)*nativeScale);canvas.height=Math.ceil((h+2*pad)*nativeScale);
          context.setTransform(nativeScale,0,0,nativeScale,-left*nativeScale,-top*nativeScale);
          for(const p of pieces)context.drawImage(p.image,p.x,p.y,p.w,p.h);
          const data=context.getImageData(0,0,canvas.width,canvas.height);
          const markup=await client.trace(data,palette,kind);
          const node=new root.DOMParser().parseFromString(markup,'image/svg+xml').documentElement;
          if(node.localName!=='svg'||node.querySelector('parsererror'))throw new Error('Invalid vector cartography');
          node.setAttribute('x',x);node.setAttribute('y',y);node.setAttribute('width',w);node.setAttribute('height',h);
          node.setAttribute('viewBox',`2 2 ${w*nativeScale} ${h*nativeScale}`);
          node.setAttribute('overflow','hidden');svg.appendChild(root.document.importNode(node,true));blocks++;
        }
        svg.dataset.vectorBlocks=blocks;cache.set(key,svg.cloneNode(true));
      }finally{client.close();canvas.width=canvas.height=1;}
    }
    svg.classList.add('print-vector-cartography');svg.dataset.vectorKind=kind;
    const origin=targetMap.containerPointToLayerPoint([0,0]);
    Object.assign(svg.style,{position:'absolute',left:(origin.x+plan.x)+'px',top:(origin.y+plan.y)+'px',
      width:plan.width+'px',height:plan.height+'px',opacity:String(layer.options?.opacity??1),pointerEvents:'none'});
    pane.appendChild(svg);original.style.display='none';
    return {compacted:true,vectorized:true,kind,blocks:Number(svg.dataset.vectorBlocks),
      paths:svg.querySelectorAll('path').length,tiles:plan.pieces.length};
  }
  root.CroquisPrintCartography=Object.freeze({vectorize,canVectorize});
})(window);
