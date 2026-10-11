(function(root){
  'use strict';

  const frameFit=root.CroquisPrintFrameFit ||
    (typeof module==='object' && module.exports ? require('./print-frame-fit.js') : null);
  const point=p=>p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const rect=r=>r && ['x','y','w','h'].every(k=>Number.isFinite(r[k])) && r.w>0 && r.h>0;

  function textPoints(sizePt,maxWidthMm){
    const saved=Number(sizePt),width=Number(maxWidthMm);
    const maximum=Math.max(5.5,Math.min(7,(Number.isFinite(width) ? width : 64)*.12));
    return Math.max(5,Math.min(maximum,(Number.isFinite(saved) ? saved : 10)*.6));
  }

  // All geometry, including gap, is in native map pixels. unitScale is pixels/mm.
  // The anchor is the centre of the measured label, as in the exported marker.
  function placeLabel(input={}){
    const anchor=point(input.anchor)?input.anchor:{x:0,y:0};
    const unchanged={x:anchor.x,y:anchor.y,moved:false};
    const width=Number(input.width),height=Number(input.height),canvas=input.canvas;
    if(!(Number.isFinite(width) && width>0 && Number.isFinite(height) && height>0) ||
      !canvas || !(Number.isFinite(canvas.w) && canvas.w>0 && Number.isFinite(canvas.h) && canvas.h>0) ||
      !frameFit?.polygonIntersectsRect) return unchanged;
    const gap=Math.max(0,Number(input.gap)||0);
    const units=Number(input.unitScale);
    const unitScale=Number.isFinite(units) && units>0 ? units : 1;
    const tip=point(input.tip)?input.tip:anchor;
    const polygons=(Array.isArray(input.polygons)?input.polygons:[])
      .map(shape=>Array.isArray(shape)?shape:shape?.points)
      .filter(points=>Array.isArray(points) && points.length>=3 && points.every(point));
    const occupied=(Array.isArray(input.occupied)?input.occupied:[]).filter(rect);
    const rawArrows=Array.isArray(input.arrowPoints)?input.arrowPoints:[];
    const arrowPaths=rawArrows.length && point(rawArrows[0]) ? [rawArrows] : rawArrows;
    const arrowSegments=[];
    for(const points of arrowPaths){
      if(!Array.isArray(points) || !points.every(point)) continue;
      for(let i=1;i<points.length;i++) arrowSegments.push([points[i-1],points[i]]);
    }
    const shapes=[...polygons,...arrowSegments].map(points=>{
      const bounds={points,x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
      for(const p of points){
        bounds.x0=Math.min(bounds.x0,p.x);bounds.y0=Math.min(bounds.y0,p.y);
        bounds.x1=Math.max(bounds.x1,p.x);bounds.y1=Math.max(bounds.y1,p.y);
      }
      return bounds;
    });
    const box=p=>({x:p.x-width/2-gap,y:p.y-height/2-gap,w:width+2*gap,h:height+2*gap});
    const overlaps=(a,b)=>a.x<=b.x+b.w && a.x+a.w>=b.x && a.y<=b.y+b.h && a.y+a.h>=b.y;
    const clear=p=>{
      const b=box(p);
      if(b.x<0 || b.y<0 || b.x+b.w>canvas.w || b.y+b.h>canvas.h) return false;
      if(occupied.some(other=>overlaps(b,other))) return false;
      return !shapes.some(shape=>b.x<=shape.x1 && b.x+b.w>=shape.x0 &&
        b.y<=shape.y1 && b.y+b.h>=shape.y0 && frameFit.polygonIntersectsRect(shape.points,b));
    };
    if(clear(anchor)) return unchanged;

    // Penalise extra crop width and height: a remote white patch can otherwise
    // make every part of the printed map smaller just to accommodate one label.
    let ink=null;
    const include=(x0,y0,x1,y1)=>{
      if(!ink) ink={x0,y0,x1,y1};
      else {ink.x0=Math.min(ink.x0,x0);ink.y0=Math.min(ink.y0,y0);
        ink.x1=Math.max(ink.x1,x1);ink.y1=Math.max(ink.y1,y1);}
    };
    shapes.forEach(shape=>include(shape.x0,shape.y0,shape.x1,shape.y1));
    occupied.forEach(b=>include(b.x,b.y,b.x+b.w,b.y+b.h));
    if(!ink) include(anchor.x,anchor.y,anchor.x,anchor.y);
    const cost=p=>{
      const b=box(p),extraWidth=Math.max(0,ink.x0-b.x)+Math.max(0,b.x+b.w-ink.x1);
      const extraHeight=Math.max(0,ink.y0-b.y)+Math.max(0,b.y+b.h-ink.y1);
      return (Math.hypot(p.x-anchor.x,p.y-anchor.y)+
        Math.hypot(p.x-tip.x,p.y-tip.y)*.12+(extraWidth+extraHeight)*1.5)/unitScale;
    };
    let best=null,bestCost=Infinity;
    const centres=tip.x===anchor.x && tip.y===anchor.y ? [anchor] : [anchor,tip];
    // At most 112 candidates, independent of map size or label length.
    for(const centre of centres) for(const mm of [2,4,7,10,16,24,36]){
      const radius=mm*unitScale;
      for(let direction=0;direction<8;direction++){
        const angle=direction*Math.PI/4;
        const candidate={x:centre.x+Math.cos(angle)*radius,y:centre.y+Math.sin(angle)*radius};
        if(!clear(candidate)) continue;
        const score=cost(candidate);
        if(score<bestCost){best=candidate;bestCost=score;}
      }
    }
    return best ? {x:best.x,y:best.y,moved:true} : unchanged;
  }

  const api=Object.freeze({textPoints,placeLabel});
  root.CroquisPrintDirectionLayout=api;
  if(typeof module==='object' && module.exports) module.exports=api;
})(typeof window==='object'?window:globalThis);
