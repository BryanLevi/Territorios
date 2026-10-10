/* Reparte una lámina según la forma y las divisiones de sus croquis. */
(function(root, factory){
  'use strict';
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.CroquisSheetLayout = api;
})(typeof window === 'object' ? window : globalThis, function(){
  'use strict';
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function profile(value){
    return {
      aspect:clamp(Number(value?.aspect) || 1.3, .18, 7),
      divisions:clamp(Number(value?.divisions) || 1, 1, 100),
      references:clamp(Number(value?.references) || 0, 0, 30)
    };
  }

  function distribute(length, weights, minimum){
    const free = Math.max(0, length - weights.length * minimum);
    const total = weights.reduce((a,b) => a+b, 0) || 1;
    return weights.map(weight => minimum + free * weight / total);
  }

  function balancedRows(indices, columns){
    if(!indices.length || columns < 1) return [];
    const rows = Math.ceil(indices.length / columns), base = Math.floor(indices.length / rows);
    let offset = 0;
    return Array.from({length:rows},(_,row)=>{
      const count = base + (row < indices.length % rows ? 1 : 0);
      const group = indices.slice(offset,offset+count);
      offset += count;
      return group;
    });
  }

  function score(slots, profiles){
    let result = 0;
    for(let i=0; i<slots.length; i++){
      const box = slots[i], p = profiles[i];
      if(!box || box.w < 25 || box.h < 23) return -Infinity;
      const w = box.w - 3.2, h = box.h - (i === 0 ? 7.6 : 5.8);
      const mapW = Math.min(w, h * p.aspect);
      const ink = mapW * mapW / p.aspect;
      const importance = Math.sqrt(p.divisions) * (i === 0 ? 1.7 : 1);
      result += importance * Math.log(Math.max(1, ink));
      result -= importance * .45 * (1 - ink / (w*h));
      // Varias divisiones requieren papel suficiente para calles y números.
      const needed = 260 + p.divisions * 145 + p.references * 24;
      if(ink < needed) result -= importance * Math.log(needed / Math.max(1,ink));
    }
    return result;
  }

  function plan(rawProfiles, options){
    if(!Array.isArray(rawProfiles) || !rawProfiles.length) return [];
    const ps = rawProfiles.map(profile), o = options || {};
    const portrait = o.orientation !== 'landscape';
    const pageW = portrait ? 210 : 297, pageH = portrait ? 297 : 210;
    const margin = Number.isFinite(o.margin) ? o.margin : 5;
    const gap = Number.isFinite(o.gap) ? o.gap : 2;
    const title = Number.isFinite(o.title) ? o.title : 15;
    const x = margin, y = margin + title;
    const w = pageW - 2*margin, h = pageH - margin - y;
    if(ps.length === 1) return [{x,y,w,h}];
    let second = -1;
    if(portrait && ps.length >= 8){
      for(let i=1;i<ps.length;i++) if(ps[i].divisions >= 6 &&
        (second < 0 || ps[i].divisions > ps[second].divisions)) second = i;
    }
    const main = second >= 0 ? [0,second] : [0];
    const rest = ps.map((_,i) => i).filter(i => !main.includes(i));
    // Los alargados horizontales van abajo; los verticales aprovechan la columna.
    const byShape = rest.slice().sort((a,b) => ps[a].aspect-ps[b].aspect || a-b);
    const byImportance = rest.slice().sort((a,b) =>
      Math.pow(ps[b].divisions,.65)/Math.sqrt(ps[b].aspect)
      - Math.pow(ps[a].divisions,.65)/Math.sqrt(ps[a].aspect) || a-b);
    const fractions = portrait ? [.57,.61,.65,.69,.73] : [.48,.52,.56,.60,.64];
    let best = null, bestScore = -Infinity;
    const consider = slots => {
      const quality = score(slots,ps);
      if(quality > bestScore){ bestScore=quality; best=slots; }
    };
    // Con pocos croquis, obligar uno a una columna de toda la altura deja
    // franjas vacías. También compiten un principal arriba y filas debajo.
    if(portrait && ps.length <= 6){
      for(let cols=1;cols<=Math.min(3,rest.length);cols++){
        const groups=balancedRows(rest,cols), rows=groups.length;
        for(const fraction of [.42,.50,.58,.66,.72]){
          const mainH=(h-gap)*fraction,lowerH=h-mainH-gap;
          const cellH=(lowerH-gap*(rows-1))/rows;
          if(mainH<55 || cellH<23) continue;
          const slots=Array(ps.length);
          slots[0]={x,y,w,h:mainH};
          for(let row=0;row<rows;row++){
            const indices=groups[row];
            const availableW=w-gap*(indices.length-1);
            const widths=distribute(availableW,
              indices.map(i=>clamp(ps[i].aspect,.4,3)*Math.pow(ps[i].divisions,.15)),
              Math.min(26,availableW/indices.length));
            let left=x;
            indices.forEach((i,col)=>{
              slots[i]={x:left,y:y+mainH+gap+row*(cellH+gap),w:widths[col],h:cellH};
              left+=widths[col]+gap;
            });
          }
          consider(slots);
        }
      }
    }
    for(const sideOrder of [byShape,byImportance]){
    for(const fraction of fractions){
      const leftW = (w-gap)*fraction, sideW = w-gap-leftW;
      const maxSide = Math.min(rest.length, portrait ? 9 : 15);
      for(let sideCount=1;sideCount<=maxSide;sideCount++){
        const side = sideOrder.slice(0,sideCount).sort((a,b)=>a-b);
        const bottom = rest.filter(i=>!side.includes(i));
        const sideColumnsMax = portrait ? 1 : Math.min(3,sideCount);
        for(let sideColumns=1;sideColumns<=sideColumnsMax;sideColumns++){
          const rowsSide = Math.ceil(sideCount / sideColumns);
          if((h-gap*(rowsSide-1))/rowsSide < 23) continue;
          const maxBottomCols = portrait ? 3 : 5;
          const colsOptions = bottom.length ? Array.from({length:Math.min(maxBottomCols,bottom.length)},(_,i)=>i+1) : [0];
          for(const cols of colsOptions){
            const groups = balancedRows(bottom,cols), rows = groups.length;
            const cellW = cols ? (leftW-gap*(cols-1))/cols : 0;
            if(cols && cellW < 25) continue;
            const idealBottom = rows ? rows * clamp(cellW*.66, 27, 43) + gap*(rows-1) : 0;
            for(const factor of rows ? [.85,1,1.18] : [1]){
              const lowerH = idealBottom*factor;
              const mainH = h - (rows ? lowerH+gap : 0);
              if(mainH/main.length < (portrait ? 55 : 60)) continue;
              const idealSplit = main.length===2
                ? (1/ps[main[0]].aspect*Math.pow(ps[main[0]].divisions,.12)) /
                  (1/ps[main[0]].aspect*Math.pow(ps[main[0]].divisions,.12)+1/ps[main[1]].aspect*Math.pow(ps[main[1]].divisions,.12))
                : 1;
              for(const shift of main.length===2 ? [-.08,0,.08] : [0]){
                const slots = Array(ps.length);
                const split = clamp(idealSplit+shift,.35,.70);
                const firstH = main.length===2 ? (mainH-gap)*split : mainH;
                slots[0] = {x,y,w:leftW,h:firstH};
                if(main.length===2) slots[second] = {x,y:y+firstH+gap,w:leftW,h:mainH-firstH-gap};
                for(let col=0;col<sideColumns;col++){
                  const indices = side.filter((_,i)=>i%sideColumns===col);
                  const columnW = (sideW-gap*(sideColumns-1))/sideColumns;
                  const availableH = h-gap*(indices.length-1);
                  const weights = indices.map(i=>clamp(1/ps[i].aspect,.6,2.5)*Math.pow(ps[i].divisions,.2));
                  const heights = distribute(availableH,weights,Math.min(24,availableH/indices.length));
                  let top = y;
                  indices.forEach((i,row)=>{
                    slots[i]={x:x+leftW+gap+col*(columnW+gap),y:top,w:columnW,h:heights[row]};
                    top += heights[row]+gap;
                  });
                }
                if(rows){
                  const cellH=(lowerH-gap*(rows-1))/rows;
                  for(let row=0;row<rows;row++){
                    const indices=groups[row];
                    const widths=distribute(leftW-gap*(indices.length-1),indices.map(i=>clamp(ps[i].aspect,.65,3)*Math.pow(ps[i].divisions,.15)),Math.min(26,(leftW-gap*(indices.length-1))/indices.length));
                    let left=x;
                    indices.forEach((i,col)=>{
                      slots[i]={x:left,y:y+mainH+gap+row*(cellH+gap),w:widths[col],h:cellH};
                      left += widths[col]+gap;
                    });
                  }
                }
                consider(slots);
              }
            }
          }
        }
      }
    }
    }
    return best || [];
  }
  return {plan, profile, score};
});
