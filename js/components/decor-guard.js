/**
 * Décors chromés (étoiles, éclats, chaîne… : .decor, .nf-item, .home-next__chrome) : jamais sur le texte.
 *
 * Ils sont placés en CSS par rapport à leur section (en pourcentage, en vw) alors que la largeur du
 * texte, elle, dépend de la police et des retours à la ligne : selon la taille de la fenêtre, un
 * décor pouvait se retrouver derrière un titre ou un bouton et gêner la lecture.
 * À chaque changement de taille, on mesure la position de repos de chaque décor (sans ses
 * animations) et, s'il touche du texte :
 *   1. il est décalé vers son bord (droite pour un décor de droite, gauche pour un décor de gauche),
 *      sans sortir de plus d'un tiers de l'écran ;
 *   2. sinon il est aussi réduit (jusqu'à 60 %) ;
 *   3. sinon (vraiment pas de place) il est masqué.
 * La correction passe par les propriétés CSS translate / scale, qui s'ajoutent aux animations.
 */
const SELECTOR = ".decor, .nf-item, .home-next__chrome";
// Textes qui ne comptent pas : en-tête et menu fixes, bandeau de langue, éléments décoratifs.
const IGNORE = ".top, .tnd-menu, .lang-suggest, [aria-hidden='true'], script, style, noscript, template";
const INSET = 0.12; // marge transparente autour du dessin dans l'image (≈ 12 % de chaque côté)
const PAD = 8; // espace minimal entre décor et texte (px)

/** Position de repos dans la page : boîte de mise en page, sans transform ni animation. */
function restRect(el) {
  let x = 0, y = 0, node = el;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  const w = el.offsetWidth, h = el.offsetHeight;
  return { l: x + w * INSET, t: y + h * INSET, r: x + w * (1 - INSET), b: y + h * (1 - INSET), w, h, x, y };
}

/** Lignes de texte visibles proches du décor, en coordonnées de page. */
function textBoxes(scope, zone) {
  const boxes = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim()) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(IGNORE)) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      const box = { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY };
      if (box.b < zone.t || box.t > zone.b) continue;
      boxes.push(box);
    }
  }
  // Boutons et champs : toute leur surface compte, pas seulement le texte.
  for (const el of scope.querySelectorAll(".btn, button, input, select, textarea")) {
    if (el.closest(IGNORE)) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) boxes.push({ l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY });
  }
  return boxes;
}

const hits = (a, boxes) => boxes.some((b) => a.l < b.r + PAD && a.r > b.l - PAD && a.t < b.b + PAD && a.b > b.t - PAD);

function place(el) {
  el.style.translate = "";
  el.style.scale = "";
  el.classList.remove("is-decor-hidden");
  if (!el.offsetWidth || getComputedStyle(el).display === "none") return;
  const rest = restRect(el);
  const scope = el.closest("section, header, main, .nf-stage") || document.body;
  const boxes = textBoxes(scope, { t: rest.y - 40, b: rest.y + rest.h + 40 });
  if (!hits(rest, boxes)) return;

  const vw = document.documentElement.clientWidth;
  const toRight = rest.x + rest.w / 2 > vw / 2;
  const maxOut = rest.w / 3; // part du décor qui peut sortir de l'écran
  for (const scale of [1, 0.8, 0.6]) {
    const sw = (rest.r - rest.l) * scale, sh = (rest.b - rest.t) * scale;
    const cx = (rest.l + rest.r) / 2, cy = (rest.t + rest.b) / 2;
    for (let shift = 0; shift <= vw; shift += 8) {
      const dx = toRight ? shift : -shift;
      const box = { l: cx - sw / 2 + dx, r: cx + sw / 2 + dx, t: cy - sh / 2, b: cy + sh / 2 };
      if (box.r > vw + maxOut || box.l < -maxOut) break;
      if (!hits(box, boxes)) {
        if (dx) el.style.translate = `${dx}px 0`;
        if (scale !== 1) el.style.scale = String(scale);
        return;
      }
    }
  }
  el.classList.add("is-decor-hidden");
}

export function guardDecor() {
  const items = [...document.querySelectorAll(SELECTOR)];
  if (!items.length) return;
  let frame = 0;
  const run = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => items.forEach(place));
  };
  run();
  addEventListener("load", run);
  document.fonts?.ready.then(run);
  // Largeur de la fenêtre, et contenu ajouté par les scripts des pages (hauteur du document).
  let last = "";
  new ResizeObserver(() => {
    const key = `${document.documentElement.clientWidth}x${document.body.scrollHeight}`;
    if (key !== last) {
      last = key;
      run();
    }
  }).observe(document.body);
}
