import { EVENTS, EVENT_REDIRECTS } from "../data/events.js";
import { splitB2B, artistsOf, artistUrl, artistPhoto, slotStyle } from "../components/artists.js";
import { SITE } from "../data/site.js";
import { formatDate, formatTime, readParam, eventStatus, safeUrl, track, eventPath } from "./helpers.js";
import { t, tr, plural, locale } from "../i18n/i18n.js";
import { downloadICS, eventRange } from "./ics.js";
import { eventStats } from "../components/event-stats.js";

// Fiche statique (evenement-….html) : le slug est écrit sur <body data-slug>.
// Ancienne adresse evenement.html?slug=… (liens déjà partagés) : on passe sur la fiche statique.
// Ancienne adresse d'une soirée renommée dans le CMS (EVENT_REDIRECTS) : même redirection.
const legacySlug = !document.body.dataset.slug && readParam("slug");
const legacyTarget = legacySlug && (EVENTS.some((event) => event.slug === legacySlug) ? legacySlug : EVENT_REDIRECTS[legacySlug]);
if (legacyTarget && EVENTS.some((event) => event.slug === legacyTarget)) {
  const params = new URLSearchParams(location.search);
  params.delete("slug");
  // Adresse relative à la page (et non à <base>) : de/evenement.html?slug=… reste en allemand.
  location.replace(new URL(eventPath(legacyTarget), location.href) + (params.size ? `?${params}` : "") + location.hash);
}

const root = document.getElementById("event-detail");
const ev = EVENTS.find((event) => event.slug === (document.body.dataset.slug || legacyTarget));
// Soirée annulée : plus de billetterie.
const ticketUrl = ev?.cancelled ? "" : safeUrl(ev?.ticketUrl);

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

