const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const details=require('../outputs/offline-map-details.js');
const geometry=points=>points.map(([lat,lon])=>({lat,lon}));
const square=(lat=19,lng=-97,size=.01)=>[[lat,lng],[lat+size,lng],[lat+size,lng+size],[lat,lng+size],[lat,lng]];
const way=(id,tags,points)=>({type:'way',id,tags,geometry:geometry(points)});
const member=(ref,role,points)=>({type:'way',ref,role,geometry:geometry(points)});

test('módulo versión2 funciona en Node y navegador y admite zonas rurales vacías',()=>{
  assert.equal(details.VERSION,2);
  assert.equal(details.valid({areas:[],places:[]}),true);
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../outputs/offline-map-details.js'),'utf8'),context);
  assert.equal(context.window.CroquisOfflineDetails.VERSION,2);
  assert.equal(context.window.CroquisOfflineDetails.valid({areas:[],places:[]}),true);
});

test('convierte edificios, parque, agua y usos de suelo desde contornos cerrados reales sin guardar tags personales',()=>{
  const tags=[{building:'yes',name:'Escuela',user:'persona',uid:1},{leisure:'park'},{natural:'water'},
    {natural:'wood'},{landuse:'grass'},{landuse:'farmland'},{landuse:'residential'},{landuse:'industrial'}];
  const result=details.fromElements(tags.map((tag,i)=>way(i+1,tag,square(19+i*.02))));
  assert.deepEqual(result.areas.map(area=>area.kind),['building','park','water','forest','grass','farmland','residential','industrial']);
  assert.deepEqual(Object.keys(result.areas[0]).sort(),['id','kind','name','rings']);
  assert.equal(details.valid(result),true);
});

test('ensambla miembros invertidos con varios exteriores y asigna cada hueco a su exterior',()=>{
  const first=square(),second=square(19.1),hole=square(19.002,-96.998,.002);
  const relation={type:'relation',id:45,tags:{type:'multipolygon',natural:'water',name:'Laguna'},members:[
    member(1,'outer',first.slice(0,3)),member(2,'outer',[first[0],first[4],first[3],first[2]]),
    member(3,'inner',hole),member(4,'outer',second)]};
  const result=details.fromElements([relation]);
  assert.equal(result.areas.length,2);
  assert.equal(result.areas[0].rings.length,2);
  assert.equal(result.areas[1].rings.length,1);
  assert.deepEqual(result.areas[0].rings[1],hole.map(point=>point.map(number=>Number(number.toFixed(7)))));
  assert.equal(details.valid(result),true);
});

test('no duplica el exterior de una relación ni rellena sus huecos con el way original',()=>{
  const outer=square(),hole=square(19.002,-96.998,.002);
  const relation={type:'relation',id:3,tags:{type:'multipolygon',landuse:'forest'},members:[member(1,'outer',outer),member(2,'inner',hole)]};
  const result=details.fromElements([way(1,{landuse:'forest'},outer),relation,relation]);
  assert.equal(result.areas.length,1);
  assert.equal(result.areas[0].rings.length,2);
  assert.equal(details.valid(result),true);
});

test('una relación incompleta o un hueco fuera del exterior nunca produce un área cerrada inventada',()=>{
  const outer=square();
  const broken={type:'relation',id:4,tags:{type:'multipolygon',landuse:'forest'},members:[member(1,'outer',outer),{type:'way',ref:2,role:'inner'}]};
  assert.throws(()=>details.fromElements([way(1,{landuse:'forest'},outer),broken]),/incompleta/);
  const outside={...broken,members:[member(1,'outer',outer),member(2,'inner',square(20))]};
  assert.throws(()=>details.fromElements([outside]),/incompleta/);
  const open=way(8,{building:'yes'},square().slice(0,4));
  assert.equal(details.fromElements([open]).areas.length,0);
});

test('valida coordenadas, cierre, huecos, IDs únicos y localidades sin aceptar datos corruptos como completos',()=>{
  const result=details.fromElements([way(1,{building:'yes'},square())]);
  assert.equal(details.valid(result),true);
  for(const mutate of [data=>data.areas[0].rings[0][0][0]=NaN,
    data=>data.areas[0].rings[0].pop(),data=>data.areas.push(data.areas[0]),
    data=>data.areas[0].rings.push(square(20)),data=>data.areas[0].kind='unsupported']){
    const copy=JSON.parse(JSON.stringify(result)); mutate(copy); assert.equal(details.valid(copy),false);
  }
  assert.equal(details.valid({areas:[],places:[{name:'Pueblo',kind:'town',lat:91,lng:-97}]}),false);
  assert.equal(details.fromElements([way(9,{building:'yes'},[[null,-97],[19,-97],[19,-96],[null,-97]])]).areas.length,0);
});

test('conserva nombres OSM de pueblos y barrios y descarta puntos sin nombre o geometría',()=>{
  const result=details.fromElements([{type:'node',id:1,tags:{place:'town',name:'Ixhuatlán del Café'},lat:19.05,lon:-96.98},
    {type:'node',id:2,tags:{place:'neighbourhood',name:'Colonia Centro'},lat:19.051,lon:-96.981},
    {type:'node',id:3,tags:{place:'suburb'},lat:19.05,lon:-96.98},
    {type:'node',id:4,tags:{place:'village',name:'Sin posición'}}]);
  assert.deepEqual(result.places.map(place=>place.name),['Ixhuatlán del Café','Colonia Centro']);
  assert.equal(details.valid(result),true);
});

test('usa bounds reales para localidades cartografiadas como relaciones sin punto central',()=>{
  const result=details.fromElements([{type:'relation',id:7,tags:{type:'boundary',place:'village',name:'Zacamitla'},
    bounds:{minlat:19,minlon:-97,maxlat:19.02,maxlon:-96.98},members:[]}]);
  assert.equal(result.places.length,1);
  assert.equal(result.places[0].name,'Zacamitla');
  assert(Math.abs(result.places[0].lat-19.01)<1e-9);
  assert(Math.abs(result.places[0].lng+96.99)<1e-9);
  assert.equal(details.valid(result),true);
});
