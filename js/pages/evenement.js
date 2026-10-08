import { EVENTS } from "../data/events.js";
import { splitB2B, artistsOf, artistUrl, artistPhoto, slotStyle } from "./artists.js";
import { SITE } from "../data/site.js";
import { formatDate, readParam, eventStatus } from "./helpers.js";
import { downloadICS, eventTimes, eventRange, parisOffset } from "./ics.js";

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

/* Nom d'artiste -> lien Instagram (js/data/artistes.js). Un B2B donne un lien par artiste. */
// Photos de profil du cercle (js/data/artistes-photos.js) : une par artiste, un deuxième cercle pour un B2B.
const artistPhotos = (artist) =>
  artist.image ? [artist.image] : artistsOf(artist.name).map(artistPhoto).filter(Boolean);
const artistName = (name) =>
  splitB2B(name)
    .map((part, i) => {
      const url = i % 2 ? null : artistUrl(part);
      return url
        ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(part)} sur Instagram">${escapeHTML(part)}</a>`
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
  const pageTitle = `${ev.title} — Tekno Never Dies`;
  const summary = `${formatDate(ev.date, ev.datePrecision)}${ev.place ? ` · ${ev.place}` : ""}. ${ev.description || ""}`.trim();
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
    setMeta('meta[property="og:image:alt"]', `Flyer de ${ev.title}`);
    document.head.querySelectorAll('meta[property="og:image:width"], meta[property="og:image:height"]').forEach((m) => m.remove());
  }

  // Données structurées (résultats enrichis Google) : date de début et de fin, lieu, tarif, visuel.
  const iso = ({ y, mo, d, h, mi }) =>
    `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;
  const times = ev.datePrecision !== "month" && ev.time ? eventTimes(ev) : null;
  const dateOf = ({ y, mo, d }) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const [placeName, ...placeRest] = (ev.place || "").split(",").map((part) => part.trim());
  const price = ev.price?.match(/\d+(?:[.,]\d+)?/)?.[0];
  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: ev.title,
    description: ev.description,
    url: new URL(`evenement.html?slug=${encodeURIComponent(ev.slug)}`, SITE.url).href,
    startDate: times ? iso(times.start) + parisOffset(dateOf(times.start), times.start.h) : ev.date,
    ...(times ? { endDate: iso(times.end) + parisOffset(dateOf(times.end), times.end.h) } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(visual ? { image: [new URL(visual, SITE.url).href] } : {}),
    location: {
      "@type": "Place",
      name: placeName || ev.place,
      address: {
        "@type": "PostalAddress",
        ...(placeRest.length > 1
          ? { streetAddress: placeRest.slice(0, -1).join(", ") }
          : placeRest.length === 1 && /^\d/.test(placeName) ? { streetAddress: placeName } : {}),
        addressLocality: placeRest.at(-1) || placeName,
        addressRegion: "Grand Est",
        addressCountry: "FR"
      }
    },
    ...(ev.genres?.length ? { keywords: ev.genres.join(", ") } : {}),
    ...(ev.lineup?.length ? { performer: ev.lineup.map((artist) => ({ "@type": "PerformingGroup", name: artist.name })) } : {}),
    ...(price
      ? {
          offers: {
            "@type": "Offer",
            price: price.replace(",", "."),
            priceCurrency: "EUR",
            availability: status === "a-venir" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
            url: ev.ticketUrl || new URL(`evenement.html?slug=${encodeURIComponent(ev.slug)}`, SITE.url).href
          }
        }
      : {}),
    organizer: { "@type": "Organization", name: SITE.official.legalName, url: SITE.url }
  };
  const schema = document.createElement("script");
  schema.type = "application/ld+json";
  schema.textContent = JSON.stringify(eventSchema);
  document.head.append(schema);

  const eventDate = formatDate(ev.date, ev.datePrecision).split(" ");
  const [dateDay, dateMonth, dateYear] = eventDate;
  // Fond du hero : la photo si elle existe, sinon le flyer (flouté par css/components/event-flyer.css).
  const coverImage = ev.heroImage || ev.cover || ev.flyer;
  // Adresse complète : une url() relative dans une variable CSS serait résolue depuis css/pages.css (404).
  const cover = coverImage ? `style="--event-cover:url('${escapeHTML(new URL(coverImage, location.href).href)}')"` : "";

  const practical = (ev.practical || []).map((item) => `<li>${escapeHTML(item)}</li>`).join("");
  const galleryLink = ev.gallerySlug
    ? `<a class="event-gallery-link" href="galerie.html#${encodeURIComponent(ev.gallerySlug)}">
        <span>Voir les images de la nuit</span><span aria-hidden="true">↗</span>
      </a>`
    : "";

  const lineup = orderedLineup(ev.lineup || [], ev.time);
  const lineupIsPreview = Boolean(ev.lineupPreview);

  const genres = ev.genres?.length
    ? `<ul class="event-genres" aria-label="Styles musicaux">${ev.genres.map((genre) => `<li>${escapeHTML(genre)}</li>`).join("")}</ul>`
    : "";

  const flyer = ev.flyer
    ? `<figure class="event-flyer">
        <img class="event-flyer__media" src="${escapeHTML(ev.flyer)}" alt="Flyer de ${escapeHTML(ev.title)}" width="1080" height="1350" decoding="async" />
        <figcaption><a href="${escapeHTML(ev.flyer)}" target="_blank" rel="noopener">Voir le flyer en grand ↗</a></figcaption>
      </figure>`
    : "";

  const lineupContent = lineup.length
    ? `<ul class="lineup-rows">${lineup.map((artist, i) => `
        <li class="lineup-row" data-slot="${escapeHTML(artist.time || "")}">
          <span class="lineup-row__num">${String(i + 1).padStart(2, "0")}</span>
          <span class="lineup-row__photos">${(artistPhotos(artist).length ? artistPhotos(artist).slice(0, 2) : [null]).map((src) => `<span class="lineup-row__photo">${src ? `<img src="${escapeHTML(src)}" alt="" loading="lazy" />` : ""}</span>`).join("")}</span>
          <div class="lineup-row__info">
            ${artist.time
              ? `<span class="lineup-row__time">${escapeHTML(artist.time)}</span>`
              : status === "a-venir" ? `<span class="lineup-row__time">Horaire à confirmer</span>` : ""}
            <span class="lineup-row__live">En ce moment</span>
            <h3>${artist.name ? artistName(artist.name) : "Artiste à renseigner"}</h3>
            ${(artist.style || slotStyle(artist.name)) ? `<p class="lineup-row__style">${escapeHTML(artist.style || slotStyle(artist.name))}</p>` : ""}
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

  // Itinéraire (soirées à venir) : ouvre l'appli GPS du téléphone sur l'adresse de la salle.
  const destination = encodeURIComponent(ev.place || "");
  const routes = ev.place && status === "a-venir"
    ? [
        ["Google Maps", `https://www.google.com/maps/dir/?api=1&destination=${destination}`],
        ["Waze", `https://waze.com/ul?q=${destination}&navigate=yes`],
        ...(/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? [["Plans", `https://maps.apple.com/?daddr=${destination}`]] : [])
      ]
    : [];
  const accessContent = routes.length
    ? `<section class="event-access" aria-labelledby="access-title">
        <p class="event-eyebrow">Y ALLER</p>
        <h2 id="access-title">Itinéraire<span>.</span></h2>
        <p class="event-access__place">${escapeHTML(ev.place)}</p>
        <div class="event-access__links">
          ${routes.map(([label, url]) => `<a href="${escapeHTML(url)}" target="_blank" rel="noopener">${label} <span aria-hidden="true">↗</span></a>`).join("")}
        </div>
      </section>`
    : "";

  const practicalContent = practical
    ? `<section class="event-practical">
        <p class="event-eyebrow">À SAVOIR</p>
        <h2>Infos pratiques<span>.</span></h2>
        <ul>${practical}</ul>
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
        <div class="event-hero__top">
          <p class="event-eyebrow">TEKNO NEVER DIES <span>/</span> EVENT FILE</p>
          <nav class="event-quicklinks" aria-label="Actions rapides">
            ${ev.ticketUrl ? `<a class="is-primary" href="${escapeHTML(ev.ticketUrl)}" target="_blank" rel="noopener">Billetterie ↗</a>` : ""}
            ${status === "a-venir" ? `<button type="button" id="add-to-calendar">Ajouter à l'agenda</button>` : ""}
            ${routes.length ? `<a href="#access-title">Itinéraire</a>` : ""}
            ${ev.gallerySlug ? `<a href="galerie.html#${encodeURIComponent(ev.gallerySlug)}">Voir la galerie</a>` : ""}
            <button type="button" class="js-share">Partager</button>
            <a href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}">Une question ?</a>
          </nav>
        </div>

        <h1 id="event-title">${escapeHTML(ev.title)}<span class="event-title__dot">.</span></h1>

        <p class="event-hero__when">
          ${ev.datePrecision === "month"
            ? `<b>${escapeHTML(dateDay)} ${escapeHTML(dateMonth)}</b>`
            : `<b>${escapeHTML(dateDay)} ${escapeHTML(dateMonth)}</b><span>${escapeHTML(dateYear)}</span>`}
          ${ev.time ? `— ${escapeHTML(ev.time)}` : ""}
          <span>${escapeHTML(ev.place || "Lieu à confirmer")}</span>
        </p>

        ${genres}
        ${demoNote}
        </div>
        ${flyer}
      </div>

    </section>

    <section class="event-lineup" aria-labelledby="lineup-title">
      <div class="event-section-head">
        <h2 id="lineup-title">Line<span>-</span>up<span class="event-title__dot">.</span></h2>
        <p class="event-section-head__note">LES NOMS<br />ET LES FRÉQUENCES.</p>
      </div>
      ${lineupIsPreview ? `<p class="lineup-preview-note">APERÇU — à remplacer avant publication.</p>` : ""}
      ${lineupContent}
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

    ${accessContent}
    ${practicalContent}

    <section class="event-bottom-actions">
      <div class="actions">
        <button type="button" class="event-gallery-link js-share">
          <span>Partager la soirée</span><span aria-hidden="true">↗</span>
        </button>
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
  const range = eventRange(ev);
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