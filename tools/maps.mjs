// Dessine les plans des lieux des soirées : assets/img/maps/<slug>-village.svg et <slug>-lieu.svg
//
//   npm run plans              crée les plans manquants (ceux qui existent déjà sont gardés)
//   npm run plans -- --force   les refait tous
//
// Données : OpenStreetMap (© les contributeurs d'OpenStreetMap, licence ODbL), téléchargées une seule
// fois par l'API d'OpenStreetMap et gardées dans import/osm-cache/ (hors du dépôt). Le site n'appelle
// ensuite aucun service de carte : les plans sont de simples images, sans traceur ni cookie.
//
// Pour chaque soirée qui a un "venue" dans js/data/events.js ({ lat, lon }) :
//   - plan du village : environ 2,5 km de large (venue.span pour changer), centré sur le lieu ;
//   - plan du lieu : environ 600 m de large, zoomé sur la salle (seulement si venue.precise !== false).
// Le lieu est toujours au centre exact du plan : la fiche y pose son repère (css/pages.css).
// Style minimaliste aux couleurs du site : routes lavande, bâtiments et eau en voile léger.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets/img/maps");
const CACHE = path.join(ROOT, "import/osm-cache");
const force = process.argv.includes("--force");
const UA = "tekno-never-dies-site-tools/1.0 (+https://teknoneverdies.fr)";
const W = 1200, H = 760; // proportions des plans (≈ 1,58)

const { EVENTS } = await import(pathToFileURL(path.join(ROOT, "js/data/events.js")).href);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

/* ---------- Téléchargement (API OpenStreetMap, petites zones, une requête à la fois) ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchOsm([west, south, east, north]) {
  const key = [west, south, east, north].map((n) => n.toFixed(5)).join("_");
  const file = path.join(CACHE, `${key}.osm`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${west},${south},${east},${north}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 400) {
    // Trop de données pour une requête : la zone est découpée en quatre
    const mx = (west + east) / 2, my = (south + north) / 2;
    const parts = [];
    for (const box of [[west, south, mx, my], [mx, south, east, my], [west, my, mx, north], [mx, my, east, north]]) {
      parts.push(await fetchOsm(box));
    }
    return parts.join("\n");
  }
  if (!res.ok) throw new Error(`OpenStreetMap : ${res.status} pour ${url}`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  await sleep(1200); // politesse envers le service
  return text;
}

/* ---------- Lecture du XML OSM (nœuds, chemins, étiquettes) ---------- */
function parseOsm(xml) {
  const nodes = new Map();
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [Number(m[3]), Number(m[2])]);
  const ways = new Map();
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((r) => r[1]);
    const tags = Object.fromEntries([...m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)].map((t) => [t[1], t[2]]));
    ways.set(m[1], { refs, tags });
  }
  return { nodes, ways };
}

/* ---------- Dessin ---------- */
const ROADS = [
  // [types, épaisseur (plan du village), opacité]
  [/^(motorway|trunk|primary)(_link)?$/, 5, 0.95],
  [/^secondary(_link)?$/, 4, 0.85],
  [/^tertiary(_link)?$/, 3.2, 0.75],
  [/^(residential|unclassified|living_street|road)$/, 2.2, 0.55],
  [/^(service|pedestrian)$/, 1.3, 0.35],
  [/^(track|path|footway|cycleway|bridleway|steps)$/, 1, 0.22]
];

