/* Public OpenStreetMap geometry only. No account, device or GPS data. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CroquisOfflineDetails = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = 2;
  const AREA_KINDS = new Set(['building','park','forest','grass','farmland','residential','industrial','water']);
  const PLACE_KINDS = new Set(['city','town','village','hamlet','suburb','neighbourhood','quarter','locality','isolated_dwelling']);
  const coordinate = (lat,lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180;
  const same = (a,b) => a && b && a[0]===b[0] && a[1]===b[1];
  const displayName = tags => String(tags?.name || tags?.['name:es'] || tags?.official_name || '').trim();
  function areaKind(tags) {
    if (tags.area==='no') return '';
    if (tags.building && tags.building!=='no') return 'building';
    if (tags.natural==='water' || tags.waterway==='riverbank' || /^(reservoir|basin)$/.test(tags.landuse || '')) return 'water';
    if (/^(park|garden)$/.test(tags.leisure || '')) return 'park';
    if (tags.landuse==='forest' || tags.natural==='wood') return 'forest';
    if (/^(grass|meadow|village_green|recreation_ground|allotments|cemetery)$/.test(tags.landuse || '') ||
        /^(grassland|scrub|heath|wetland)$/.test(tags.natural || '') || /^(pitch|playground|sports_centre)$/.test(tags.leisure || '')) return 'grass';
    if (/^(farmland|orchard|vineyard|farmyard)$/.test(tags.landuse || '')) return 'farmland';
    if (tags.landuse==='residential') return 'residential';
    if (/^(industrial|commercial|retail|construction|railway)$/.test(tags.landuse || '')) return 'industrial';
    return '';
  }
  function points(geometry) {
    if (!Array.isArray(geometry)) return null;
    const result=[];
    for (const point of geometry) {
      if (point?.lat==null || (point.lon ?? point.lng)==null) return null;
      const lat=Number(point?.lat),lng=Number(point?.lon ?? point?.lng);
      if (!coordinate(lat,lng)) return null;
      const pair=[Number(lat.toFixed(7)),Number(lng.toFixed(7))];
      if (!same(pair,result.at(-1))) result.push(pair);
    }
    return result;
  }
  function signedArea(ring) {
    // Translate to the first point to keep small building areas numerically stable.
    const origin=ring[0]; let result=0;
    for (let i=1;i<ring.length;i++) result+=(ring[i-1][1]-origin[1])*(ring[i][0]-origin[0])-(ring[i][1]-origin[1])*(ring[i-1][0]-origin[0]);
    return result/2;
  }
  function validRing(ring) {
    return Array.isArray(ring) && ring.length>=4 && same(ring[0],ring.at(-1)) &&
      ring.every(point=>Array.isArray(point) && point.length===2 && coordinate(point[0],point[1])) && Math.abs(signedArea(ring))>1e-13;
  }
  function contains(ring,point) {
    let inside=false;
    for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[i],b=ring[j];
      const cross=(point[1]-a[1])*(b[0]-a[0])-(point[0]-a[0])*(b[1]-a[1]);
      if (Math.abs(cross)<1e-12 && point[0]>=Math.min(a[0],b[0])-1e-9 && point[0]<=Math.max(a[0],b[0])+1e-9 && point[1]>=Math.min(a[1],b[1])-1e-9 && point[1]<=Math.max(a[1],b[1])+1e-9) return true;
      if ((a[0]>point[0])!==(b[0]>point[0]) && point[1]<(b[1]-a[1])*(point[0]-a[0])/(b[0]-a[0])+a[1]) inside=!inside;
    }
    return inside;
  }
  function joinRings(segments) {
    const pending=segments.map(segment=>segment.slice()),rings=[];
    while (pending.length) {
      let ring=pending.shift();
      if (!ring || ring.length<2) return null;
      while (!same(ring[0],ring.at(-1))) {
        const index=pending.findIndex(segment=>same(ring.at(-1),segment[0]) || same(ring.at(-1),segment.at(-1)));
        if (index<0) return null;
        const next=pending.splice(index,1)[0];
        if (!same(ring.at(-1),next[0])) next.reverse();
        ring=ring.concat(next.slice(1));
      }
      if (!validRing(ring)) return null;
      rings.push(ring);
    }
    return rings;
  }
  function relationPolygons(element,ways) {
    const outer=[],inner=[],outerIds=[];
    for (const member of element.members || []) {
      if (member.type==='relation' && ['','outer','inner'].includes(member.role || '')) return null;
      if (member.type!=='way' || !['','outer','inner'].includes(member.role || '')) continue;
      const segment=points(member.geometry || ways.get(String(member.ref))?.geometry);
      if (!segment || segment.length<2) return null;
      (member.role==='inner' ? inner : outer).push(segment);
      if (member.role!=='inner') outerIds.push(String(member.ref));
    }
    const outlines=joinRings(outer),holes=joinRings(inner);
    if (!outlines?.length || !holes) return null;
    const polygons=outlines.map(ring=>[ring]);
    for (const hole of holes) {
      const containers=outlines.map((ring,index)=>({ring,index,area:Math.abs(signedArea(ring))}))
        .filter(item=>hole.every(point=>contains(item.ring,point))).sort((a,b)=>a.area-b.area);
      if (!containers.length) return null;
      polygons[containers[0].index].push(hole);
    }
    return {polygons,outerIds};
  }
  function center(element) {
    const lat=Number(element.lat ?? element.center?.lat),lng=Number(element.lon ?? element.center?.lon);
    if (coordinate(lat,lng)) return {lat,lng};
    const bounds=element.bounds;
    if (bounds && [bounds.minlat,bounds.minlon,bounds.maxlat,bounds.maxlon].every(Number.isFinite) &&
        coordinate(bounds.minlat,bounds.minlon) && coordinate(bounds.maxlat,bounds.maxlon) && bounds.minlat<=bounds.maxlat && bounds.minlon<=bounds.maxlon) {
      return {lat:(bounds.minlat+bounds.maxlat)/2,lng:(bounds.minlon+bounds.maxlon)/2};
    }
    const geometry=points(element.geometry);
    if (!geometry?.length) return null;
    return {lat:(Math.min(...geometry.map(point=>point[0]))+Math.max(...geometry.map(point=>point[0])))/2,
      lng:(Math.min(...geometry.map(point=>point[1]))+Math.max(...geometry.map(point=>point[1])))/2};
  }
  function fromElements(elements) {
    if (!Array.isArray(elements)) return {areas:[],places:[]};
    elements=[...new Map(elements.filter(element=>element && element.id!=null && element.type).map(element=>[element.type+'/'+element.id,element])).values()];
    const areas=[],places=[],ways=new Map(),suppressed=new Set(),ids=new Set(),placeKeys=new Set();
    for (const element of elements) if (element?.type==='way') ways.set(String(element.id),element);
    for (const element of elements) {
      const tags=element?.tags || {},kind=areaKind(tags);
      if (element?.type!=='relation' || tags.type!=='multipolygon' || !kind) continue;
      (element.members || []).filter(member=>member.type==='way' && member.role!=='inner')
        .forEach(member=>{ if (areaKind(ways.get(String(member.ref))?.tags || {})===kind) suppressed.add(String(member.ref)); });
      const assembled=relationPolygons(element,ways);
      if (!assembled) throw new Error('La geometría del área '+element.id+' está incompleta. Vuelve a intentar la descarga.');
      assembled.polygons.forEach((rings,index)=>areas.push({id:'relation/'+element.id+'/'+index,kind,name:displayName(tags),rings}));
    }
    for (const element of elements) {
      const tags=element?.tags || {},kind=areaKind(tags);
      if (element?.type==='way' && kind && !suppressed.has(String(element.id))) {
        const ring=points(element.geometry),id='way/'+element.id;
        if (validRing(ring) && !ids.has(id)) { areas.push({id,kind,name:displayName(tags),rings:[ring]}); ids.add(id); }
      }
      if (!PLACE_KINDS.has(tags.place)) continue;
      const name=displayName(tags),point=center(element);
      if (!name || !point) continue;
      const key=[tags.place,name.toLocaleLowerCase('es-MX'),point.lat.toFixed(5),point.lng.toFixed(5)].join('|');
      if (placeKeys.has(key)) continue;
      placeKeys.add(key);
      places.push({name,kind:tags.place,lat:Number(point.lat.toFixed(7)),lng:Number(point.lng.toFixed(7))});
    }
    return {areas,places};
  }
  function valid(details) {
    if (!details || !Array.isArray(details.areas) || !Array.isArray(details.places)) return false;
    const ids=new Set();
    return details.areas.every(area=> {
      if (!area || typeof area.id!=='string' || !area.id || ids.has(area.id) || !AREA_KINDS.has(area.kind) || typeof area.name!=='string' || !Array.isArray(area.rings) || !area.rings.length || !area.rings.every(validRing)) return false;
      ids.add(area.id);
      return area.rings.slice(1).every(hole=>hole.every(point=>contains(area.rings[0],point)));
    }) && details.places.every(place=>place && typeof place.name==='string' && !!place.name.trim() && PLACE_KINDS.has(place.kind) && coordinate(place.lat,place.lng));
  }
  return Object.freeze({VERSION,fromElements,valid});
});
