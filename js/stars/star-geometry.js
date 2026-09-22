import * as THREE from "three";

/**
 * Géométrie d'étoile "gonflée" (coussin fermé, bords totalement arrondis).
 *
 * La hauteur de la surface dépend de la distance au contour, avec un profil
 * en quart de cercle sur le bord : pas de facettes, un arrondi parfait.
 * Les réglages (nombre de branches, concavité, épaisseur...) sont décrits
 * dans config.js (objets `shapes`).
 */
export function buildStarGeometry(o){
  const HI = 1440;                       // échantillonnage fin du contour
  const nTheta = 360, rings = 72, ringPow = 2;
  const TAU = Math.PI * 2;

  // 1) contour polaire R(θ) : côtés = courbes de Bézier tirées vers le centre (concaves)
  let R = new Float64Array(HI);
  const sector = TAU / o.tips, half = sector / 2;
  const NB = 400, bphi = new Float64Array(NB+1), bR = new Float64Array(NB+1);
  {
    const T = [o.outer, 0];                                   // pointe (angle 0)
    const V = [o.inner*Math.cos(half), o.inner*Math.sin(half)]; // creux voisin
    const C = [(T[0]+V[0])/2*(1-o.pull), (T[1]+V[1])/2*(1-o.pull)];
    for(let j=0;j<=NB;j++){
      const s = j/NB, m = 1-s;
      const x = m*m*T[0] + 2*m*s*C[0] + s*s*V[0];
      const y = m*m*T[1] + 2*m*s*C[1] + s*s*V[1];
      bphi[j] = Math.atan2(y, x); bR[j] = Math.hypot(x, y);
    }
  }
  for(let i=0;i<HI;i++){
    const a = i / HI * TAU;
    let phi = (((a - Math.PI/2) % sector) + sector) % sector;
    if(phi > half) phi = sector - phi;                        // écart à la pointe la plus proche
    let j = 0;
    while(j < NB && bphi[j+1] < phi) j++;
    const f = (phi - bphi[j]) / Math.max(1e-9, bphi[j+1] - bphi[j]);
    R[i] = bR[j] + (bR[Math.min(j+1,NB)] - bR[j]) * Math.min(1, Math.max(0, f));
  }
  // 2) léger flou circulaire -> pointes et creux arrondis
  const blur = (arr, sigma) => {
    const rad = Math.ceil(sigma * 3), k = [];
    let sum = 0;
    for(let j=-rad;j<=rad;j++){ const g = Math.exp(-(j*j)/(2*sigma*sigma)); k.push(g); sum += g; }
    const out = new Float64Array(arr.length), n = arr.length;
    for(let i=0;i<n;i++){
      let s = 0;
      for(let j=-rad;j<=rad;j++) s += k[j+rad] * arr[((i+j)%n+n)%n];
      out[i] = s / sum;
    }
    return out;
  };
  R = blur(R, o.tipRound * HI / 360);

  // 3) polyligne du contour pour la distance
  const seg = HI / 2, px = new Float64Array(seg + 1), py = new Float64Array(seg + 1);
  for(let i=0;i<=seg;i++){
    const a = (i*2 % HI) / HI * TAU, r = R[(i*2) % HI];
    px[i] = r * Math.cos(a); py[i] = r * Math.sin(a);
  }
  const distToOutline = (x, y) => {
    let best = 1e9;
    for(let i=0;i<seg;i++){
      const ax = px[i], ay = py[i], bx = px[i+1]-ax, by = py[i+1]-ay;
      let t = ((x-ax)*bx + (y-ay)*by) / (bx*bx + by*by);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - ax - t*bx, dy = y - ay - t*by;
      const d = dx*dx + dy*dy;
      if(d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const height = d => {
    const q = Math.min(d / o.bevel, 1);
    const round = Math.sqrt(Math.max(0, 1 - (1-q)*(1-q)));
    return o.thickness * ((1 - o.ridge) * round + o.ridge * q);
  };

  // 4) grille polaire (anneaux serrés vers le bord pour un arrondi lisse)
  const xs = new Float32Array(rings * nTheta), ys = new Float32Array(rings * nTheta);
  const hs = new Float32Array(rings * nTheta);
  for(let k=1;k<=rings;k++){
    const s = 1 - Math.pow(1 - k/rings, ringPow);
    for(let i=0;i<nTheta;i++){
      const a = i / nTheta * TAU, r = R[i * (HI / nTheta)] * s;
      const id = (k-1)*nTheta + i, x = r*Math.cos(a), y = r*Math.sin(a);
      xs[id] = x; ys[id] = y;
      hs[id] = k === rings ? 0 : height(distToOutline(x, y));
    }
  }
  // adoucit les arêtes le long de θ (n'altère pas le profil du bord)
  if(o.soften > 0){
    for(let k=1;k<rings;k++){
      const row = new Float64Array(nTheta);
      for(let i=0;i<nTheta;i++) row[i] = hs[(k-1)*nTheta + i];
      const sm = blur(row, o.soften);
      for(let i=0;i<nTheta;i++) hs[(k-1)*nTheta + i] = sm[i];
    }
  }
  const poleH = height(distToOutline(0, 0));

  // 5) assemblage haut + bas (bord partagé)
  const nV = 2 + (2*rings - 1) * nTheta;
  const pos = new Float32Array(nV * 3);
  const top = (k,i) => 1 + (k-1)*nTheta + (i % nTheta);
  const bot = (k,i) => k === rings ? top(k,i) : 1 + rings*nTheta + (k-1)*nTheta + (i % nTheta);
  const poleBot = nV - 1;
  const put = (v,x,y,z) => { pos[v*3]=x; pos[v*3+1]=y; pos[v*3+2]=z; };
  put(0, 0, 0, poleH); put(poleBot, 0, 0, -poleH);
  for(let k=1;k<=rings;k++) for(let i=0;i<nTheta;i++){
    const id = (k-1)*nTheta + i;
    put(top(k,i), xs[id], ys[id],  hs[id]);
    if(k < rings) put(bot(k,i), xs[id], ys[id], -hs[id]);
  }
  const idx = [];
  for(let i=0;i<nTheta;i++){
    idx.push(0, top(1,i), top(1,i+1));
    idx.push(poleBot, bot(1,i+1), bot(1,i));
  }
  for(let k=1;k<rings;k++) for(let i=0;i<nTheta;i++){
    let a=top(k,i), b=top(k,i+1), c=top(k+1,i+1), d=top(k+1,i);
    idx.push(a,d,c, a,c,b);
    a=bot(k,i); b=bot(k,i+1); c=bot(k+1,i+1); d=bot(k+1,i);
    idx.push(a,c,d, a,b,c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  n.setXYZ(0, 0, 0, 1); n.setXYZ(poleBot, 0, 0, -1);
  return g;
}
