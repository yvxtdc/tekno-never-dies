import { TEAM } from '../data/equipe.js';

const carousel = document.querySelector('.team-carousel');
const track = document.querySelector('.team-track');
if (!carousel || !track) throw new Error('Composant équipe introuvable.');

const cards = TEAM.map(member => {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.className = 'team-card';
  button.type = 'button';
  button.dataset.member = member.slug;
  button.setAttribute('aria-label', `Voir la fiche de ${member.name}`);
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
  hint.textContent = 'Voir la fiche';

  overlay.append(name, role, hint);
  button.append(img, overlay);
  li.append(button);
  return li;
});

track.replaceChildren(...cards);
const originals = [...cards];
originals.forEach((li) => {
  const clone = li.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelector('button')?.setAttribute('tabindex', '-1');
  track.append(clone);
});

let offset = 0;
let lastTime = performance.now();
let paused = false;
let dragging = false;
let startX = 0;
let startOffset = 0;

function cycleWidth() {
  const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
  const firstHalf = track.children.length / 2;
  let width = 0;
  for (let i = 0; i < firstHalf; i++) width += track.children[i].getBoundingClientRect().width;
  width += gap * Math.max(0, firstHalf - 1);
  return width;
}

function normalize() {
  const width = cycleWidth();
  if (!width) return;
  while (offset <= -width) offset += width;
  while (offset > 0) offset -= width;
}

function render() {
  track.style.transform = `translate3d(${offset}px,0,0)`;
}

function animate(now) {
  const dt = Math.min(50, now - lastTime);
  lastTime = now;
  if (!paused && !dragging && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    offset -= dt * 0.035;
    normalize();
    render();
  }
  requestAnimationFrame(animate);
}

carousel.addEventListener('mouseenter', () => { paused = true; });
carousel.addEventListener('mouseleave', () => { if (!dragging) paused = false; });

carousel.addEventListener('pointerdown', (event) => {
  dragging = true;
  paused = true;
  carousel.classList.add('is-dragging');
  carousel.setPointerCapture(event.pointerId);
  startX = event.clientX;
  startOffset = offset;
});

carousel.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  offset = startOffset + (event.clientX - startX);
  normalize();
  render();
});

function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  carousel.classList.remove('is-dragging');
  paused = carousel.matches(':hover');
  try { carousel.releasePointerCapture(event.pointerId); } catch (_) {}
}
carousel.addEventListener('pointerup', endDrag);
carousel.addEventListener('pointercancel', endDrag);

const modal = document.querySelector('#team-modal');
const modalImg = document.querySelector('#team-modal-img');
const modalName = document.querySelector('#team-modal-name');
const modalRole = document.querySelector('#team-modal-role');
const modalTags = document.querySelector('#team-modal-tags');
const modalExtra = document.querySelector('#team-modal-extra');
const modalBio = document.querySelector('#team-modal-bio');

function openModal(member) {
  modalImg.src = member.photo;
  modalImg.alt = member.name;
  modalName.textContent = member.name;
  modalRole.textContent = member.role;
  if (modalBio) modalBio.textContent = member.bio || '';
  modalTags.replaceChildren(...member.tags.map(tag => { const s = document.createElement('span'); s.textContent = tag; return s; }));
  modalExtra.replaceChildren(...Object.entries(member.extra).map(([key, value]) => {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = key;
    const dd = document.createElement('dd'); dd.textContent = value;
    wrap.append(dt, dd); return wrap;
  }));
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
}

track.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-member]');
  if (!button || button.closest('[aria-hidden="true"]')) return;
  const member = TEAM.find(item => item.slug === button.dataset.member);
  if (member) openModal(member);
});

document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeModal(); });

requestAnimationFrame(animate);
