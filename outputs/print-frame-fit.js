(function(root){
  'use strict';

  function polygonIntersectsRect(points, rect){
    const left=rect.x,top=rect.y,right=left+rect.w,bottom=top+rect.h;
    const inside=p=>p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom;
    if(points.some(inside)) return true;
    const contains=p=>{
      let value=false;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const a=points[i],b=points[j];
        if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) value=!value;
      }
      return value;
    };
    if(points.length>2&&contains({x:left,y:top})) return true;
    // Liang-Barsky also handles vertical, horizontal and two-point road lines.
    const crosses=(a,b)=>{
      let lo=0,hi=1;
      const dx=b.x-a.x,dy=b.y-a.y;
      for(const [p,q] of [[-dx,a.x-left],[dx,right-a.x],[-dy,a.y-top],[dy,bottom-a.y]]){
        if(!p){if(q<0)return false;continue;}
        const t=q/p;
        if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
        if(lo>hi)return false;
      }
      return true;
    };
    for(let i=0;i<points.length;i++) if(crosses(points[i],points[(i+1)%points.length]))return true;
    return false;
  }

  function fit(crop, plan, footprints=[],maxScale=Infinity){
    const area=plan.mapRect;
    if(!crop||!['x','y','w','h'].every(key=>Number.isFinite(crop[key]))||!(crop.w>0&&crop.h>0)||!area||!(area.w>0&&area.h>0))return null;
    const rectangle=r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
    const source=footprints.filter(shape=>shape?.points?.length>=2&&shape.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    const shapes=(source.length?source:[{points:rectangle(crop)}]).map(shape=>({
      points:shape.points,padding:Math.max(0,Number(shape.padding)||0),
      x0:Math.min(...shape.points.map(p=>p.x)),y0:Math.min(...shape.points.map(p=>p.y)),
      x1:Math.max(...shape.points.map(p=>p.x)),y1:Math.max(...shape.points.map(p=>p.y))
    }));
    const obstacles=[plan.legendRect,plan.compassRect].filter(Boolean);
    const clear=Math.max(0,Number(plan.clearance)||0);
    const ceiling=Math.min(area.w/crop.w,area.h/crop.h,maxScale);
    const candidates=limit=>{
      const values=[limit/2,0,limit];
      for(let i=1;i<8;i++)values.push(limit*i/8);
      return [...new Set(values)];
    };
    const place=scale=>{
      const freeX=Math.max(0,area.w-crop.w*scale),freeY=Math.max(0,area.h-crop.h*scale);
      for(const y of candidates(freeY))for(const x of candidates(freeX)){
        const origin={x:area.x+x,y:area.y+y};
        let collision=false;
        for(const ornament of obstacles){
          for(const shape of shapes){
            const grow=clear+shape.padding*scale;
            // Test in source coordinates: keep projected polygons cached.
            const rect={x:crop.x+(ornament.x-grow-origin.x)/scale,
              y:crop.y+(ornament.y-grow-origin.y)/scale,
              w:(ornament.w+2*grow)/scale,h:(ornament.h+2*grow)/scale};
            if(rect.x>shape.x1||rect.x+rect.w<shape.x0||rect.y>shape.y1||rect.y+rect.h<shape.y0)continue;
            if(polygonIntersectsRect(shape.points,rect)){collision=true;break;}
          }
          if(collision)break;
        }
        if(!collision)return {scale,x:origin.x,y:origin.y,w:crop.w*scale,h:crop.h*scale};
      }
      return null;
    };
    const full=place(ceiling);
    if(full)return full;
    // A complete rectangle above both ornaments is always a safe fallback.
    const safe=plan.safeMapRect||area;
    const inkMargin=obstacles.length ? .02+Math.max(...shapes.map(shape=>shape.padding))*ceiling : 0;
    let low=Math.min(ceiling,safe.w/crop.w,Math.max(.01,safe.h-inkMargin)/crop.h);
    let best={scale:low,x:safe.x+(safe.w-crop.w*low)/2,y:safe.y,
      w:crop.w*low,h:crop.h*low};
    let high=ceiling;
    for(let step=0;step<14;step++){
      const middle=(low+high)/2,next=place(middle);
      if(next){best=next;low=middle;}else high=middle;
    }
    return best;
  }

  const api=Object.freeze({fit,polygonIntersectsRect});
  root.CroquisPrintFrameFit=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
