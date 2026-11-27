/**
 * Rendu d'une carte du bandeau « L'équipe » : photo, groupes de pastilles (nom, rôle, missions) et objets
 * chromés, placés selon la mise en page (team-layout.js). Seul code de rendu des cartes : utilisé par le
 * bandeau du site (team.js) et destiné à l'éditeur de mise en page du CMS, pour que l'aperçu soit
 * exactement la carte publiée. Styles : css/components/team.css.
 *
 * Aucun accès au DOM au chargement (module chargeable sous Node) : seules les fonctions appelées en ont
 * besoin. Aucun balisage injecté : les dessins SVG (chrome.js, mission-icons.js, produits par le code
 * à partir de réglages contrôlés) sont lus par DOMParser puis repris élément par élément, d'après une
 * liste blanche (SVG_ELEMENTS, SVG_ATTRIBUTES) ; tout le texte passe par textContent.
 *
 * Repères pour l'éditeur (sans effet sur le site) : data-group (rang du groupe dans layout.groups),
 * data-item (name, role, missions), data-decor (identifiant de l'objet).
 */
import { CHROME_OBJECTS, chromeSvg } from './chrome.js';
import { missionIcon, missionIconSvg } from './mission-icons.js';
import { groupWidth } from './team-layout.js';
import { cardComposition } from './team-composition.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Éléments et attributs repris des dessins SVG ; le reste est ignoré (contrôlé par les tests du CMS). */
export const SVG_ELEMENTS = new Set([
  'svg', 'defs', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath'
]);
export const SVG_ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'aria-hidden', 'focusable', 'id', 'transform', 'd', 'points',
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy', 'offset',
  'gradientUnits', 'gradientTransform', 'clip-path', 'fill', 'fill-rule', 'clip-rule', 'opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
  'stop-color', 'stop-opacity'
]);

