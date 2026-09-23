import { TEAM } from '../data/equipe.js';

const carousel = document.querySelector('.team-carousel');
const track = document.querySelector('.team-track');

if (!carousel || !track) {
  throw new Error('Composant équipe introuvable.');
}


/* =========================================================
   CRÉATION DES CARTES
========================================================= */

const cards = TEAM.map(member => {
  const li = document.createElement('li');

  const button = document.createElement('button');
  button.className = 'team-card';
  button.type = 'button';
  button.dataset.member = member.slug;
  button.setAttribute(
    'aria-label',
    `Voir la fiche de ${member.name}`
  );

  const img = document.createElement('img');
  img.src = member.photo;
  img.alt = member.name;
  img.loading = 'lazy';

  const overlay = document.createElement('span');
  overlay.className = 'team-card__overlay';

  const name = document.createElement('strong');
  name.className = 'team-card__name';
  name.textContent = member.name;

  const role = document.createElement('span');
  role.className = 'team-card__role';
  role.textContent = member.role;

  const hint = document.createElement('span');
  hint.className = 'team-card__hint';
  hint.textContent = member.demo ? 'Profil demo - voir la fiche' : 'Voir la fiche';

  overlay.append(name, role, hint);
  button.append(img, overlay);
  li.append(button);

  return li;
});


track.replaceChildren(...cards);


/* =========================================================
   DUPLICATION POUR LE CARROUSEL INFINI
========================================================= */

const originals = [...cards];

originals.forEach((li) => {
  const clone = li.cloneNode(true);

  clone.setAttribute('aria-hidden', 'true');

  clone.querySelector('button')?.setAttribute(
    'tabindex',
    '-1'
  );

  track.append(clone);
});


/* =========================================================
   VARIABLES CARROUSEL
========================================================= */

let offset = 0;
let lastTime = performance.now();

let paused = false;
let dragging = false;

let startX = 0;
let startOffset = 0;


/* =========================================================
   LARGEUR D'UN CYCLE
========================================================= */

function cycleWidth() {
  const styles = getComputedStyle(track);

  const gap =
    parseFloat(
      styles.columnGap || styles.gap
    ) || 0;

  const firstHalf =
    track.children.length / 2;

  let width = 0;

  for (let i = 0; i < firstHalf; i++) {
    width +=
      track.children[i]
        .getBoundingClientRect()
        .width;
  }

  width +=
    gap * Math.max(0, firstHalf - 1);

  return width;
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
  }
);


/* =========================================================
   SOURIS / DOIGT : DÉPLACEMENT
========================================================= */

carousel.addEventListener(
  'pointermove',
  (event) => {

    if (!dragging) return;

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

let lastFocused = null;

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');


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
   OUVERTURE DE LA FICHE
========================================================= */

function openModal(member, trigger) {

  lastFocused = trigger;

  modalImg.src =
    member.photo;

  modalImg.alt =
    member.name;

  modalName.textContent =
    member.name;

  modalRole.textContent =
    member.role;


  if (modalBio) {
    modalBio.textContent =
      member.bio || '';
  }


  /* -------------------------
     TAGS
  ------------------------- */

  modalTags.replaceChildren(
    ...(member.tags || []).map(tag => {

      const span =
        document.createElement('span');

      span.textContent = tag;

      return span;
    })
  );


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
     AFFICHER LA MODALE
  ------------------------- */

  modal.hidden = false;

  document.body.style.overflow =
    'hidden';
}


/* =========================================================
   FERMETURE DE LA FICHE
========================================================= */

function closeModal() {

  modal.hidden = true;

  document.body.style.overflow = '';

  lastFocused?.focus();
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


    const member =
      TEAM.find(
        item =>
          item.slug ===
          button.dataset.member
      );


    if (member) {
      openModal(member, button);
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
   FERMETURE AVEC ESC
========================================================= */

document.addEventListener(
  'keydown',
  event => {

    if (modal.hidden) return;

    if (event.key === 'Escape') {
      closeModal();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = [...modal.querySelectorAll(focusableSelector)];
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