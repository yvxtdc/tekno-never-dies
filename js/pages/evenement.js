import { EVENTS } from "../data/events.js";
import { formatDate, readParam } from "./helpers.js";
import { downloadICS, parisOffset } from "./ics.js";

const root = document.getElementById("event-detail");
const ev = EVENTS.find((event) => event.slug === readParam("slug"));

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

const timeToMinutes = (value = "") => {
  const match = value.match(/(\d{1,2})h(\d{2})/i);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const orderedLineup = (lineup = [], eventStart = "") => {
  const start = timeToMinutes(eventStart) ?? 0;
  return lineup
    .map((artist, index) => ({ ...artist, _index: index }))
    .sort((a, b) => {
      const aTime = timeToMinutes(a.time);
      const bTime = timeToMinutes(b.time);
      if (aTime === null && bTime === null) return (a.order ?? a._index) - (b.order ?? b._index);
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      const aRel = aTime < start ? aTime + 1440 : aTime;
      const bRel = bTime < start ? bTime + 1440 : bTime;
      return aRel - bRel;
    });
};

/* Fil de fer décoratif : une grille SVG légèrement distordue, en une seule couleur. */
function wireframeSVG() {
  const rows = 8, cols = 10, w = 600, h = 420;
  const wave = (x, y) => Math.sin((x / w) * Math.PI * 1.6 + (y / h) * 2) * 26;
  const pt = (i, j) => {
    const x = (i / cols) * w;
    const y = (j / rows) * h + wave(x, (j / rows) * h);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  let lines = "";
  for (let j = 0; j <= rows; j++) {
    let d = `M${pt(0, j)}`;
    for (let i = 1; i <= cols; i++) d += ` L${pt(i, j)}`;
    lines += `<path d="${d}" />`;
  }
  for (let i = 0; i <= cols; i++) {
    let d = `M${pt(i, 0)}`;
    for (let j = 1; j <= rows; j++) d += ` L${pt(i, j)}`;
    lines += `<path d="${d}" />`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${lines}</svg>`;
}

if (!root) {
  console.error('TND : conteneur "#event-detail" introuvable.');
} else if (!ev) {
  root.innerHTML = `
    <section class="event-not-found">
      <p class="event-eyebrow">TND / ARCHIVES</p>
      <h1>Événement introuvable<span>.</span></h1>
      <p>Cette page n'existe pas ou n'est plus disponible.</p>
      <a class="btn btn-line" href="evenements.html">Retour aux événements</a>
    </section>
  `;
} else {
  document.title = `${ev.title} — Tekno Never Dies`;

  const startTime = (ev.time?.match(/\d{1,2}h\d{2}/)?.[0] || "20h00").replace("h", ":");
  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: ev.title,
    description: ev.description,
    startDate: `${ev.date}T${startTime}:00` + parisOffset(ev.date, Number(startTime.split(":")[0])),
    location: { "@type": "Place", name: ev.place },
    organizer: { "@type": "Organization", name: "TEKNO NEVER DIES" }
  };
  const schema = document.createElement("script");
  schema.type = "application/ld+json";
  schema.textContent = JSON.stringify(eventSchema);
  document.head.append(schema);

  const [dateDay, dateMonth, dateYear] = formatDate(ev.date).split(" ");
  const coverImage = ev.heroImage || ev.cover;
  const cover = coverImage ? `style="--event-cover:url('${escapeHTML(coverImage)}')"` : "";

  const practical = (ev.practical || []).map((item) => `<li>${escapeHTML(item)}</li>`).join("");
  const galleryLink = ev.gallerySlug
    ? `<a class="event-gallery-link" href="galerie.html#${encodeURIComponent(ev.gallerySlug)}">
        <span>Voir les images de la nuit</span><span aria-hidden="true">↗</span>
      </a>`
    : "";

  const lineup = orderedLineup(ev.lineup || [], ev.time);
  const lineupIsPreview = Boolean(ev.lineupPreview);

  const lineupContent = lineup.length
    ? `<ul class="lineup-rows">${lineup.map((artist, i) => `
        <li class="lineup-row">
          <span class="lineup-row__num">${String(i + 1).padStart(2, "0")}</span>
          <span class="lineup-row__photo">${artist.image ? `<img src="${escapeHTML(artist.image)}" alt="" loading="lazy" />` : ""}</span>
          <div class="lineup-row__info">
            <span class="lineup-row__time">${artist.time ? escapeHTML(artist.time) : "Horaire à confirmer"}</span>
            <h3>${escapeHTML(artist.name || "Artiste à renseigner")}</h3>
            <p class="lineup-row__style">${escapeHTML(artist.style || "Style à renseigner")}</p>
          </div>
          ${artist.demo ? `<span class="lineup-row__draft">À compléter</span>` : artist.collective ? `<span class="lineup-row__collective">${escapeHTML(artist.collective)}</span>` : ""}
        </li>
      `).join("")}</ul>`
    : `<div class="lineup-empty">
        <span class="lineup-empty__symbol" aria-hidden="true">✳</span>
        <div>
          <p class="event-eyebrow">PROGRAMMATION</p>
          <h3>Le line-up arrive bientôt.</h3>
          <p>Les artistes, leurs styles et leurs horaires seront ajoutés ici.</p>
        </div>
      </div>`;

  const demoNote = ev.demo
    ? `<p class="event-draft-note"><span aria-hidden="true">✳</span> Fiche de démonstration — informations à confirmer.</p>`
    : "";

  const practicalContent = practical
    ? `<section class="event-practical">
        <p class="event-eyebrow">À SAVOIR</p>
        <h2>Infos pratiques<span>.</span></h2>
        <ul>${practical}</ul>
      </section>`
    : "";

  root.innerHTML = `
    <a class="back-link event-back-link" href="evenements.html"><span aria-hidden="true">←</span> Tous les événements</a>

      <section class="event-hero" ${cover} aria-labelledby="event-title">
      <div class="event-hero__grain" aria-hidden="true"></div>
      <div class="event-hero__wire">${wireframeSVG()}</div>

      <div class="event-hero__inner">
        <div class="event-hero__top">
          <p class="event-eyebrow">TEKNO NEVER DIES <span>/</span> EVENT FILE</p>
          <nav class="event-quicklinks" aria-label="Actions rapides">
            ${ev.ticketUrl ? `<a class="is-primary" href="${escapeHTML(ev.ticketUrl)}" target="_blank" rel="noopener">Billetterie ↗</a>` : ""}
            ${ev.status === "a-venir" ? `<button type="button" id="add-to-calendar">Ajouter à l'agenda</button>` : ""}
            ${ev.gallerySlug ? `<a href="galerie.html#${encodeURIComponent(ev.gallerySlug)}">Voir la galerie</a>` : ""}
            <a href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}">Une question ?</a>
          </nav>
        </div>

        <h1 id="event-title">${escapeHTML(ev.title)}<span class="event-title__dot">.</span></h1>

        <p class="event-hero__when">
          <b>${escapeHTML(dateDay)} ${escapeHTML(dateMonth)}</b>
          <span>${escapeHTML(dateYear)}</span>
          ${ev.time ? `— ${escapeHTML(ev.time)}` : ""}
          <span>${escapeHTML(ev.place || "Lieu à confirmer")}</span>
        </p>

        ${demoNote}
      </div>

      <div class="ticker" aria-hidden="true">
        <div class="track">
          <span>${escapeHTML(ev.description || "Une nuit signée Tekno Never Dies.")}</span>
          <span>${escapeHTML(ev.description || "Une nuit signée Tekno Never Dies.")}</span>
        </div>
      </div>
    </section>

    <section class="event-lineup" aria-labelledby="lineup-title">
      <div class="event-section-head">
        <h2 id="lineup-title">Line<span>-</span>up<span class="event-title__dot">.</span></h2>
        <p class="event-section-head__note">LES NOMS<br />ET LES FRÉQUENCES.</p>
      </div>
      ${lineupIsPreview ? `<p class="lineup-preview-note">APERÇU — à remplacer avant publication.</p>` : ""}
      ${lineupContent}
      ${lineup.length ? `<p class="lineup-footnote"><span>↳</span>${lineup.some((a) => a.demo) ? "Champs de démonstration à remplacer." : "Ordre chronologique, y compris après minuit."}</p>` : ""}
    </section>

    <section class="event-story">
      <div>
        <p class="event-eyebrow">UNE NUIT / UN SOUND SYSTEM</p>
        <h2>Built for<br /><span>the dancefloor.</span></h2>
        <p>${escapeHTML(ev.description || "Une nuit signée Tekno Never Dies.")}</p>
        ${galleryLink}
      </div>
      <div class="event-story__stamp" aria-hidden="true">
        <span>TND</span><small>NEVER DIES</small>
      </div>
    </section>

    ${practicalContent}

    <section class="event-bottom-actions">
      <div class="actions">
        <a class="event-gallery-link" href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}">
          <span>Contacter l'équipe</span><span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>

    <a class="cta-row" href="evenements.html">
      <span class="cta-row__inner">
        <span class="cta-row__kicker">TND / KEEP IN TOUCH</span>
        <span class="cta-row__title">
          Tous les événements
          <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </span>
      </span>
    </a>
  `;

  document.getElementById("add-to-calendar")?.addEventListener("click", () => {
    downloadICS([ev], `tnd-${ev.slug}.ics`);
  });
}