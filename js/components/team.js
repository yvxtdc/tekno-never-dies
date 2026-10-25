import { TEAM } from '../data/equipe.js';
import { t } from '../i18n/i18n.js';
import { track as trackClick } from '../pages/helpers.js';
import { cardComposition } from './team-composition.js';
import { chromeSvg, CHROME_OBJECTS } from './chrome.js';
import { missionIcon, missionIconSvg } from './mission-icons.js';

const carousel = document.querySelector('.team-carousel');
const track = document.querySelector('.team-track');

if (!carousel || !track) {
  throw new Error('Composant équipe introuvable.');
}


/* =========================================================
   CRÉATION DES CARTES
   La photo brute (CMS) + par-dessus, générés ici : pastilles
   (nom, rôle, missions, en texte) et objets chromés.
   Réglages de la mise en scène : team-composition.js.
========================================================= */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pill(text, kind, color) {
  return el('span', `team-pill team-pill--${kind} team-pill--${color}`, text);
}

// Médaillon chromé d'une mission : pictogramme dessiné (mission-icons.js). Le texte de la mission
// reste attaché (lecteurs d'écran, bulle au survol, fiche) ; label : false s'il est écrit à côté.
function missionBadge(mission, color, label = true) {
  const badge = el('span', `team-mission team-mission--${color}`);
  badge.dataset.icon = missionIcon(mission);
  // Dessin produit par mission-icons.js (aucune donnée saisie dans le balisage)
  badge.insertAdjacentHTML('beforeend', missionIconSvg(mission));
  if (label) {
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', mission);
    badge.title = mission;
  }
  return badge;
}

// Valeurs de position d'un objet (desktop, puis mobile si elles diffèrent)
function placeDecor(node, values, suffix) {
  const set = (name, value) => value != null && node.style.setProperty(`--${name}-${suffix}`, value);
  set('x', values.x);
  set('y', values.y);
  set('s', values.size);
  set('r', values.rotate != null ? `${values.rotate}deg` : null);
}

