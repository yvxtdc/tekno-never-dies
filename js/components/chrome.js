/**
 * Objets chromés dessinés par le code (SVG), posés par-dessus les photos sans jamais les modifier.
 *
 * Chaque dessin renvoie le balisage d'un <svg> autonome (ses dégradés ont des identifiants uniques :
 * plusieurs exemplaires peuvent cohabiter sur la page, y compris les copies du carrousel infini).
 * Les objets trop complexes pour être redessinés proprement (paire d'étoiles, épine…) restent des
 * images détourées de assets/img/decor/.
 *
 * CHROME_OBJECTS est le catalogue : chaque objet a une famille de silhouette (« etoile », « epine »…),
 * qui sert à éviter les répétitions (team-composition.js) ; les dessins acceptent une teinte
 * « silver » (argent) ou « violet » (reflets de la charte : --violet, --lav).
 *
 * Rendu « métal poli » : facettes franches alternant zones très claires et très sombres selon une
 * lumière venant d'en haut à gauche, arêtes claires et contour sombre fin pour des bords nets.
 * Aucune dépendance au DOM : utilisable aussi sous Node (outils, CMS, validation).
 */

let uid = 0;
const nextId = () => `tnd-chrome-${++uid}`;
const r2 = (n) => Math.round(n * 100) / 100;

/* Rampes du métal, du plus sombre au plus clair. Violet : #4226b6 (--violet) et #956aff (--lav) dans
   les tons moyens, blanc lavande dans les reflets. */