const timeToMinutes = (value = "") => {
  const match = value.match(/(\d{1,2})h(\d{2})/i);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

// Petit logo Instagram blanc + main « clic » collés au nom, pour montrer qu'on peut appuyer dessus.
const IG_HINT = `<span class="lineup-row__ig" aria-hidden="true">`
  + `<svg class="lineup-row__ig-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`
  + `<svg class="lineup-row__ig-tap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v2"/><path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.9-1.9L4.6 16a1.6 1.6 0 0 1 2.4-2.1L9 15.5"/></svg>`
  + `</span>`;
// Photos de profil du cercle (js/data/artistes-photos.js) : une par artiste, un deuxième cercle pour un B2B.
const artistPhotos = (artist) =>
  artist.image ? [artist.image] : artistsOf(artist.name).map(artistPhoto).filter(Boolean);
/* Nom d'artiste -> lien Instagram (js/data/artistes.js). Un B2B donne un lien par artiste. */
const artistName = (name) =>
  splitB2B(name)
    .map((part, i) => {
      const url = i % 2 ? null : artistUrl(part);
      return url
        ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(t("{name} sur Instagram", { name: part }))}">${escapeHTML(part)}${IG_HINT}</a>`
        : escapeHTML(part);
    })
    .join("");

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
  const status = eventStatus(ev);
  const range = eventRange(ev);
  const pageTitle = `${ev.title} — Tekno Never Dies`;
  const summary = `${formatDate(ev.date, ev.datePrecision)}${ev.place ? ` · ${ev.place}` : ""}. ${tr(ev.description) || ""}`.trim();
  const visual = ev.flyer || ev.cover;
  document.title = pageTitle;
  const setMeta = (selector, value) => document.head.querySelector(selector)?.setAttribute("content", value);
  setMeta('meta[name="description"]', summary);
  setMeta('meta[property="og:title"]', pageTitle);
  setMeta('meta[property="og:description"]', summary);
  setMeta('meta[name="twitter:title"]', pageTitle);
  setMeta('meta[name="twitter:description"]', summary);
  if (visual) {
    const visualUrl = new URL(visual, SITE.url).href;
    setMeta('meta[property="og:image"]', visualUrl);
    setMeta('meta[name="twitter:image"]', visualUrl);
    setMeta('meta[property="og:image:alt"]', t("Flyer de {title}", { title: ev.title }));
    document.head.querySelectorAll('meta[property="og:image:width"], meta[property="og:image:height"]').forEach((m) => m.remove());
  }

  // Données structurées (JSON-LD) : écrites dans la page par tools/event-pages.mjs.

  // Fond du hero : la photo si elle existe, sinon le flyer (flouté par css/components/event-flyer.css).
  const coverImage = ev.heroImage || ev.cover || ev.flyer;
  // Adresse complète : une url() relative dans une variable CSS serait résolue depuis css/pages.css (404).
  // Résolue depuis <base> : les pages de/ et en/ utilisent les mêmes images que les pages françaises.
  const cover = coverImage ? `style="--event-cover:url('${escapeHTML(new URL(coverImage, document.baseURI).href.replace(/['()\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))}')"` : "";

  const galleryLink = ev.gallerySlug
    ? `<a class="event-gallery-link" href="galerie.html#${encodeURIComponent(ev.gallerySlug)}">
        <span>Voir les images de la nuit</span><span aria-hidden="true">↗</span>
      </a>`
    : "";

  const lineup = orderedLineup(ev.lineup || [], ev.time);
  const lineupIsPreview = Boolean(ev.lineupPreview);

  const genres = ev.genres?.length
    ? `<ul class="event-genres" aria-label="Styles musicaux" translate="no">${ev.genres.map((genre) => `<li>${escapeHTML(genre)}</li>`).join("")}</ul>`
    : "";

  const flyer = ev.flyer
    ? `<figure class="event-flyer">
        <img class="event-flyer__media" src="${escapeHTML(ev.flyer)}" alt="${escapeHTML(t("Flyer de {title}", { title: ev.title }))}" width="1080" height="1350" decoding="async" />
        <figcaption><a href="${escapeHTML(ev.flyer)}" target="_blank" rel="noopener">Voir le flyer en grand ↗</a></figcaption>
      </figure>`
    : "";

  /* ---------- Repères chiffrés (section « La soirée ») ---------- */
  const [placeName, ...placeRest] = (ev.place || "").split(",").map((part) => part.trim()).filter(Boolean);
  const town = placeRest.at(-1) || placeName || "";
  const venueName = placeRest.length ? placeName : "";
  const street = placeRest.length > 1 ? placeRest.slice(0, -1).join(", ") : "";
  const { hours, djs, crowd } = eventStats(ev);
  const stats = [
    hours ? [String(hours).replace(".", ","), plural(hours, "heure de son", "heures de son")] : null,
    djs ? [String(djs), plural(djs, "DJ au line-up", "DJ au line-up")] : null,
    crowd ? [`≈ ${crowd}`, tr("personnes")] : null,
    ev.genres?.length ? [String(ev.genres.length), plural(ev.genres.length, "style", "styles")] : null
  ].filter(Boolean);

  /* ---------- Haut de la fiche : statut, puis date / horaires / lieu / entrée ---------- */
  const longDate = (() => {
    const [y, m, d] = ev.date.split("-").map(Number);
    const options = ev.datePrecision === "month" ? { month: "long", year: "numeric" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    const text = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    return text.charAt(0).toUpperCase() + text.slice(1);
  })();
  const daysLeft = range ? Math.ceil((range.start.getTime() - Date.now()) / 864e5) : null;
  const statusLine = ev.cancelled
    ? `<p class="event-status is-cancelled"><span>Soirée annulée</span><span class="event-status__count" translate="no">${escapeHTML(ev.date.slice(0, 4))}</span></p>`
    : status === "a-venir"
    ? `<p class="event-status is-upcoming"><span class="event-status__dot" aria-hidden="true"></span><span>Prochaine soirée</span>${daysLeft > 1 ? `<span class="event-status__count">${escapeHTML(t("J-{n}", { n: daysLeft }))}</span>` : ""}</p>`
    : `<p class="event-status is-past"><span>Soirée passée</span><span class="event-status__count" translate="no">${escapeHTML(ev.date.slice(0, 4))}</span></p>`;
  // Âge : champ "age", sinon une info pratique « Dès 16 ans »
  const ageText = ev.age || (ev.practical || []).find((item) => /^Dès \d+ ans$/i.test(item)) || "";
  const entry = [ev.price ? tr(ev.price) : "", ageText ? tr(ageText) : ""].filter(Boolean).join(" · ");
  const facts = [
    ["Date", longDate],
    ev.time ? ["Horaires", formatTime(ev.time), ev.doors ? t("Ouverture des portes : {time}", { time: formatTime(ev.doors) }) : ""] : null,
    ev.place ? ["Lieu", venueName || town, [street, venueName ? town : ""].filter(Boolean).join(", ")] : ["Lieu", tr("Lieu à confirmer")],
    entry ? [ev.price ? "Entrée" : "Âge", entry] : crowd ? ["Fréquentation", t("≈ {n} personnes", { n: crowd })] : null
  ].filter(Boolean);
  const factsContent = `<dl class="event-facts">${facts.map(([label, value, detail]) => `
      <div class="event-facts__item">
        <dt>${escapeHTML(tr(label))}</dt>
        <dd>${escapeHTML(value)}${detail ? `<small>${escapeHTML(detail)}</small>` : ""}</dd>
      </div>`).join("")}</dl>`;

  // Itinéraire (soirées à venir) : ouvre l'appli GPS du téléphone sur l'adresse de la salle.
  const destination = encodeURIComponent(ev.place || "");
  const routes = ev.place && status === "a-venir" && !ev.cancelled
    ? [
        ["Waze", `https://waze.com/ul?q=${destination}&navigate=yes`],
        ["Google Maps", `https://www.google.com/maps/dir/?api=1&destination=${destination}`],
        ...(/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? [["Plans", `https://maps.apple.com/?daddr=${destination}`]] : [])
      ]
    : [];

  // Boutons du haut : l'action principale d'abord (billetterie, ou les photos d'une soirée passée)
  const mainAction = ticketUrl
    ? `<a class="btn btn-solid" href="${escapeHTML(ticketUrl)}" target="_blank" rel="noopener">Prendre ma place ↗</a>`
    : ev.gallerySlug ? `<a class="btn btn-solid" href="galerie.html#${encodeURIComponent(ev.gallerySlug)}">Voir les photos ↗</a>` : "";
  const heroActions = `
    <div class="event-actions">
      ${mainAction}
      ${status === "a-venir" && !ev.cancelled ? `<button type="button" class="btn btn-hero-line" id="add-to-calendar">Ajouter à l'agenda</button>` : ""}
      ${ev.venue ? `<a class="btn btn-hero-line" href="#access-title">Y aller</a>` : ""}
      <button type="button" class="btn btn-hero-line js-share"><span>Partager</span></button>
    </div>`;

  /* ---------- « La soirée » : ce qui distingue cette soirée ---------- */
  const about = ev.about || {};
  const photos = (about.photos || []).slice(0, 2);
  const statsContent = stats.length ? `<ul class="event-stats">${stats.map(([n, label]) => `<li><b>${escapeHTML(n)}</b><span>${escapeHTML(label)}</span></li>`).join("")}</ul>` : "";
  const aboutContent = `
    <section class="event-about${photos.length ? " has-photos" : ""}" aria-labelledby="about-title">
      <div class="event-about__intro">
        <p class="event-eyebrow">${escapeHTML(tr(about.kicker || "La soirée"))}</p>
        <h2 id="about-title">${escapeHTML(tr(about.title || "Une nuit signée Tekno Never Dies."))}</h2>
        <p class="event-about__text">${escapeHTML(tr(about.text || ev.description || ""))}</p>
        ${statsContent}
        ${galleryLink}
      </div>
      ${photos.length
        ? `<div class="event-about__photos">${photos.map((photo) => `
            <figure class="event-photo">
              <span class="event-photo__frame"><img src="${escapeHTML(photo.src)}" alt="${escapeHTML(photo.alt ? tr(photo.alt) : "")}" loading="lazy" decoding="async" /></span>
              ${photo.caption ? `<figcaption>${escapeHTML(tr(photo.caption))}</figcaption>` : ""}
            </figure>`).join("")}</div>`
        : `<div class="event-about__side">
            <div class="event-story__stamp" aria-hidden="true" translate="no">
              <svg class="event-story__ring" viewBox="0 0 200 200">
                <defs><path id="stamp-circle" d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" /></defs>
                <text><textPath href="#stamp-circle" textLength="512" lengthAdjust="spacing">TEKNO NEVER DIES ✦ ${escapeHTML(ev.title)} ✦ ${escapeHTML(ev.date.slice(0, 4))} ✦</textPath></text>
              </svg>
              <span class="event-story__core">TND</span>
            </div>
          </div>`}
    </section>`;

  // Place de chaque set dans la nuit (0 = ouverture, 1 = fermeture) : barre « timetable » des cartes
  const night = range && range.end > range.start ? range : null;
  const slotBar = (time) => {
    const slot = night && time ? eventRange(ev, time) : null;
    if (!slot) return "";
    const total = night.end - night.start;
    const from = Math.max(0, (slot.start - night.start) / total), to = Math.min(1, (slot.end - night.start) / total);
    return `<span class="lineup-row__bar" aria-hidden="true" style="--from:${from.toFixed(3)};--to:${to.toFixed(3)}"><i></i></span>`;
  };
  // Axe des heures au-dessus du line-up (ouverture, milieu, fermeture)
  const hourLabel = (date) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(date).replace(":", locale.startsWith("fr") ? "h" : ":");
  const nightAxis = night && lineup.some((slot) => slot.time)
    ? `<div class="lineup-axis" aria-hidden="true"><span>${hourLabel(night.start)}</span><i></i><span>${escapeHTML(tr("La nuit"))}</span><i></i><span>${hourLabel(night.end)}</span></div>`
    : "";
  const lineupContent = lineup.length
    ? `<ul class="lineup-rows" style="--rows:${Math.ceil(lineup.length / 2)}">${lineup.map((artist, i) => `
        <li class="lineup-row" data-slot="${escapeHTML(artist.time || "")}">
          <span class="lineup-row__num">${String(i + 1).padStart(2, "0")}</span>
          <span class="lineup-row__photos">${(artistPhotos(artist).length ? artistPhotos(artist).slice(0, 2) : [null]).map((src) => `<span class="lineup-row__photo">${src ? `<img src="${escapeHTML(src)}" alt="" loading="lazy" />` : ""}</span>`).join("")}</span>
          <div class="lineup-row__info">
            ${artist.time
              ? `<span class="lineup-row__time">${escapeHTML(formatTime(artist.time))}</span>`
              : status === "a-venir" ? `<span class="lineup-row__time">Horaire à confirmer</span>` : ""}
            <span class="lineup-row__live">En ce moment</span>
            <h3 translate="no">${artist.name ? artistName(artist.name) : escapeHTML(tr("Artiste à renseigner"))}</h3>
            ${(artist.style || slotStyle(artist.name)) ? `<p class="lineup-row__style" translate="no">${escapeHTML(artist.style || slotStyle(artist.name))}</p>` : ""}
          </div>
          ${artist.demo ? `<span class="lineup-row__draft">À compléter</span>` : artist.collective ? `<span class="lineup-row__collective">${escapeHTML(artist.collective)}</span>` : ""}
          ${slotBar(artist.time)}
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

  /* ---------- « Y aller » : plan du village + plan du lieu (tools/maps.mjs), itinéraires ---------- */
  const precise = ev.venue && ev.venue.precise !== false;
  // Une seule carte : infos à gauche ; à droite le plan du village, et (lieu précis) un médaillon
  // « zoom sur la salle » relié par deux traits au cadre pointillé de la zone agrandie.
  // Positions calculées par layoutMap() (plus bas) d'après la taille réelle du plan.
  const accessContent = ev.venue
    ? `<section class="event-access" aria-labelledby="access-title">
        <div class="event-section-head">
          <h2 id="access-title">Y aller<span class="event-title__dot">.</span></h2>
        </div>
        <div class="event-access__card${precise ? "" : " is-single"}">
          <div class="event-access__info">
            <p class="event-eyebrow">${escapeHTML(tr(precise ? "Le lieu" : "Lieu exact non renseigné"))}</p>
            <p class="event-access__venue" translate="no">${escapeHTML(venueName || town)}</p>
            ${street || venueName ? `<p class="event-access__address" translate="no">${escapeHTML([street, town].filter(Boolean).join(", "))}</p>` : ""}
            ${routes.length ? `<div class="event-access__links">${routes.map(([label, url]) => `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">${label} <span aria-hidden="true">↗</span></a>`).join("")}</div>` : ""}
            <p class="event-maps__credit">Plans : © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">les contributeurs d'OpenStreetMap</a></p>
          </div>
          <div class="event-mapstage" role="img" aria-label="${escapeHTML(t("Plan : {place}", { place: [venueName, town].filter(Boolean).join(", ") }))}" data-span="${ev.venue.span || 2.5}">
            <img class="event-mapstage__village" src="assets/img/maps/${escapeHTML(ev.slug)}-village.svg" alt="" loading="lazy" decoding="async" />
            <span class="event-mapstage__town" translate="no">${escapeHTML(town)}</span>
            ${precise ? `
            <span class="event-map__pin event-mapstage__pin" aria-hidden="true"></span>
            <span class="event-mapstage__zoom" aria-hidden="true"></span>
            <svg class="event-mapstage__links" aria-hidden="true"><line /><line /></svg>
            <span class="event-mapstage__inset">
              <img src="assets/img/maps/${escapeHTML(ev.slug)}-lieu.svg" alt="" loading="lazy" decoding="async" />
              <span class="event-map__pin" aria-hidden="true"></span>
              <span class="event-mapstage__label">${escapeHTML(tr("Zoom sur la salle"))}</span>
            </span>` : ""}
          </div>
        </div>
      </section>`
    : "";

  // Infos pratiques : sans répéter ce qui est déjà en haut ou dans les chiffres clés
  // (heure de début, âge, nombre de participants)
  const practicalItems = (ev.practical || []).filter((item) => item !== ageText && !/^Début\s*:/i.test(item) && !/\d+\s*participant/i.test(item));
  // Liens complémentaires saisis dans le CMS (événement Facebook, page partenaire…) : à la suite.
  const links = (ev.links || []).map((link) => ({ label: link.label, url: safeUrl(link.url) })).filter((link) => link.url);
  const practicalContent = practicalItems.length || links.length
    ? `<section class="event-practical" aria-labelledby="practical-title">
        <div class="event-section-head">
          <h2 id="practical-title">Infos pratiques<span class="event-title__dot">.</span></h2>
          <p class="event-section-head__note">À SAVOIR<br />AVANT DE VENIR.</p>
        </div>
        <ul>${practicalItems.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}${links.map((link) => `<li><a href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.label)} <span aria-hidden="true">↗</span></a></li>`).join("")}</ul>
      </section>`
    : "";

  root.innerHTML = `
      <section class="event-hero${flyer ? " has-flyer" : ""}" ${cover} aria-labelledby="event-title">
      <div class="event-hero__grain" aria-hidden="true"></div>
      <div class="event-hero__wire">${wireframeSVG()}</div>

      <div class="event-hero__back">
        <a class="event-back" href="evenements.html"><span aria-hidden="true">←</span> Retour aux événements</a>
      </div>

      <div class="event-hero__inner">
        <div class="event-hero__text">
          ${statusLine}
          <h1 id="event-title" translate="no">${escapeHTML(ev.title)}<span class="event-title__dot">.</span></h1>
          ${factsContent}
          ${genres}
          ${heroActions}
          ${demoNote}
        </div>
        ${flyer}
      </div>
    </section>

    ${aboutContent}

    <section class="event-lineup" aria-labelledby="lineup-title">
      <div class="event-section-head">
        <h2 id="lineup-title">Line<span>-</span>up<span class="event-title__dot">.</span></h2>
        <p class="event-section-head__note">LES NOMS<br />ET LES FRÉQUENCES.</p>
      </div>
      ${lineupIsPreview ? `<p class="lineup-preview-note">APERÇU — à remplacer avant publication.</p>` : ""}
      ${nightAxis}
      ${lineupContent}
    </section>

    ${accessContent}
    ${practicalContent}

    <section class="event-bottom-actions">
      <div class="actions">
        <button type="button" class="event-gallery-link js-share">
          <span>Partager la soirée</span><span aria-hidden="true">↗</span>
        </button>
        <a class="event-gallery-link" href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}">
          <span>Une question ? Contacter l'équipe</span><span aria-hidden="true">↗</span>
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

  layoutMap(root.querySelector(".event-mapstage"));

  document.getElementById("add-to-calendar")?.addEventListener("click", () => {
    downloadICS([ev], `tnd-${ev.slug}.ics`);
    track(`Ajouter à l'agenda · ${ev.title}`);
  });

  // Partager : menu de partage du téléphone (Insta, WhatsApp, SMS…), sinon copie du lien.
  const shareData = {
    title: pageTitle,
    text: `${ev.title} — ${[formatDate(ev.date, ev.datePrecision), ev.place].filter(Boolean).join(" · ")}`,
    url: location.href
  };
  root.querySelectorAll(".js-share").forEach((button) => {
    const label = button.querySelector("span") || button;
    const original = label.textContent;
    button.addEventListener("click", async () => {
      track(`Partager · ${ev.title}`);
      if (navigator.share) {
        try { await navigator.share(shareData); } catch { /* partage annulé */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(shareData.url);
        label.textContent = "Lien copié ✓";
      } catch {
        label.textContent = "Copie impossible";
      }
      setTimeout(() => { label.textContent = original; }, 2200);
    });
  });

  // Line-up en direct : le soir même, l'artiste en train de jouer s'allume (vérifié toutes les 30 s).
  if (range && Date.now() < range.end.getTime()) {
    const rows = [...root.querySelectorAll(".lineup-row[data-slot]")]
      .map((row) => ({ row, slot: row.dataset.slot && eventRange(ev, row.dataset.slot) }))
      .filter(({ slot }) => slot);
    const updateLive = () => {
      const now = Date.now();
      rows.forEach(({ row, slot }) => row.classList.toggle("is-live", now >= slot.start.getTime() && now < slot.end.getTime()));
      root.querySelector(".event-hero")?.classList.toggle("is-live", now >= range.start.getTime() && now < range.end.getTime());
      if (now >= range.end.getTime()) clearInterval(timer);
    };
    const timer = setInterval(updateLive, 30_000);
    updateLive();
  }
}

/* ---------- Plan « Y aller » : place le village, la zone agrandie, le médaillon et les deux traits ----------
   Les plans sont centrés sur le lieu (tools/maps.mjs). Le village est agrandi (×1,5) et décalé pour que
   la salle tombe au tiers gauche ; le médaillon (plan du lieu, ≈ 600 m) se pose à droite. */
function layoutMap(stage) {
  if (!stage) return;
  const IMG_AR = 1200 / 760;
  const place = () => {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const single = !stage.querySelector(".event-mapstage__inset");
    const scale = 1.5;
    const imgW = W * scale, imgH = imgW / IMG_AR;
    const vx = single ? W * 0.5 : W * 0.3, vy = H * 0.5; // position de la salle dans le cadre
    const village = stage.querySelector(".event-mapstage__village");
    Object.assign(village.style, { width: `${imgW}px`, height: `${imgH}px`, left: `${vx - imgW / 2}px`, top: `${vy - imgH / 2}px` });
    if (single) return;
    const zoomW = imgW * (0.6 / Number(stage.dataset.span || 2.5)), zoomH = zoomW / IMG_AR;
    const z = { l: vx - zoomW / 2, t: vy - zoomH / 2, r: vx + zoomW / 2, b: vy + zoomH / 2 };
    const insetW = W * 0.42, insetH = insetW / IMG_AR;
    const i = { l: W - insetW - W * 0.04, t: (H - insetH) / 2 };
    Object.assign(stage.querySelector(".event-mapstage__zoom").style, { left: `${z.l}px`, top: `${z.t}px`, width: `${zoomW}px`, height: `${zoomH}px` });
    Object.assign(stage.querySelector(".event-mapstage__pin").style, { left: `${vx}px`, top: `${vy}px` });
    Object.assign(stage.querySelector(".event-mapstage__inset").style, { left: `${i.l}px`, top: `${i.t}px`, width: `${insetW}px`, height: `${insetH}px` });
    const [l1, l2] = stage.querySelectorAll(".event-mapstage__links line");
    const set = (line, x1, y1, x2, y2) => Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => line.setAttribute(k, v.toFixed(1)));
    set(l1, z.r, z.t, i.l, i.t);
    set(l2, z.r, z.b, i.l, i.t + insetH);
  };
  place();
  new ResizeObserver(place).observe(stage);
}
