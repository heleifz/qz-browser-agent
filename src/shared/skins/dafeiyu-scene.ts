/** Editable source, deliberately self-contained: the sandbox supplies THREE and assets. */
export const DAFEIYU_SCENE = String.raw`// Blue-haired whale companion. Units are relative to a ~3.5-unit tall figure.
// Edit the palette, proportions, geometry and update() freely. No network imports are needed.
const palette = { hair: 0x34467e, tips: 0x648fd0, dress: 0x232b50, ribbon: 0x88bde9,
  cream: 0xfff0e8, white: 0xfffaf4, ink: 0x24233f, iris: 0x568ec7 };
const root = new THREE.Group();
const mats = Object.fromEntries(Object.entries(palette).map(([key,color]) => [key,
  new THREE.MeshStandardMaterial({color, roughness: .72, metalness: 0})]));
function ellipsoid(parent, material, position, scale) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1,32,24),material);
  mesh.position.set(...position); mesh.scale.set(...scale); parent.add(mesh); return mesh;
}
function curve(parent, points, radius, material) {
  const path = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(path,32,radius,8,false),material);
  parent.add(mesh); return mesh;
}
function lock(parent, points, width, depth, material) {
  const path = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  const vertices=[], indices=[]; const steps=32, sides=10;
  for(let i=0;i<=steps;i++) {
    const t=i/steps, p=path.getPoint(t), tangent=path.getTangent(t);
    const normal=new THREE.Vector3(tangent.y,-tangent.x,0).normalize();
    const taper=Math.pow(Math.sin(Math.PI*(.14+.86*t)),.65)*.96+.015;
    for(let j=0;j<=sides;j++) {
      const a=j/sides*Math.PI*2;
      vertices.push(p.x+normal.x*Math.cos(a)*width*taper,p.y+normal.y*Math.cos(a)*width*taper,p.z+Math.sin(a)*depth*taper);
      if(i<steps && j<sides) {const k=i*(sides+1)+j;indices.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);parent.add(mesh);return mesh;
}
function bow(parent, position, scale=1) {
  const group=new THREE.Group();group.position.set(...position);group.scale.setScalar(scale);parent.add(group);
  for(const side of [-1,1]) {const wing=ellipsoid(group,mats.ribbon,[side*.12,0,0],[.16,.115,.065]);wing.rotation.z=side*-.3;}
  ellipsoid(group,mats.white,[0,0,.035],[.055,.06,.055]); return group;
}
// Whale tail, behind the dress, with two flukes.
const tail=new THREE.Group();root.add(tail);
curve(tail,[[.15,-.95,-.35],[.75,-1.05,-.5],[1.22,-.62,-.48],[1.38,-.1,-.4]],.15,mats.hair);
lock(tail,[[1.35,-.13,-.4],[1.6,-.02,-.38],[1.82,.25,-.4]],.19,.08,mats.hair);
lock(tail,[[1.35,-.13,-.4],[1.18,.12,-.4],[1.11,.4,-.43]],.17,.08,mats.hair);
// Shoes and stocking legs.
for(const side of [-1,1]) {
  ellipsoid(root,mats.white,[side*.24,-1.32,.04],[.13,.28,.14]);
  ellipsoid(root,mats.dress,[side*.24,-1.53,.13],[.175,.13,.24]);
  curve(root,[[side*.24-.12,-1.48,.24],[side*.24,-1.44,.29],[side*.24+.12,-1.48,.24]],.025,mats.white);
}
// Bell-shaped skirt: soft lobes make a scalloped silhouette.
const dressGeometry=new THREE.CylinderGeometry(.3,.79,.85,64,8,false);
const dressPositions=dressGeometry.attributes.position;
for(let i=0;i<dressPositions.count;i++) {
  const x=dressPositions.getX(i),z=dressPositions.getZ(i),y=dressPositions.getY(i);
  const r=1+.04*Math.cos(Math.atan2(z,x)*12)*(1-(y+.425)/.85);
  dressPositions.setXYZ(i,x*r,y,z*r);
}
dressGeometry.computeVertexNormals();
const dress=new THREE.Mesh(dressGeometry,mats.dress);dress.position.y=-.69;root.add(dress);
for(let i=0;i<36;i++) {const a=i/36*Math.PI*2;ellipsoid(root,mats.white,[Math.cos(a)*.73,-1.095,Math.sin(a)*.73],[.095,.06,.095]);}
ellipsoid(root,mats.dress,[0,-.1,0],[.34,.46,.28]);
// White apron, stitched rim and small whale emblem.
ellipsoid(root,mats.white,[0,-.67,.52],[.47,.42,.17]);
for(let i=0;i<24;i++){const a=i/24*Math.PI*2;ellipsoid(root,mats.white,[Math.cos(a)*.46,-.67+Math.sin(a)*.38,.57],[.064,.064,.065]);}
ellipsoid(root,mats.white,[0,-.06,.26],[.2,.3,.07]);
for(const side of [-1,1]) curve(root,[[side*.17,.19,.16],[side*.25,-.02,.27],[side*.25,-.3,.3]],.047,mats.white);
ellipsoid(root,mats.hair,[0,-.73,.69],[.14,.075,.018]);
lock(root,[[.1,-.73,.69],[.19,-.65,.69],[.23,-.66,.69]],.045,.016,mats.hair);
ellipsoid(root,mats.white,[-.065,-.705,.71],[.014,.014,.009]);
bow(root,[0,.12,.34],.67);
for(const side of [-1,1]) {ellipsoid(root,mats.white,[side*.09,-.18,.33],[.025,.025,.017]);}
// Arms have their own pivots for a small, friendly idle movement.
const arms=[];
for(const side of [-1,1]) {
  const arm=new THREE.Group();arm.position.set(side*.31,.02,0);root.add(arm);arms.push(arm);
  const sleeve=ellipsoid(arm,mats.dress,[side*.12,-.14,.015],[.2,.29,.21]);sleeve.rotation.z=side*.38;
  ellipsoid(arm,mats.white,[side*.21,-.33,.1],[.15,.065,.16]);
  ellipsoid(arm,mats.cream,[side*.23,-.4,.14],[.125,.135,.12]);
}
const head=new THREE.Group();head.position.y=.95;root.add(head);
ellipsoid(head,mats.hair,[0,.05,-.19],[.85,.83,.59]);
ellipsoid(head,mats.cream,[0,0,.1],[.72,.65,.59]);
// Back locks are three-dimensional, so the back view is also finished.
for(let i=0;i<9;i++) {
  const x=(i-4)*.18;
  lock(head,[[x,.43,-.4],[x*1.14,-.2,-.55],[x*1.25,-.9,-.46],[x*1.35+.08,-1.38,-.25]],.18,.12,i%3===0?mats.tips:mats.hair);
}
const cap=new THREE.Mesh(new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,1.42),mats.hair);
cap.scale.set(.82,.77,.65);cap.position.set(0,.09,.04);head.add(cap);
for(const side of [-1,1]) {
  // Whale-fin ears.
  lock(head,[[side*.63,.2,-.04],[side*.91,.09,.02],[side*1.1,.14,.07]],.19,.085,mats.hair);
  lock(head,[[side*.72,.13,.045],[side*.91,.065,.1],[side*1.06,.12,.12]],.067,.03,mats.white);
  // Long, curled side locks and blue tips.
  lock(head,[[side*.67,.42,.17],[side*.77,-.11,.24],[side*.7,-.6,.28],[side*.91,-.91,.23],[side*.76,-1.23,.29]],.21,.12,mats.hair);
  lock(head,[[side*.77,-.62,.24],[side*.9,-.98,.26],[side*.73,-1.24,.32],[side*.61,-1.13,.34]],.16,.09,mats.tips);
  lock(head,[[side*.72,-.2,-.1],[side*.97,-.65,-.03],[side*.99,-1.08,.08],[side*1.12,-.97,.17]],.15,.1,mats.tips);
}
// Large eyes, with layered irises and reflected highlights.
const eyes=[];
for(const side of [-1,1]) {
  const eye=new THREE.Group();eye.position.set(side*.275,-.055,.635);head.add(eye);eyes.push(eye);
  ellipsoid(eye,mats.ink,[0,0,0],[.217,.263,.045]);
  ellipsoid(eye,mats.white,[0,-.012,.027],[.192,.23,.03]);
  ellipsoid(eye,mats.iris,[side*.008,-.02,.052],[.139,.19,.027]);
  ellipsoid(eye,mats.ink,[side*.008,.022,.075],[.075,.13,.016]);
  ellipsoid(eye,mats.ribbon,[side*.008,-.12,.077],[.095,.056,.018]);
  ellipsoid(eye,mats.white,[-.05,.085,.1],[.052,.06,.016]);
  ellipsoid(eye,mats.white,[.058,-.06,.097],[.024,.03,.012]);
  curve(head,[[side*.1,.14,.67],[side*.27,.2,.69],[side*.46,.14,.61],[side*.51,.21,.57]],.025,mats.ink);
  const blushMat=new THREE.MeshStandardMaterial({color:0xf3b4bb,roughness:.9});
  ellipsoid(head,blushMat,[side*.47,-.29,.56],[.108,.035,.017]);
}
// Tiny smile and layered bangs.
curve(head,[[-.08,-.33,.657],[0,-.365,.67],[.08,-.33,.657]],.015,mats.ink);
for(const [points,width] of [
  [[[-.28,.68,.4],[-.4,.42,.6],[-.36,.13,.69],[-.15,.17,.68]],.19],
  [[[-.06,.72,.47],[.04,.48,.67],[.03,.18,.73],[-.12,.02,.71]],.23],
  [[[.2,.69,.42],[.32,.42,.62],[.43,.13,.68],[.52,.05,.61]],.21],
]) lock(head,points,width,.075,mats.hair);
// White maid headband, with small scalloped ruffles.
curve(head,[[-.75,.35,-.05],[-.56,.72,-.05],[0,.87,-.05],[.56,.72,-.05],[.75,.35,-.05]],.055,mats.dress);
for(let i=0;i<15;i++) {
  const a=Math.PI*.08+i/14*Math.PI*.84;
  const ruffle=ellipsoid(head,mats.white,[Math.cos(a)*.82,Math.sin(a)*.86+.06,-.045],[.1,.115,.09]);
  ruffle.rotation.z=a-Math.PI/2;
}
bow(head,[.72,.49,.13],.85);
curve(head,[[-.12,.79,-.1],[-.25,1.12,-.12],[.06,1.2,-.12],[.2,1.04,-.1]],.036,mats.hair);
return { root,
  update(time) {
    head.rotation.z=Math.sin(time*.8)*.025;
    tail.rotation.y=Math.sin(time*1.5)*.09;
    arms.forEach((arm,i)=>arm.rotation.z=Math.sin(time*1.15+i)*.035);
    const blink=time%5.3; const openness=blink<.16?Math.max(.08,Math.abs(blink-.08)/.08):1;
    eyes.forEach(eye=>eye.scale.y=openness);
  }
};`;