const RAMPS = {
  silver: ["#0d0b17", "#24213a", "#4a4664", "#837f9c", "#bcb9cf", "#e6e4f0", "#ffffff"],
  violet: ["#0b0722", "#1d1050", "#4226b6", "#7a55ef", "#b9a2ff", "#e4dbff", "#ffffff"]
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function shade(t, tint = "silver") {
  const ramp = RAMPS[tint] || RAMPS.silver;
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const a = hex(ramp[i]), b = hex(ramp[i + 1]), k = x - i;
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
}
const OUTLINE = `stroke="#0d0b17" stroke-opacity=".55" stroke-linejoin="round"`;

/* Lumière : d'en haut à gauche */
const LIGHT = (() => { const v = [-0.62, -0.78]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const polar = (deg, len) => { const a = (deg * Math.PI) / 180; return [Math.sin(a) * len, -Math.cos(a) * len]; };
// Éclairement d'une face dont la normale (dans le plan) est n : 0 (dos à la lumière) à 1 (face à elle)
const lit = (n) => 0.5 - (n[0] * LIGHT[0] + n[1] * LIGHT[1]) * 0.48;

const svgOpen = (viewBox, ratio) =>
  `<svg viewBox="${viewBox}" width="100" height="${r2(100 * ratio)}" aria-hidden="true" focusable="false">`;

/**
 * Étoile scintillante à facettes.
 * rays : [{ angle (0 = haut, en degrés), length }] ; valley : rayon des creux entre deux branches ;
 * curve : 0 = côtés droits, 1 = côtés très incurvés (étincelle).
 */
function sparkleSvg({ rays, valley = 9, curve = 0.35, tint }) {
  const id = nextId();
  const sorted = [...rays].sort((a, b) => a.angle - b.angle);
  const defs = [];
  const facets = [];
  const ridges = [];
  const outline = [];

  sorted.forEach((ray, i) => {
    const prev = sorted[(i - 1 + sorted.length) % sorted.length];
    const next = sorted[(i + 1) % sorted.length];
    const gapPrev = ((ray.angle - prev.angle + 360) % 360) || 360;
    const gapNext = ((next.angle - ray.angle + 360) % 360) || 360;
    const tip = polar(ray.angle, ray.length);
    const vPrev = polar(ray.angle - gapPrev / 2, valley);
    const vNext = polar(ray.angle + gapNext / 2, valley);

    [[vPrev, -1], [vNext, 1]].forEach(([v, side], k) => {
      // Normale de la facette : vers son côté de la branche ; éclairée si elle regarde la lumière
      const base = lit(polar(ray.angle + side * 90, 1));
      const g = `${id}-${i}-${k}`;
      defs.push(`<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${r2(tip[0])}" y2="${r2(tip[1])}">` +
        `<stop offset="0" stop-color="${shade(base + 0.32, tint)}"/>` +
        `<stop offset=".38" stop-color="${shade(base, tint)}"/>` +
        `<stop offset=".8" stop-color="${shade(base - 0.14, tint)}"/>` +
        `<stop offset="1" stop-color="${shade(base + 0.12, tint)}"/></linearGradient>`);
      // Côté extérieur incurvé vers l'axe de la branche (point de contrôle entre creux et pointe)
      const mid = [(v[0] + tip[0]) / 2, (v[1] + tip[1]) / 2];
      const axis = polar(ray.angle, Math.hypot(...mid) * 0.98);
      const c = [mid[0] + (axis[0] - mid[0]) * curve, mid[1] + (axis[1] - mid[1]) * curve];
      facets.push(`<path fill="url(#${g})" d="M0 0L${r2(v[0])} ${r2(v[1])}Q${r2(c[0])} ${r2(c[1])} ${r2(tip[0])} ${r2(tip[1])}Z"/>`);
      // Contour : creux précédent -> pointe -> creux suivant (même point de contrôle à l'aller et au retour)
      if (side === -1) outline.push(`${i ? "" : `M${r2(v[0])} ${r2(v[1])}`}Q${r2(c[0])} ${r2(c[1])} ${r2(tip[0])} ${r2(tip[1])}`);
      else outline.push(`Q${r2(c[0])} ${r2(c[1])} ${r2(v[0])} ${r2(v[1])}`);
    });
    ridges.push(`M0 0L${r2(tip[0] * 0.97)} ${r2(tip[1] * 0.97)}`);
  });

  const max = Math.max(...rays.map((r) => r.length)) + 2;
  return svgOpen(`${-max} ${-max} ${max * 2} ${max * 2}`, 1) +
    `<defs>${defs.join("")}<radialGradient id="${id}-glint"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    facets.join("") +
    `<path d="${ridges.join("")}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".55" stroke-linecap="round"/>` +
    `<path d="${outline.join("")}Z" fill="none" ${OUTLINE} stroke-width=".7"/>` +
    `<circle r="${r2(valley * 1.7)}" fill="url(#${id}-glint)"/></svg>`;
}

/* Branches des étincelles : 8 branches (grandes horizontales et verticales, courtes diagonales)
   ou 4 branches (étincelle allongée) */
const SPARKLE = {
  8: { valley: 15, curve: 0.12, rays: [0, 180].map((angle) => ({ angle, length: 94 }))
    .concat([90, 270].map((angle) => ({ angle, length: 100 })))
    .concat([45, 135, 225, 315].map((angle) => ({ angle, length: 44 }))) },
  4: { valley: 17, curve: 0.5, rays: [0, 180].map((angle) => ({ angle, length: 100 }))
    .concat([90, 270].map((angle) => ({ angle, length: 62 }))) }
};

/**
 * Pièce biseautée : un contour (polygone) extrudé en relief. Chaque bord du biseau est une facette
 * éclairée selon son orientation ; le dessus plat reçoit des bandes de reflets en diagonale.
 */
function bevelSvg({ points: outline, bevel = 0.2, viewBox, ratio, tint }) {
  const id = nextId();
  // Contour parcouru dans le sens horaire à l'écran (normales des bords vers l'extérieur)
  const area = outline.reduce((s, p, i) => { const q = outline[(i + 1) % outline.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const points = area > 0 ? outline : [...outline].reverse();
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  // Dessus : contour ramené vers le centre (biseau d'épaisseur régulière à l'œil)
  const inner = points.map(([x, y]) => [cx + (x - cx) * (1 - bevel), cy + (y - cy) * (1 - bevel)]);
  const d = (pts) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z`;
  const facets = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    // Normale extérieure du bord (contour en sens horaire à l'écran) ; un biseau tourné vers la
    // lumière est clair (convention inverse des facettes d'étoile, qui partent du centre)
    const n = [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
    return `<path fill="${shade(lit([-n[0], -n[1]]) * 1.05 - 0.04, tint)}" d="${d([p, q, inner[(i + 1) % points.length], inner[i]])}"/>`;
  });
  return svgOpen(viewBox, ratio) +
    `<defs><linearGradient id="${id}-top" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${shade(0.97, tint)}"/><stop offset=".28" stop-color="${shade(0.7, tint)}"/>` +
    `<stop offset=".46" stop-color="${shade(0.2, tint)}"/><stop offset=".53" stop-color="${shade(0.05, tint)}"/>` +
    `<stop offset=".66" stop-color="${shade(0.58, tint)}"/><stop offset=".84" stop-color="${shade(0.95, tint)}"/>` +
    `<stop offset="1" stop-color="${shade(0.62, tint)}"/></linearGradient></defs>` +
    facets.join("") +
    `<path d="${d(inner)}" fill="url(#${id}-top)"/>` +
    `<path d="${d(inner)}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width=".8"/>` +
    `<path d="${d(points)}" fill="none" ${OUTLINE} stroke-width="1"/></svg>`;
}

/* Éclair : zigzag de la tekno, en pièce biseautée */
const BOLT = [[62, 4], [22, 70], [50, 70], [34, 136], [88, 54], [58, 54], [80, 4]];

/**
 * Planète chromée : sphère (ciel clair, horizon sombre, sol réfléchi) traversée par un anneau incliné,
 * dont la moitié arrière passe derrière la sphère.
 */
function planetSvg({ tint = "violet" }) {
  const id = nextId();
  const s = (t) => shade(t, tint);
  const ring = (half) => `<path d="M10 ${half === "back" ? "62A62 17 0 0 1 134 62" : "62A62 17 0 0 0 134 62"}" fill="none" ` +
    `stroke="url(#${id}-ring)" stroke-width="${half === "back" ? 6 : 7}" stroke-linecap="round" opacity="${half === "back" ? 0.8 : 1}"/>`;
  return svgOpen("0 0 144 124", 124 / 144) +
    `<defs>` +
    `<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${s(1)}"/><stop offset=".34" stop-color="${s(0.78)}"/><stop offset=".5" stop-color="${s(0.42)}"/>` +
    `<stop offset=".56" stop-color="${s(0.08)}"/><stop offset=".68" stop-color="${s(0.3)}"/><stop offset=".86" stop-color="${s(0.72)}"/>` +
    `<stop offset="1" stop-color="${s(0.5)}"/></linearGradient>` +
    `<radialGradient id="${id}-vol" cx=".38" cy=".34" r=".72">` +
    `<stop offset=".55" stop-color="#0b0722" stop-opacity="0"/><stop offset="1" stop-color="#0b0722" stop-opacity=".7"/></radialGradient>` +
    `<radialGradient id="${id}-spec" cx=".5" cy=".5" r=".5">` +
    `<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-ring" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${s(0.3)}"/><stop offset=".18" stop-color="${s(1)}"/><stop offset=".4" stop-color="${s(0.12)}"/>` +
    `<stop offset=".62" stop-color="${s(0.85)}"/><stop offset=".82" stop-color="${s(0.35)}"/><stop offset="1" stop-color="${s(0.95)}"/></linearGradient>` +
    `<clipPath id="${id}-clip"><circle cx="72" cy="62" r="40"/></clipPath></defs>` +
    `<g transform="rotate(-14 72 62)">${ring("back")}` +
    `<g clip-path="url(#${id}-clip)"><rect x="32" y="22" width="80" height="80" fill="url(#${id}-sky)"/>` +
    // Horizon courbé (reflet du sol) et volume de la sphère
    `<path d="M28 64Q72 50 116 64L116 72Q72 60 28 72Z" fill="${s(0.04)}" opacity=".55"/>` +
    `<circle cx="72" cy="62" r="40" fill="url(#${id}-vol)"/></g>` +
    `<circle cx="72" cy="62" r="40" fill="none" ${OUTLINE} stroke-width=".9"/>` +
    `<ellipse cx="58" cy="40" rx="13" ry="7" fill="url(#${id}-spec)" opacity=".9" transform="rotate(-28 58 40)"/>` +
    ring("front") +
    `<path d="M22 74A62 17 0 0 0 122 74" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/></g></svg>`;
}

/* Dégradés partagés des verres : cylindre (reflets verticaux), intérieur, rondelle de citron */
function glassDefs(id) {
  return `<linearGradient id="${id}-cyl" x1="0" x2="1" y1="0" y2="0">` +
    `<stop offset="0" stop-color="#2b2840"/><stop offset=".07" stop-color="#8d89a6"/><stop offset=".17" stop-color="#fff"/>` +
    `<stop offset=".27" stop-color="#d3d0e0"/><stop offset=".42" stop-color="#55516d"/><stop offset=".52" stop-color="#1a1727"/>` +
    `<stop offset=".64" stop-color="#7f7b98"/><stop offset=".8" stop-color="#f3f2f9"/><stop offset=".9" stop-color="#aeabc2"/>` +
    `<stop offset="1" stop-color="#36324c"/></linearGradient>` +
    `<linearGradient id="${id}-sky" x1="0" x2="0" y1="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset=".5" stop-color="#0d0b17" stop-opacity=".35"/><stop offset="1" stop-color="#0d0b17" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}-in" x1="0" x2="1" y1="0" y2="1">` +
    `<stop offset="0" stop-color="#1b1828"/><stop offset=".45" stop-color="#6f6b88"/><stop offset=".62" stop-color="#e9e7f3"/>` +
    `<stop offset="1" stop-color="#3d3953"/></linearGradient>` +
    `<radialGradient id="${id}-lemon" cx=".38" cy=".32" r=".75">` +
    `<stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#cfccdd"/><stop offset="1" stop-color="#4e4a66"/></radialGradient>`;
}

/* Rondelle de citron chromée : écorce, quartiers en relief, posée sur le bord du verre */
function lemon(id, cx, cy, r, rotate) {
  const segs = Array.from({ length: 8 }, (_, i) => {
    const a = i * 45, b = a + 45;
    const p = polar(a + 4, r * 0.78), q = polar(b - 4, r * 0.78);
    const s = polar(a + 22.5, r * 0.16);
    return `<path d="M${r2(s[0])} ${r2(s[1])}L${r2(p[0])} ${r2(p[1])}A${r2(r * 0.78)} ${r2(r * 0.78)} 0 0 1 ${r2(q[0])} ${r2(q[1])}Z"/>`;
  }).join("");
  return `<g transform="translate(${cx} ${cy}) rotate(${rotate}) scale(1 .92)">` +
    `<circle r="${r}" fill="url(#${id}-cyl)" ${OUTLINE} stroke-width=".7"/>` +
    `<circle r="${r2(r * 0.86)}" fill="#2a2740"/>` +
    `<g fill="url(#${id}-lemon)" stroke="#fff" stroke-opacity=".5" stroke-width=".35">${segs}</g>` +
    `<circle r="${r2(r * 0.12)}" fill="#e9e7f3"/>` +
    // Fente qui pince la rondelle sur le bord du verre
    `<path d="M0 ${r2(r * 0.15)}L0 ${r}" stroke="#0d0b17" stroke-opacity=".6" stroke-width="1.1"/></g>`;
}

/* Un verre (coordonnées du dessin d'ensemble) : « martini » (cône) ou « coupe » (évasée) */
function glass(id, kind) {
  const stroke = `${OUTLINE} stroke-width=".8"`;
  const stem = (x, y1, y2, w) => `<path d="M${x - w} ${y1}C${x - w * 0.55} ${(y1 + y2) / 2} ${x - w * 0.55} ${(y1 + y2) / 2} ${x - w * 0.7} ${y2}L${x + w * 0.7} ${y2}C${x + w * 0.55} ${(y1 + y2) / 2} ${x + w * 0.55} ${(y1 + y2) / 2} ${x + w} ${y1}Z" fill="url(#${id}-cyl)" ${stroke}/>`;
  const foot = (x, y, rx) => `<path d="M${x - rx} ${y}C${x - rx} ${y + 9} ${x + rx} ${y + 9} ${x + rx} ${y}C${x + rx * 0.6} ${y - 6} ${x - rx * 0.6} ${y - 6} ${x - rx} ${y}Z" fill="url(#${id}-cyl)" ${stroke}/>` +
    `<ellipse cx="${x}" cy="${y - 1.2}" rx="${r2(rx * 0.62)}" ry="2.6" fill="url(#${id}-in)" opacity=".85"/>`;
  if (kind === "coupe") {
    return stem(62, 70, 128, 4.2) + foot(62, 132, 30) +
      `<path d="M10 34C11 62 38 74 62 74S113 62 114 34Z" fill="url(#${id}-cyl)" ${stroke}/>` +
      `<path d="M10 34C11 62 38 74 62 74S113 62 114 34Z" fill="url(#${id}-sky)"/>` +
      `<ellipse cx="62" cy="34" rx="52" ry="9.5" fill="url(#${id}-in)" ${stroke}/>` +
      `<ellipse cx="62" cy="34" rx="52" ry="9.5" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".9"/>` +
      `<path d="M22 44C30 58 44 64 52 66" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/>` +
      lemon(id, 108, 24, 15, 18);
  }
  return stem(50, 74, 140, 3.4) + foot(50, 144, 27) +
    `<path d="M6 24L50 78L94 24Z" fill="url(#${id}-cyl)" ${stroke}/>` +
    `<path d="M6 24L50 78L94 24Z" fill="url(#${id}-sky)"/>` +
    `<ellipse cx="50" cy="24" rx="44" ry="7.5" fill="url(#${id}-in)" ${stroke}/>` +
    `<ellipse cx="50" cy="24" rx="44" ry="7.5" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".9"/>` +
    `<path d="M20 34L42 62" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/>` +
    lemon(id, 86, 18, 14, -14);
}

/* Deux verres qui trinquent : une seule composition (un martini, une coupe, inclinés l'un vers l'autre) */
function cocktailsSvg() {
  const id = nextId();
  return svgOpen("0 0 230 172", 172 / 230) + `<defs>${glassDefs(id)}</defs>` +
    `<g transform="translate(4 14) rotate(-9 50 80)">${glass(id, "martini")}</g>` +
    `<g transform="translate(96 30) rotate(8 62 75)">${glass(id, "coupe")}</g></svg>`;
}

/**
 * Catalogue des objets chromés : type -> { family, svg(options) | src, ratio }.
 *   family : silhouette (deux objets de la même famille ne se suivent pas, voir team-composition.js)
 *   svg    : dessin (options : { tint: "silver" | "violet" }, et points: 4 | 8 pour « sparkle »)
 *   src    : image détourée existante ; ratio : hauteur / largeur (réserve la place avant chargement)
 */
export const CHROME_OBJECTS = {
  sparkle: { family: "etoile", svg: ({ points = 8, tint = "silver" } = {}) => sparkleSvg({ ...SPARKLE[points === 4 ? 4 : 8], tint }) },
  bolt: { family: "eclair", svg: ({ tint = "violet" } = {}) => bevelSvg({ points: BOLT, bevel: 0.22, viewBox: "14 0 82 140", ratio: 140 / 82, tint }) },
  planet: { family: "planete", svg: ({ tint = "violet" } = {}) => planetSvg({ tint }) },
  cocktails: { family: "verre", svg: () => cocktailsSvg() },
  "star-pair": { family: "etoile", src: "assets/img/decor/star-pair.webp", ratio: 297 / 400 },
  "star-outline": { family: "etoile", src: "assets/img/decor/star-outline.webp", ratio: 298 / 400 },
  thorn: { family: "epine", src: "assets/img/decor/thorn.webp", ratio: 221 / 400 },
  chain: { family: "chaine", src: "assets/img/decor/chain.webp", ratio: 389 / 400 }
};

/** Balisage d'un objet dessiné, ou null si le type est une image (ou inconnu). */
export function chromeSvg(type, options) {
  return CHROME_OBJECTS[type]?.svg ? CHROME_OBJECTS[type].svg(options) : null;
}
