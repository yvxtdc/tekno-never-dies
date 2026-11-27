/**
 * Équipe de la page Association (association.html, qui charge ce module directement) : cartes des
 * membres construites depuis js/data/equipe.js, carrousel infini (défilement automatique, glisser à la
 * souris ou au doigt) et fiche détaillée en fenêtre (#team-modal). Rendu d'une carte : team-card.js
 * (partagé avec le CMS) ; mise en page : team-composition.js et team-layout.js ; objets chromés :
 * chrome.js ; styles : css/components/team.css.
 * Contrairement aux autres modules de js/components/, celui-ci agit dès son chargement (DOM requis) :
 * il n'est importé ni par les outils Node ni par le CMS.
 */
import { TEAM } from '../data/equipe.js';
import { t } from '../i18n/i18n.js';
import { track as trackClick } from '../pages/helpers.js';
import { cardComposition } from './team-composition.js';
import { teamSlide, missionBadge, chromeObject } from './team-card.js';

const carousel = document.querySelector('.team-carousel');
const track = document.querySelector('.team-track');

if (!carousel || !track) {
  throw new Error('Composant équipe introuvable.');
}


/* =========================================================
   CRÉATION DES CARTES
   Rendu partagé avec l'éditeur de mise en page du CMS :
   team-card.js (photo, pastilles, objets chromés).
========================================================= */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// clone : copie du carrousel infini, masquée aux lecteurs d'écran et sans identifiants
const slide = (member, clone = false) => teamSlide(member, {
  label: t('Voir la fiche de {name}', { name: member.name }),
  clone
});


const cards = TEAM.map(member => slide(member));

track.replaceChildren(...cards);


/* =========================================================
   DUPLICATION POUR LE CARROUSEL INFINI
   Copies reconstruites (et non clonées) : chaque objet SVG
   garde des identifiants de dégradés uniques.
========================================================= */

track.append(...TEAM.map(member => slide(member, true)));


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

// La piste contient chaque carte deux fois : le décalage est ramené dans ]-cycle, 0]. Revenir d'un
// cycle entier ne se voit pas, la copie affichée étant identique à l'original.
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
    // Vitesse : 0,035 px par milliseconde (35 px/s), indépendante de la fréquence d'affichage.
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

  const { photo, colors, objects } = cardComposition(member);

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
      item.append(missionBadge(tag, colors.missions, false), el('span', null, tag));
      return item;
    })
  );

  modalTags.hidden = !modalTags.children.length;
  if (modalTagsLabel) modalTagsLabel.hidden = modalTags.hidden;


  /* -------------------------
     INFORMATIONS
     Pôle (dans le surtitre) et rôle (sous le nom) sont déjà
     affichés : seules les autres informations du CMS restent.
  ------------------------- */

  const shown = ['Pôle', 'Rôle'];

  modalExtra.replaceChildren(
    ...Object.entries(
      member.extra || {}
    ).filter(([key]) => !shown.includes(key)).map(([key, value]) => {

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

  modalExtra.hidden = !modalExtra.children.length;


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