function render(osm, { lat, lon, spanKm, zoom }) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180); // mètres par degré de longitude
  const ky = 110574;
  const scale = W / (spanKm * 1000); // pixels par mètre
  const project = ([x, y]) => [(x - lon) * kx * scale + W / 2, H / 2 - (y - lat) * ky * scale];
  const inside = ([x, y]) => x > -W * 0.3 && x < W * 1.3 && y > -H * 0.3 && y < H * 1.3;
  // Plan du village : coordonnées au pixel près et bâtiments minuscules ignorés (fichier plus léger)
  const fmt = zoom ? (n) => (Math.round(n * 10) / 10).toString() : (n) => Math.round(n).toString();
  const pathOf = (refs, close, minSize = 0) => {
    const pts = refs.map((r) => osm.nodes.get(r)).filter(Boolean).map(project);
    if (pts.length < 2 || !pts.some(inside)) return "";
    if (minSize) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      if (Math.max(...xs) - Math.min(...xs) < minSize && Math.max(...ys) - Math.min(...ys) < minSize) return "";
    }
    return "M" + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") + (close ? "Z" : "");
  };
  const widthFactor = zoom ? 2.6 : 1;

  const water = [], waterLines = [], green = [], buildings = [], rail = [];
  const roads = ROADS.map(() => []);
  for (const { refs, tags } of osm.ways.values()) {
    const closed = refs.length > 3 && refs[0] === refs[refs.length - 1];
    if (tags.building && closed) buildings.push(pathOf(refs, true, zoom ? 0 : 2.5));
    else if (closed && (tags.natural === "water" || tags.waterway === "riverbank" || /^(reservoir|basin)$/.test(tags.landuse || ""))) water.push(pathOf(refs, true));
    else if (/^(river|canal|stream)$/.test(tags.waterway || "")) waterLines.push([pathOf(refs, false), tags.waterway === "stream" ? 1.6 : 4]);
    else if (closed && (tags.landuse === "forest" || tags.natural === "wood" || tags.leisure === "park")) green.push(pathOf(refs, true));
    else if (tags.railway === "rail") rail.push(pathOf(refs, false));
    else if (tags.highway) {
      const i = ROADS.findIndex(([re]) => re.test(tags.highway));
      if (i >= 0) roads[i].push(pathOf(refs, false));
    }
  }
  const join = (list) => list.filter(Boolean).join("");
  const layers = [
    `<path d="${join(green)}" fill="#956aff" fill-opacity=".07"/>`,
    `<path d="${join(water)}" fill="#269ab6" fill-opacity=".22"/>`,
    ...waterLines.filter(([d]) => d).map(([d, w]) => `<path d="${d}" fill="none" stroke="#269ab6" stroke-opacity=".5" stroke-width="${w * widthFactor}" stroke-linecap="round" stroke-linejoin="round"/>`),
    `<path d="${join(buildings)}" fill="#c1b1ff" fill-opacity="${zoom ? ".16" : ".13"}"/>`,
    `<path d="${join(rail)}" fill="none" stroke="#c1b1ff" stroke-opacity=".35" stroke-width="${1.6 * widthFactor}" stroke-dasharray="${6 * widthFactor} ${5 * widthFactor}"/>`,
    ...roads.map((list, i) => {
      const [, width, opacity] = ROADS[i];
      const d = join(list);
      return d ? `<path d="${d}" fill="none" stroke="#c1b1ff" stroke-opacity="${opacity}" stroke-width="${fmt(width * widthFactor)}" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    }).reverse()
  ].filter((l) => !/d=""/.test(l));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<!-- Plan généré par tools/maps.mjs — données © les contributeurs d'OpenStreetMap (ODbL) -->
${layers.join("\n")}
</svg>
`;
}

/* ---------- Pour chaque soirée ---------- */
let made = 0;
for (const ev of EVENTS.filter((e) => e.venue)) {
  const { lat, lon, precise = true, span = 2.5 } = ev.venue;
  const plans = [["village", span, false], ...(precise ? [["lieu", 0.6, true]] : [])];
  for (const [kind, spanKm, zoom] of plans) {
    const file = path.join(OUT, `${ev.slug}-${kind}.svg`);
    if (fs.existsSync(file) && !force) continue;
    // Zone à télécharger : le plan et une petite marge
    const halfX = ((spanKm * 1000) / 2) * 1.15 / (111320 * Math.cos((lat * Math.PI) / 180));
    const halfY = ((spanKm * 1000 * H) / W / 2) * 1.15 / 110574;
    const osm = parseOsm(await fetchOsm([lon - halfX, lat - halfY, lon + halfX, lat + halfY]));
    fs.writeFileSync(file, render(osm, { lat, lon, spanKm, zoom }));
    console.log(`✓ ${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} Ko)`);
    made++;
  }
}
console.log(made ? `${made} plan(s) créé(s).` : "Plans à jour (npm run plans -- --force pour les refaire).");