// Objet chromé (dessin SVG ou image détourée) ; null si le type est inconnu
function chromeObject(type, options) {
  const entry = CHROME_OBJECTS[type];
  if (!entry) return null;

  if (entry.svg) {
    const wrap = el('span');
    // Balisage produit par chrome.js à partir de la configuration (aucune donnée saisie)
    wrap.insertAdjacentHTML('beforeend', chromeSvg(type, options));
    return wrap.firstElementChild;
  }

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

function decor(object) {
  const shape = chromeObject(object.type, object.options);
  if (!shape) return null; // type inconnu : ignoré plutôt que de casser le bandeau (validate le signale)

  const node = el('span', [
    'team-decor',
    `team-decor--${object.anchor === 'end' ? 'end' : 'card'}`,
    `team-decor--${['back', 'between'].includes(object.layer) ? object.layer : 'front'}`,
    object.flip && 'team-decor--flip',
    object.mobile === false && 'team-decor--desktop-only'
  ].filter(Boolean).join(' '));
  node.dataset.decor = object.id || object.type;
  node.setAttribute('aria-hidden', 'true');

  placeDecor(node, { x: 0, y: 50, size: 20, rotate: 0, ...object }, 'd');
  if (object.mobile) placeDecor(node, object.mobile, 'm');

  shape.classList.add('team-decor__shape');
  node.append(shape);

  return node;
}

// clone : copie du carrousel infini, masquée aux lecteurs d'écran et sans identifiants
function slide(member, clone = false) {
  const { photo, badges, objects } = cardComposition(member);

  const li = el('li', 'team-slide');
  li.dataset.member = member.slug;
  if (clone) li.setAttribute('aria-hidden', 'true');

  const button = el('button', `team-card team-card--${badges.align}`);
  button.type = 'button';
  button.dataset.member = member.slug;
  button.setAttribute(
    'aria-label',
    t('Voir la fiche de {name}', { name: member.name })
  );
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

  // Nom en haut ; rôle sous le nom ou en bas avec les missions, selon la place laissée par la photo.
  // Du vrai texte (traduit, lisible par les lecteurs d'écran).
  const head = el('span', 'team-card__head');
  const foot = el('span', `team-card__foot team-card__foot--${badges.tagsAlign}`);
  const described = [];

  const name = el('span', 'team-card__line');
  name.append(pill(member.name, 'name', badges.nameColor));
  name.firstChild.translate = false;
  (badges.name === 'bottom' ? foot : head).append(name);

  if (member.role) {
    const role = el('span', 'team-card__line');
    role.append(pill(member.role, 'role', badges.roleColor));
    (badges.role === 'top' && badges.name !== 'bottom' ? head : foot).append(role);
    if (!clone) role.id = `team-role-${member.slug}`;
    described.push(role);
  }

  // Missions : un médaillon par mission, côte à côte (le texte est dans la fiche et au survol)
  const tags = el('span', 'team-card__missions');
  tags.append(...(member.tags || []).map(tag => missionBadge(tag, badges.tagsColor)));
  foot.append(tags);
  if (!clone) tags.id = `team-tags-${member.slug}`;
  described.push(tags);

  if (!clone) button.setAttribute('aria-describedby', described.map(node => node.id).join(' '));

  button.append(img, ...(head.childElementCount ? [head] : []), foot);
  li.append(button, ...objects.map(decor).filter(Boolean));

  return li;
}


const cards = TEAM.map(member => slide(member));

track.replaceChildren(...cards);


/* =========================================================
   DUPLICATION POUR LE CARROUSEL INFINI
   Copies reconstruites (et non clonées) : chaque objet SVG
   garde des identifiants de dégradés uniques.
========================================================= */

track.append(...TEAM.map(member => slide(member, true)));


/* =========================================================
   CONTRÔLE DE LA COMPOSITION (association.html?composition)
   Zones protégées et chevauchements, pour régler
   team-composition.js. Rien n'est chargé sans le paramètre.
========================================================= */

if (new URLSearchParams(location.search).has('composition')) {
  import('./team-composition-check.js').then(({ checkComposition }) => checkComposition(track));
}


/* =========================================================
   VARIABLES CARROUSEL
========================================================= */

let offset = 0;
let lastTime = performance.now();

let paused = false;
let dragging = false;

let startX = 0;
let startOffset = 0;
let dragged = false; // vrai si le doigt / la souris a vraiment bougé (ce n'est plus un clic)


/* =========================================================
   LARGEUR D'UN CYCLE
========================================================= */

// Distance entre une carte et sa copie : toutes les cartes et tous les espaces d'un cycle,
// y compris celui qui sépare la dernière carte de la première copie (sinon saut au bouclage).
function cycleWidth() {
  const first = track.children[0];
  const copy = track.children[track.children.length / 2];

  if (!first || !copy) return 0;

  return copy.offsetLeft - first.offsetLeft;
}


/* =========================================================
   NORMALISATION DU DÉFILEMENT
========================================================= */

function normalize() {
  const width = cycleWidth();

  if (!width) return;

  while (offset <= -width) {
    offset += width;
  }

  while (offset > 0) {
    offset -= width;
  }
}


/* =========================================================
   AFFICHAGE DU CARROUSEL
========================================================= */

function render() {
  track.style.transform =
    `translate3d(${offset}px, 0, 0)`;
}


/* =========================================================
   ANIMATION AUTOMATIQUE
========================================================= */

function animate(now) {
  const dt =
    Math.min(50, now - lastTime);

  lastTime = now;

  const reducedMotion =
    window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

  if (
    !paused &&
    !dragging &&
    !reducedMotion
  ) {
    offset -= dt * 0.035;

    normalize();
    render();
  }

  requestAnimationFrame(animate);
}


/* =========================================================
   SOURIS
========================================================= */

carousel.addEventListener(
  'mouseenter',
  () => {
    paused = true;
  }
);

carousel.addEventListener(
  'mouseleave',
  () => {
    if (!dragging) {
      paused = false;
    }
  }
);


/* =========================================================
   SOURIS / DOIGT : DÉBUT DU DÉPLACEMENT
========================================================= */

let captureTarget = null;

carousel.addEventListener(
  'pointerdown',
  (event) => {

    // Clic droit / molette : pas de défilement.
    if (event.button !== 0) return;

    dragging = true;
    paused = true;

    carousel.classList.add(
      'is-dragging'
    );

    const card =
      event.target.closest('button[data-member]');

    captureTarget = card || carousel;

    captureTarget.setPointerCapture(
      event.pointerId
    );

    startX = event.clientX;
    startOffset = offset;
    dragged = false;
  }
);


/* =========================================================
   SOURIS / DOIGT : DÉPLACEMENT
========================================================= */

carousel.addEventListener(
  'pointermove',
  (event) => {

    if (!dragging) return;

    if (Math.abs(event.clientX - startX) > 6) dragged = true;

    offset =
      startOffset +
      (event.clientX - startX);

    normalize();
    render();
  }
);


/* =========================================================
   FIN DU DÉPLACEMENT
========================================================= */

function endDrag(event) {

  if (!dragging) return;

  dragging = false;

  carousel.classList.remove(
    'is-dragging'
  );

  paused =
    carousel.matches(':hover');

  try {
    if (
      captureTarget &&
      captureTarget.hasPointerCapture(event.pointerId)
    ) {
      captureTarget.releasePointerCapture(
        event.pointerId
      );
    }
  } catch (_) {}

  captureTarget = null;
}


carousel.addEventListener(
  'pointerup',
  endDrag
);

carousel.addEventListener(
  'pointercancel',
  endDrag
);


/* =========================================================
   MODALE
========================================================= */

const modal =
  document.querySelector('#team-modal');

const modalImg =
  document.querySelector('#team-modal-img');

const modalName =
  document.querySelector('#team-modal-name');

const modalRole =
  document.querySelector('#team-modal-role');

const modalTags =
  document.querySelector('#team-modal-tags');

const modalExtra =
  document.querySelector('#team-modal-extra');

const modalBio =
  document.querySelector('#team-modal-bio');

const modalPole =
  document.querySelector('#team-modal-pole');

const modalMood =
  document.querySelector('#team-modal-mood');

const modalDecor =
  document.querySelector('#team-modal-decor');

const modalCount =
  document.querySelector('#team-modal-count');

const modalTagsLabel =
  document.querySelector('#team-modal-tags-label');

let lastFocused = null;
let current = -1;
let closeTimer = null;

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;


if (
  !modal ||
  !modalImg ||
  !modalName ||
  !modalRole ||
  !modalTags ||
  !modalExtra
) {
  throw new Error(
    'La fenêtre modale de l’équipe est incomplète.'
  );
}


/* =========================================================
   CONTENU DE LA FICHE
   Mêmes informations qu'avant (photo, nom, rôle, bio,
   missions, détails), mises en scène avec la composition
   de la carte : couleurs des missions, objet chromé.
========================================================= */

function fillModal(member) {

  const { photo, badges, objects } = cardComposition(member);

  modalImg.src = member.photo;
  modalImg.alt = member.name;
  modalImg.style.objectPosition = photo.position;

  // Ambiance : la photo elle-même, très floutée, derrière la fiche
  if (modalMood) {
    modalMood.style.backgroundImage = `url("${encodeURI(member.photo)}")`;
  }

  modalName.textContent = member.name;
  modalRole.textContent = member.role || '';
  modalRole.hidden = !member.role;

  if (modalBio) {
    modalBio.textContent = member.bio || '';
    modalBio.hidden = !member.bio;
  }

  if (modalPole) {
    modalPole.textContent = member.extra?.['Pôle'] || '';
    modalPole.hidden = !modalPole.textContent;
  }


  /* -------------------------
     MISSIONS
  ------------------------- */

  // Chaque médaillon de la carte, avec le texte de sa mission
  modalTags.replaceChildren(
    ...(member.tags || []).map(tag => {
      const item = el('li', 'team-modal-mission');
      item.append(missionBadge(tag, badges.tagsColor, false), el('span', null, tag));
      return item;
    })
  );

  modalTags.hidden = !modalTags.children.length;
  if (modalTagsLabel) modalTagsLabel.hidden = modalTags.hidden;


  /* -------------------------
     INFORMATIONS
  ------------------------- */

  modalExtra.replaceChildren(
    ...Object.entries(
      member.extra || {}
    ).map(([key, value]) => {

      const wrap =
        document.createElement('div');

      const dt =
        document.createElement('dt');

      const dd =
        document.createElement('dd');

      dt.textContent = key;
      dd.textContent = value;

      wrap.append(dt, dd);

      return wrap;
    })
  );


  /* -------------------------
     OBJET CHROMÉ
     Celui de la carte, sinon une étincelle violette.
  ------------------------- */

  if (modalDecor) {
    const object = objects[0] || { type: 'sparkle', options: { points: 4, tint: 'violet' } };
    const shape = chromeObject(object.type, object.options);
    modalDecor.dataset.type = object.type;
    modalDecor.replaceChildren(...(shape ? [shape] : []));
  }

  if (modalCount) {
    modalCount.textContent = `${current + 1} / ${TEAM.length}`;
  }
}


/* =========================================================
   OUVERTURE DE LA FICHE
========================================================= */

function openModal(index, trigger) {

  const member = TEAM[index];
  if (!member) return;

  clearTimeout(closeTimer);
  modal.classList.remove('is-closing');

  lastFocused = trigger;
  current = index;
  trackClick(`Équipe · ${member.name}`);

  fillModal(member);


  /* -------------------------
     AFFICHER LA MODALE
  ------------------------- */

  modal.hidden = false;

  document.body.style.overflow =
    'hidden';

  modal.querySelector('.team-modal-close')?.focus();
}


/* =========================================================
   MEMBRE PRÉCÉDENT / SUIVANT
========================================================= */

function step(delta) {

  if (TEAM.length < 2) return;

  current = (current + delta + TEAM.length) % TEAM.length;
  trackClick(`Équipe · ${TEAM[current].name}`);
  fillModal(TEAM[current]);

  // Courte transition de contenu (relancée à chaque changement)
  const card = modal.querySelector('.team-modal-card');
  card?.classList.remove('is-swapping');
  void card?.offsetWidth;
  card?.classList.add('is-swapping');
}

modal.querySelectorAll('[data-step]').forEach(button => {
  button.hidden = TEAM.length < 2;
  button.addEventListener('click', () => step(Number(button.dataset.step)));
});


/* =========================================================
   FERMETURE DE LA FICHE
   Courte sortie animée, sauf si le système limite les
   animations.
========================================================= */

function closeModal() {

  if (modal.hidden || modal.classList.contains('is-closing')) return;

  const done = () => {
    modal.classList.remove('is-closing');
    modal.hidden = true;
    document.body.style.overflow = '';
    lastFocused?.focus();
  };

  if (reducedMotion()) {
    done();
    return;
  }

  modal.classList.add('is-closing');
  closeTimer = setTimeout(done, 180);
}


/* =========================================================
   CLIC SUR UNE CARTE
========================================================= */

track.addEventListener(
  'click',
  (event) => {

    const button =
      event.target.closest(
        'button[data-member]'
      );

    if (!button) return;

    // Fin d'un glisser sur une carte : on ne l'ouvre pas.
    if (dragged && event.detail !== 0) {
      dragged = false;
      return;
    }

    const index =
      TEAM.findIndex(
        item =>
          item.slug ===
          button.dataset.member
      );


    if (index >= 0) {
      openModal(index, button);
    }
  }
);


/* =========================================================
   FERMETURE PAR LE FOND / BOUTON
========================================================= */

document
  .querySelectorAll('[data-close]')
  .forEach(element => {

    element.addEventListener(
      'click',
      closeModal
    );
  });


/* =========================================================
   CLAVIER : ESC, FLÈCHES, TABULATION
========================================================= */

document.addEventListener(
  'keydown',
  event => {

    if (modal.hidden) return;

    if (event.key === 'Escape') {
      closeModal();
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      step(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = [...modal.querySelectorAll(focusableSelector)]
      .filter(node => !node.hidden);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
);


/* =========================================================
   LANCEMENT
========================================================= */

requestAnimationFrame(animate);