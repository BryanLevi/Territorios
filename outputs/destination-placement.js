/* Espacio físico de los destinos en papel, independiente del zoom del editor. */
(function (global) {
  'use strict';
  const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const validBox = b => b && ['x0','y0','x1','y1'].every(k => Number.isFinite(b[k])) && b.x1 > b.x0 && b.y1 > b.y0;
  const includes = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
  const intersects = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function segment(a,b,c,d) {
    const abC=cross(a,b,c), abD=cross(a,b,d), cdA=cross(c,d,a), cdB=cross(c,d,b);
    if ((abC>0 && abD<0 || abC<0 && abD>0) && (cdA>0 && cdB<0 || cdA<0 && cdB>0)) return true;
    const on = (a,b,p) => Math.abs(cross(a,b,p))<1e-6 && p.x>=Math.min(a.x,b.x) && p.x<=Math.max(a.x,b.x) && p.y>=Math.min(a.y,b.y) && p.y<=Math.max(a.y,b.y);
    return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  }
  function inPolygon(p, polygon) {
    let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];
      if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
    }
    return inside;
  }
  function polygonIntersectsRect(polygon, rect) {
    if (!validBox(rect) || !Array.isArray(polygon) || polygon.length<3 || !polygon.every(point)) return false;
    const corners=[{x:rect.x0,y:rect.y0},{x:rect.x1,y:rect.y0},{x:rect.x1,y:rect.y1},{x:rect.x0,y:rect.y1}];
    if(polygon.some(p=>includes(rect,p)) || corners.some(p=>inPolygon(p,polygon))) return true;
    return polygon.some((a,i)=>corners.some((c,j)=>segment(a,polygon[(i+1)%polygon.length],c,corners[(j+1)%4])));
  }
  function measure(label, input) {
    const pt=Math.max(7,Math.min(18,Number(label.sizePt)||10)), max=Math.max(12,Number(input.maxTextWidthMm)||64);
    const actual=input.measure?.(label.text,pt,max);
    if(actual && actual.width>0 && actual.height>0 && Number.isFinite(actual.width+actual.height)) return actual;
    const font=pt*25.4/72, natural=String(label.text||'').length*font*.62;
    return {width:Math.min(max,Math.max(font,natural)+1.59),height:Math.max(1,Math.ceil(natural/Math.max(1,max-1.59)))*font*1.2+1.06};
  }
  function plan(input) {
    const polygons=(input.polygons||[]).filter(p=>Array.isArray(p)&&p.length>=3&&p.every(point));
    const labels=(input.labels||[]).filter(l=>point(l.anchor)&&Array.isArray(l.points)&&l.points.length===2&&l.points.every(point)&&String(l.text||'').trim());
    const source=input.resolveContentBounds?.(labels)||input.contentBounds;
    const base=validBox(source)?{...source}:null;
    if(!base || !(input.availableMm?.width>0) || !(input.availableMm?.height>0)) return null;
    const safe=Math.max(0,Number(input.safeMm) || .8), width=input.availableMm.width-2*safe,height=input.availableMm.height-2*safe;
    if(!(width>0 && height>0)) return null;
    const union=(r,p,pad=0)=>{r.x0=Math.min(r.x0,p.x-pad);r.x1=Math.max(r.x1,p.x+pad);r.y0=Math.min(r.y0,p.y-pad);r.y1=Math.max(r.y1,p.y+pad);};
    labels.forEach(l=>{union(base,l.anchor);l.points.forEach(p=>union(base,p));});
    const sizes=labels.map(l=>measure(l,input));
    let scale=Math.min(width/(base.x1-base.x0),height/(base.y1-base.y0)), bounds={...base};
    const fit=sizes.every(s=>s.width<width && s.height<height);
    for(let iteration=0;iteration<80;iteration++) {
      bounds={...base};
      labels.forEach((l,i)=>{
        const s=sizes[i], head=Math.max(1.5,Math.min(6,Number(l.headMm)||3))/scale;
        union(bounds,{x:l.anchor.x-s.width/scale/2,y:l.anchor.y-s.height/scale/2});
        union(bounds,{x:l.anchor.x+s.width/scale/2,y:l.anchor.y+s.height/scale/2});
        l.points.forEach(p=>union(bounds,p,head));
      });
      const next=Math.min(width/(bounds.x1-bounds.x0),height/(bounds.y1-bounds.y0));
      if(!Number.isFinite(next) || next<1e-10) return null;
      if(Math.abs(next-scale)<scale*.00001){scale=next;break;}
      scale=next;
      if(!fit && iteration>10) break;
    }
    const footprints=labels.map((l,i)=>({id:l.id,widthMm:sizes[i].width,heightMm:sizes[i].height,
      rect:{x0:l.anchor.x-sizes[i].width/scale/2,x1:l.anchor.x+sizes[i].width/scale/2,y0:l.anchor.y-sizes[i].height/scale/2,y1:l.anchor.y+sizes[i].height/scale/2}}));
    footprints.forEach((f,i)=>{
      const margin=.6/scale, r={x0:f.rect.x0-margin,y0:f.rect.y0-margin,x1:f.rect.x1+margin,y1:f.rect.y1+margin};
      f.overlapArea=polygons.some(p=>polygonIntersectsRect(p,r));
      f.overlapLabels=footprints.filter((other,j)=>j!==i&&intersects(r,other.rect)).map(other=>other.id);
      f.overlaps=f.overlapArea || !!f.overlapLabels.length;
    });
    return {scale,bounds,labels:footprints,fits:fit};
  }
  function suggest(input,id) {
    const current=plan(input), label=input.labels?.find(l=>l.id===id);
    if(!current || !current.fits || !label) return null;
    const existing=current.labels.find(l=>l.id===id);
    if(!existing?.overlaps) return {anchor:{...label.anchor},plan:current};
    const tip=label.points[1], dx=tip.x-label.points[0].x,dy=tip.y-label.points[0].y,angle=Math.atan2(dy,dx);
    let best=null;
    for(const radius of [8,14,22,32,46,65,95,130]) {
      for(let step=0;step<16;step++) {
        const a=angle+step*Math.PI/8,anchor={x:tip.x+Math.cos(a)*radius/current.scale,y:tip.y+Math.sin(a)*radius/current.scale};
        const candidate={...input,labels:input.labels.map(l=>l.id===id?{...l,anchor}:l)}, layout=plan(candidate), box=layout?.labels.find(l=>l.id===id);
        if(!layout?.fits || !box || box.overlaps) continue;
        const corners=[{x:box.rect.x0,y:box.rect.y0},{x:box.rect.x1,y:box.rect.y0},{x:box.rect.x1,y:box.rect.y1},{x:box.rect.x0,y:box.rect.y1}];
        if(includes(box.rect,label.points[0]) || corners.some((p,j)=>segment(label.points[0],tip,p,corners[(j+1)%4]))) continue;
        const distance=Math.hypot(anchor.x-label.anchor.x,anchor.y-label.anchor.y)*current.scale;
        const cost=radius+distance*.3+(current.scale/layout.scale-1)*30;
        if(!best || cost<best.cost) best={anchor,plan:layout,cost};
      }
      if(best) break;
    }
    return best;
  }
  global.CroquisDestinationPlacement=Object.freeze({plan,suggest,polygonIntersectsRect});
})(window);
