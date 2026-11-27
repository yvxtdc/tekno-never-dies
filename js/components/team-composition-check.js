/**
 * Contrôle visuel de la composition du bandeau « L'équipe » : association.html?composition
 * (chargé seulement avec ce paramètre, par js/components/team.js).
 *
 * Sur chaque carte : en rouge, les pastilles (nom, rôle, missions) cachées par un objet chromé, y compris
 * celui d'une carte voisine ; puis les remarques de compositionIssues (team-composition.js). La liste est
 * affichée dans la console et gardée dans window.__teamComposition (issues). Recalculé au
 * redimensionnement : à vérifier en mobile et desktop. Les objets SVG sont testés selon leur forme
 * exacte ; les images détourées selon leur transparence. Ce qui est sur la photo (visages…) se juge à
 * l'œil, dans la mise en page du CMS.
 */
import { TEAM } from '../data/equipe.js';
import { compositionIssues } from './team-composition.js';

const STEP = 4; // pas d'échantillonnage des zones, en pixels
// Texte d'une pastille ou d'un pictogramme de mission
const label = (node) => node.getAttribute('aria-label') || node.textContent;

function mark(slide, rect, color, label) {
  const origin = slide.getBoundingClientRect();
  const box = document.createElement('span');
  box.className = 'team-check';
  box.title = label;
  box.style.cssText = `position:absolute;z-index:9;pointer-events:none;left:${rect.left - origin.left}px;top:${rect.top - origin.top}px;` +
    `width:${rect.width}px;height:${rect.height}px;outline:2px solid ${color};background:${color}33`;
  slide.append(box);
}

// Opacité d'une image détourée en un point de l'écran : on défait la rotation (et le miroir) de l'objet
const alphaCache = new Map();
function opaqueAt(img, x, y) {
  let data = alphaCache.get(img.currentSrc);
  if (!data) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    alphaCache.set(img.currentSrc, data);
  }
  const decor = img.closest('.team-decor');
  const box = decor.getBoundingClientRect(); // la rotation se fait autour du centre : même centre
  const angle = (parseFloat(getComputedStyle(decor).getPropertyValue('--r')) || 0) * Math.PI / 180;
  const dx = x - (box.left + box.width / 2), dy = y - (box.top + box.height / 2);
  let lx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
  const ly = dx * Math.sin(-angle) + dy * Math.cos(-angle);
  if (decor.classList.contains('team-decor--flip')) lx = -lx;
  const px = Math.floor((lx / img.offsetWidth + 0.5) * data.width);
  const py = Math.floor((ly / img.offsetHeight + 0.5) * data.height);
  if (px < 0 || py < 0 || px >= data.width || py >= data.height) return false;
  return data.data[(py * data.width + px) * 4 + 3] > 40;
}

// Objets chromés qui couvrent une zone : formes SVG exactes (le test de clic suit les tracés),
// images détourées selon leur transparence
function decorHits(zone) {
  const hits = new Set();
  for (let y = zone.top + STEP / 2; y < zone.bottom; y += STEP) {
    for (let x = zone.left + STEP / 2; x < zone.right; x += STEP) {
      for (const node of document.elementsFromPoint(x, y)) {
        const decor = node.closest('.team-decor');
        if (!decor) continue;
        if (node.tagName !== 'IMG' || opaqueAt(node, x, y)) hits.add(decor);
      }
    }
  }
  return hits;
}

export async function checkComposition(track) {
  await document.fonts?.ready;
  const run = () => {
    document.querySelectorAll('.team-check').forEach((node) => node.remove());
    // Le test des objets (elementsFromPoint) ne voit que ce qui est à l'écran : bandeau recentré
    track.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
    document.documentElement.classList.add('team-checking'); // objets testables au pointeur (team.css)
    const issues = [];
    const visible = [...track.children].filter((li) => {
      const r = li.getBoundingClientRect();
      return r.right > 0 && r.left < innerWidth;
    });
    for (const li of visible) {
      const slug = li.dataset.member;
      // Les objets chromés ne doivent pas non plus cacher les pastilles (y compris celles des cartes voisines)
      for (const piece of li.querySelectorAll('.team-pill, .team-mission')) {
        for (const part of piece.getClientRects()) {
          for (const decor of decorHits(part)) {
            mark(li, part, '#ff3d5a', `${slug} : objet ${decor.dataset.decor} sur « ${label(piece)} »`);
            issues.push(`${slug} : l'objet « ${decor.dataset.decor} » recouvre la pastille « ${label(piece)} »`);
          }
        }
      }
    }
    document.documentElement.classList.remove('team-checking');
    issues.push(...compositionIssues(TEAM));
    const unique = [...new Set(issues)];
    window.__teamComposition = { width: innerWidth, issues: unique };
    if (unique.length) console.warn(`Composition de l'équipe (${innerWidth} px) :\n- ${unique.join('\n- ')}`);
    else console.info(`Composition de l'équipe (${innerWidth} px) : aucun chevauchement.`);
    return unique;
  };
  let timer;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  return run();
}
