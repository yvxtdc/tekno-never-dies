import { TEAM } from "../data/equipe.js";

/**
 * Bande de photos de l'équipe + fiche modale au clic.
 *
 * Contrairement au bandeau défilant du bas de l'accueil (qui tourne tout
 * seul), cette bande ne défile PAS automatiquement : on peut la faire
 * glisser à la souris ou au doigt. Une photo qui bouge toute seule est une
 * cible mouvante difficile à cliquer précisément — ça n'aurait pas été
 * agréable à utiliser pour choisir un visage.
 *
 * Tant qu'aucune vraie photo n'existe pour un membre (photo: null dans
 * js/data/equipe.js), un avatar avec ses initiales s'affiche à la place.
 * Dès qu'un fichier assets/img/equipe/<slug>.webp est ajouté et référencé
 * dans la donnée, il prend le relais automatiquement.
 */

function initials(name) {
  return name
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function card(member) {
  const visual = member.photo
    ? `<img src="${member.photo}" alt="" loading="lazy" />`
    : `<span class="team-avatar" aria-hidden="true">${initials(member.name)}</span>`;
  return `
    <li>
      <button class="team-card" type="button" data-member="${member.slug}">
        ${visual}
        <span class="team-card__name">${member.name}</span>
      </button>
    </li>`;
}

const track = document.getElementById("team-track");
if (track) {
  track.innerHTML = TEAM.map(card).join("");
    track.innerHTML = TEAM.map(card).join("");
  setupModal(track);
}

function setupModal(track) {
  const modal = document.getElementById("team-modal");
  const photoBox = modal.querySelector(".team-modal-photo");
  const nameEl = document.getElementById("team-modal-name");
  const roleEl = document.getElementById("team-modal-role");
  const tagsEl = document.getElementById("team-modal-tags");
  const extraEl = document.getElementById("team-modal-extra");
  let lastFocused = null;

  function open(member, trigger) {
    lastFocused = trigger;
    photoBox.innerHTML = member.photo
      ? `<img src="${member.photo}" alt="" />`
      : `<span class="team-avatar team-avatar--lg" aria-hidden="true">${initials(member.name)}</span>`;
    nameEl.textContent = member.name;
    roleEl.textContent = member.role || "";
    tagsEl.innerHTML = (member.tags || []).map((t) => `<span class="pill">${t}</span>`).join("");
    const extraEntries = Object.entries(member.extra || {});
    extraEl.innerHTML = extraEntries.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

    modal.classList.add("is-open");
    modal.querySelector(".team-modal-close").focus();
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    modal.classList.remove("is-open");
    document.removeEventListener("keydown", onKeydown);
    lastFocused?.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  track.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-member]");
    if (!btn) return;
    const member = TEAM.find((m) => m.slug === btn.dataset.member);
    if (member) open(member, btn);
  });

  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));
}
