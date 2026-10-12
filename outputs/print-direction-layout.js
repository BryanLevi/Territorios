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

  // A geographic shaft can become shorter than its fixed-size head in a small
  // frame. Extend only the printed copy, retaining its origin and bearing.
  function groupedArrow(input={}){
    const start=input.start, savedTip=input.tip;
    if(!point(start) || !point(savedTip)) return null;
    const dx=savedTip.x-start.x,dy=savedTip.y-start.y,length=Math.hypot(dx,dy);
    if(length<1e-8) return null;
    const units=Math.max(1e-8,Number(input.unitScale)||1),ux=dx/length,uy=dy/length;
    const printedLength=Math.max(length,3.5*units);
    const tip={x:start.x+ux*printedLength,y:start.y+uy*printedLength};
    const head=Math.min(Math.max(0,Number(input.head)||1.95*units),printedLength*.42);
    return {start:{x:start.x,y:start.y},tip,wings:[
      {x:tip.x-ux*head-uy*head*.55,y:tip.y-uy*head+ux*head*.55},
      {x:tip.x-ux*head+uy*head*.55,y:tip.y-uy*head-ux*head*.55}]};
  }

  // Plan the names together, after measuring them. A name belongs just beyond
  // its own arrow tip; saved editor anchors are not suitable after reduction.
  function placeGroupedLabels(input={}){
    const items=Array.isArray(input.items)?input.items:[],canvas=input.canvas;
    const units=Math.max(1e-8,Number(input.unitScale)||1),gap=Math.max(0,Number(input.gap)||0);
    const polygons=(input.polygons||[]).map(s=>Array.isArray(s)?s:s?.points)
      .filter(p=>Array.isArray(p) && p.length>=3 && p.every(point));
    const occupied=(input.occupied||[]).filter(rect).map(r=>({...r}));
    const arrows=items.flatMap(item=>point(item.start) && point(item.tip) ?
      [[item.start,item.tip],...(item.wings||[]).filter(point).map(p=>[item.tip,p])] : []);
    const shapes=[...polygons,...arrows].map(points=>{
      const shape={points,x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
      for(const p of points){shape.x0=Math.min(shape.x0,p.x);shape.y0=Math.min(shape.y0,p.y);
        shape.x1=Math.max(shape.x1,p.x);shape.y1=Math.max(shape.y1,p.y);}
      return shape;
    });
    const overlaps=(a,b)=>a.x<=b.x+b.w && a.x+a.w>=b.x && a.y<=b.y+b.h && a.y+a.h>=b.y;
    const box=(p,item)=>({x:p.x-item.width/2-gap,y:p.y-item.height/2-gap,
      w:item.width+gap*2,h:item.height+gap*2});
    const valid=items.map((item,index)=>{
      const length=point(item.start) && point(item.tip)?Math.hypot(item.tip.x-item.start.x,item.tip.y-item.start.y):0;
      if(!length || !(item.width>0 && item.height>0)) return null;
      const ux=(item.tip.x-item.start.x)/length,uy=(item.tip.y-item.start.y)/length;
      // A diagonal name sits next to the tip's corner, rather than a long
      // label width pushing it unnecessarily far north or south.
      const sx=Math.abs(ux)>=.382683?Math.sign(ux):0,sy=Math.abs(uy)>=.382683?Math.sign(uy):0;
      return {item,index,ux,uy,preferred:{x:item.tip.x+sx*(item.width/2+gap+.1*units),
        y:item.tip.y+sy*(item.height/2+gap+.1*units)}};
    }).filter(Boolean);
    // Geometry order, independent of the order saved in the editor.
    valid.sort((a,b)=>a.item.tip.x-b.item.tip.x || a.item.tip.y-b.item.tip.y ||
      a.ux-b.ux || a.uy-b.uy || String(a.item.key||'').localeCompare(String(b.item.key||'')));
    const results=items.map(item=>({x:item.anchor?.x||0,y:item.anchor?.y||0,moved:false,clear:false}));
    for(let order=0;order<valid.length;order++){
      const entry=valid[order],{item,preferred,ux,uy}=entry;
      const clear=p=>{
        const b=box(p,item);
        if(!canvas || b.x<0 || b.y<0 || b.x+b.w>canvas.w || b.y+b.h>canvas.h) return false;
        if(occupied.some(other=>overlaps(b,other))) return false;
        return !shapes.some(s=>b.x<=s.x1 && b.x+b.w>=s.x0 && b.y<=s.y1 && b.y+b.h>=s.y0 &&
          frameFit?.polygonIntersectsRect(s.points,b));
      };
      let best=null,bestCost=Infinity;
      const consider=p=>{
        // Clamping gives an exact edge candidate. A coarse search grid alone
        // can miss a clear position between a corner and the arrow tip.
        if((p.x-item.tip.x)*ux+(p.y-item.tip.y)*uy<=0 || !clear(p)) return;
        const b=box(p,item);
        const future=valid.slice(order+1).reduce((cost,next)=>{
          const other=box(next.preferred,next.item);
          const intersection=Math.max(0,Math.min(b.x+b.w,other.x+other.w)-Math.max(b.x,other.x))*
            Math.max(0,Math.min(b.y+b.h,other.y+other.h)-Math.max(b.y,other.y));
          return cost+intersection/units/units;
        },0);
        const dx=p.x-preferred.x,dy=p.y-preferred.y;
        const cost=(Math.hypot(dx,dy)+Math.abs(-uy*dx+ux*dy)*.2)/units+future*.15;
        if(cost<bestCost){best=p;bestCost=cost;}
      };
      // Small transverse shifts separate adjacent north/northwest arrows;
      // forward shifts leave every name on the side its arrow points towards.
      for(const forward of [0,1.5,3,5,8,12,18,24,32,48]){
        for(const sideways of [0,-1.5,1.5,-3,3,-5,5,-8,8,-12,12,-18,18,-24,24]){
          const p={x:preferred.x+(ux*forward-uy*sideways)*units,
            y:preferred.y+(uy*forward+ux*sideways)*units};
          consider(p);
          const edge=gap+.000001*units;
          if(canvas && item.width+edge*2<=canvas.w && item.height+edge*2<=canvas.h){
            consider({x:Math.max(item.width/2+edge,Math.min(canvas.w-item.width/2-edge,p.x)),
              y:Math.max(item.height/2+edge,Math.min(canvas.h-item.height/2-edge,p.y))});
          }
        }
      }
      const next=best||preferred;
      results[entry.index]={...next,moved:!point(item.anchor) ||
        Math.hypot(next.x-item.anchor.x,next.y-item.anchor.y)>.001,clear:!!best};
      occupied.push({x:next.x-item.width/2,y:next.y-item.height/2,w:item.width,h:item.height});
    }
    return results;
  }

  const api=Object.freeze({textPoints,placeLabel,groupedArrow,placeGroupedLabels});
  root.CroquisPrintDirectionLayout=api;
  if(typeof module==='object' && module.exports) module.exports=api;
})(typeof window==='object'?window:globalThis);