/** Élément SVG construit à partir d'un dessin produit par le code ; null si le balisage est illisible. */
export function svgNode(markup) {
  if (!markup) return null;
  // Espace de noms SVG ajouté s'il n'est pas déclaré (les dessins du site ne le déclarent pas)
  const source = /^<svg\b[^>]*\bxmlns=/.test(markup) ? markup : markup.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`);
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const copy = (source) => {
    if (source.namespaceURI !== SVG_NS || !SVG_ELEMENTS.has(source.localName)) return null;
    const node = document.createElementNS(SVG_NS, source.localName);
    for (const { name, value } of source.attributes) {
      // url(#…) : seules les références internes au dessin (dégradés, découpes)
      if (SVG_ATTRIBUTES.has(name) && (!/url\(/i.test(value) || /^url\(#[\w-]+\)$/.test(value))) node.setAttribute(name, value);
    }
    for (const child of source.children) {
      const part = copy(child);
      if (part) node.append(part);
    }
    return node;
  };
  return parsed.querySelector('parsererror') ? null : copy(parsed.documentElement);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pill(text, kind, color) {
  return el('span', `team-pill team-pill--${kind} team-pill--${color}`, text);
}

/**
 * Médaillon chromé d'une mission : pictogramme dessiné (mission-icons.js). Le texte de la mission reste
 * attaché (lecteurs d'écran, bulle au survol, fiche) ; label : false s'il est écrit à côté.
 */
export function missionBadge(mission, color, label = true) {
  const badge = el('span', `team-mission team-mission--${color}`);
  badge.dataset.icon = missionIcon(mission);
  const icon = svgNode(missionIconSvg(mission));
  if (icon) badge.append(icon);
  if (label) {
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', mission);
    badge.title = mission;
  }
  return badge;
}

/** Objet chromé (dessin SVG ou image détourée) ; null si le type est inconnu. */
export function chromeObject(type, options) {
  const entry = CHROME_OBJECTS[type];
  if (!entry) return null;

  if (entry.svg) return svgNode(chromeSvg(type, options));

  const img = el('img');
  img.src = entry.src;
  img.alt = '';
  img.width = 400;
  img.height = Math.round(400 * entry.ratio); // place réservée avant chargement
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

/** Objet chromé posé sur la carte ; null si le type est inconnu (ignoré plutôt que de casser le bandeau). */
export function decor(object) {
  const shape = chromeObject(object.type, object.options);
  if (!shape) return null;

  const node = el('span', [
    'team-decor',
    `team-decor--${object.anchor === 'end' ? 'end' : 'card'}`,
    `team-decor--${['back', 'between'].includes(object.layer) ? object.layer : 'front'}`,
    object.flip && 'team-decor--flip',
    object.hideMobile && 'team-decor--desktop-only'
  ].filter(Boolean).join(' '));
  node.dataset.decor = object.id || object.type;
  node.setAttribute('aria-hidden', 'true');

  // Une seule mise en page pour mobile et ordinateur (valeurs en % de la carte)
  node.style.setProperty('--x', object.x);
  node.style.setProperty('--y', object.y);
  node.style.setProperty('--s', object.size);
  node.style.setProperty('--r', `${object.rotate}deg`);

  shape.classList.add('team-decor__shape');
  node.append(shape);

  return node;
}

/**
 * Diapositive d'un membre (<li> : la carte et ses objets), membre au format de js/data/equipe.js.
 *   layout : mise en page à appliquer (par défaut celle du membre, team-composition.js)
 *   label  : libellé accessible du bouton (texte traduit par la page ; par défaut le nom)
 *   clone  : copie du carrousel infini, masquée aux lecteurs d'écran et sans identifiants
 */
export function teamSlide(member, { layout = cardComposition(member), label = member.name, clone = false } = {}) {
  const { photo, groups, colors, objects } = layout;

  const li = el('li', 'team-slide');
  li.dataset.member = member.slug;
  if (clone) li.setAttribute('aria-hidden', 'true');

  const button = el('button', 'team-card');
  button.type = 'button';
  button.dataset.member = member.slug;
  button.setAttribute('aria-label', label);
  if (clone) button.tabIndex = -1;

  const img = el('img', 'team-card__photo');
  img.src = member.photo;
  img.alt = ''; // le nom est déjà dans le libellé du bouton
  img.width = 720;
  img.height = 900;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false; // sinon le navigateur « attrape » la photo au lieu de faire défiler
  img.style.objectPosition = photo.position;

  // Pastilles : du vrai texte (traduit, lisible par les lecteurs d'écran), réparti dans les groupes
  // de la mise en page. Ordre de lecture : nom, rôle, missions.
  const parts = {};
  const described = [];

  parts.name = el('span', 'team-card__line');
  parts.name.append(pill(member.name, 'name', colors.name));
  parts.name.firstChild.translate = false;

  if (member.role) {
    parts.role = el('span', 'team-card__line');
    parts.role.append(pill(member.role, 'role', colors.role));
    if (!clone) parts.role.id = `team-role-${member.slug}`;
    described.push(parts.role);
  }

  // Missions : un médaillon par mission, côte à côte (le texte est dans la fiche et au survol)
  parts.missions = el('span', 'team-card__missions');
  parts.missions.append(...(member.tags || []).map(tag => missionBadge(tag, colors.missions)));
  if (!clone) parts.missions.id = `team-tags-${member.slug}`;
  described.push(parts.missions);

  for (const [item, node] of Object.entries(parts)) node.dataset.item = item;
  if (!clone) button.setAttribute('aria-describedby', described.map(node => node.id).join(' '));

  // Groupe : ancré en (x, y) % de la carte, s'étend à l'opposé de son ancrage (texte plus long)
  const blocks = groups.map((group, index) => {
    const block = el('span', `team-card__group team-card__group--${group.valign} team-card__group--${group.align}`);
    block.dataset.group = index;
    block.style.setProperty('--gx', group.x);
    block.style.setProperty('--gy', group.y);
    block.style.setProperty('--gw', groupWidth(group));
    block.append(...group.items.map(item => parts[item]).filter(Boolean));
    return block;
  }).filter(block => block.childElementCount);

  button.append(img, ...blocks);
  li.append(button, ...objects.map(decor).filter(Boolean));

  return li;
}
