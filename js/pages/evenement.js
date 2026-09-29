import { EVENTS } from "../data/events.js";
import { formatDate, readParam } from "./helpers.js";
import { downloadICS, parisOffset } from "./ics.js";

const root = document.getElementById("event-detail");
const ev = EVENTS.find((event) => event.slug === readParam("slug"));

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

const timeToMinutes = (value = "") => {
  const match = value.match(/(\d{1,2})h(\d{2})/i);

  return match
    ? Number(match[1]) * 60 + Number(match[2])
    : null;
};

/**
 * Trie les artistes selon leur horaire.
 * Une heure après minuit est replacée après les sets de la veille.
 */
const orderedLineup = (lineup = [], eventStart = "") => {
  const start = timeToMinutes(eventStart) ?? 0;

  return lineup
    .map((artist, index) => ({
      ...artist,
      _index: index
    }))
    .sort((a, b) => {
      const aTime = timeToMinutes(a.time);
      const bTime = timeToMinutes(b.time);

      if (aTime === null && bTime === null) {
        return (a.order ?? a._index) - (b.order ?? b._index);
      }

      if (aTime === null) return 1;
      if (bTime === null) return -1;

      const aRelative = aTime < start ? aTime + 1440 : aTime;
      const bRelative = bTime < start ? bTime + 1440 : bTime;

      return aRelative - bRelative;
    });
};

if (!root) {
  console.error(
    'TND : conteneur "#event-detail" introuvable.'
  );
} else if (!ev) {
  root.innerHTML = `
    <section class="event-not-found">
      <p class="event-eyebrow">TND / ARCHIVES</p>
      <h1>Événement introuvable<span>.</span></h1>
      <p>Cette page n'existe pas ou n'est plus disponible.</p>
      <a class="btn btn-line" href="evenements.html">
        Retour aux événements
      </a>
    </section>
  `;
} else {
  document.title = `${ev.title} — Tekno Never Dies`;

  // Données structurées pour les moteurs de recherche.
  const startTime = (
    ev.time?.match(/\d{1,2}h\d{2}/)?.[0] || "20h00"
  ).replace("h", ":");

  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: ev.title,
    description: ev.description,
    startDate:
      `${ev.date}T${startTime}:00` +
      parisOffset(ev.date, Number(startTime.split(":")[0])),
    location: {
      "@type": "Place",
      name: ev.place
    },
    organizer: {
      "@type": "Organization",
      name: "TEKNO NEVER DIES"
    }
  };

  const schema = document.createElement("script");
  schema.type = "application/ld+json";
  schema.textContent = JSON.stringify(eventSchema);
  document.head.append(schema);

  const [dateDay, dateMonth, dateYear] =
    formatDate(ev.date).split(" ");

  const coverImage = ev.heroImage || ev.cover;

  const cover = coverImage
    ? `style="--event-cover:url('${escapeHTML(coverImage)}')"`
    : "";

  const ticket = ev.ticketUrl
    ? `
      <a
        class="btn btn-solid"
        href="${escapeHTML(ev.ticketUrl)}"
        target="_blank"
        rel="noopener"
      >
        Billetterie <span aria-hidden="true">↗</span>
      </a>
    `
    : "";

  const practical = (ev.practical || [])
    .map((item) => `<li>${escapeHTML(item)}</li>`)
    .join("");

  const galleryLink = ev.gallerySlug
    ? `
      <a
        class="event-gallery-link"
        href="galerie.html#${encodeURIComponent(ev.gallerySlug)}"
      >
        <span>Voir les images de la nuit</span>
        <span aria-hidden="true">↗</span>
      </a>
    `
    : "";

  const lineup = orderedLineup(ev.lineup || [], ev.time);
  const lineupIsPreview = Boolean(ev.lineupPreview);

  const lineupContent = lineup.length
    ? lineup.map((artist, index) => `
        <article
          class="lineup-card${artist.demo ? " lineup-card--placeholder" : ""}"
          style="--artist-index:${index}"
        >
          <div class="lineup-card__visual">
            ${
              artist.image
                ? `
                  <img
                    src="${escapeHTML(artist.image)}"
                    alt="${escapeHTML(
                      artist.name || "Portrait artiste à renseigner"
                    )}"
                    loading="lazy"
                  />
                `
                : `
                  <div class="lineup-card__no-image" aria-hidden="true">
                    <span>TND</span>
                    <b>✳</b>
                  </div>
                `
            }

            <span class="lineup-card__number">
              ${String(index + 1).padStart(2, "0")}
            </span>

            ${
              artist.demo
                ? `<span class="lineup-card__draft">À compléter</span>`
                : ""
            }
          </div>

          <div class="lineup-card__info">
            <div class="lineup-card__time">
              ${
                artist.time
                  ? escapeHTML(artist.time)
                  : "Horaire à confirmer"
              }
            </div>

            <h3>
              ${escapeHTML(artist.name || "Artiste à renseigner")}
            </h3>

            <p>
              ${escapeHTML(artist.style || "Style à renseigner")}
            </p>

            ${
              artist.collective
                ? `
                  <span class="lineup-card__collective">
                    ${escapeHTML(artist.collective)}
                  </span>
                `
                : ""
            }
          </div>
        </article>
      `).join("")
    : `
      <div class="lineup-empty">
        <span class="lineup-empty__symbol" aria-hidden="true">✳</span>

        <div>
          <p class="event-eyebrow">PROGRAMMATION</p>
          <h3>Le line-up arrive bientôt.</h3>
          <p>
            Les artistes, leurs photos, leurs styles et leurs horaires
            seront ajoutés ici.
          </p>
        </div>
      </div>
    `;

  const demoNote = ev.demo
    ? `
      <p class="event-draft-note">
        <span aria-hidden="true">✳</span>
        Fiche de démonstration — informations à confirmer avant publication.
      </p>
    `
    : "";

  const practicalContent = practical
    ? `
      <section class="event-practical">
        <p class="event-eyebrow">À SAVOIR</p>
        <h2>Infos pratiques<span>.</span></h2>
        <ul>${practical}</ul>
      </section>
    `
    : "";

  root.innerHTML = `
    <a class="back-link event-back-link" href="evenements.html">
      <span aria-hidden="true">←</span>
      Tous les événements
    </a>

    <!-- HERO -->

    <section
      class="event-hero"
      ${cover}
      aria-labelledby="event-title"
    >
      <div class="event-hero__grain" aria-hidden="true"></div>

      <div class="event-hero__copy">
        <p class="event-eyebrow">
          TEKNO NEVER DIES <span>/</span> EVENT FILE
        </p>

        <p class="event-hero__index">
          ARCHIVES <span>—</span> ${escapeHTML(dateYear)}
        </p>

        <h1 id="event-title">
          ${escapeHTML(ev.title)}<span class="event-title__dot">.</span>
        </h1>

        <p class="event-hero__description">
          ${escapeHTML(ev.description || "Une nuit signée Tekno Never Dies.")}
        </p>

        ${demoNote}
      </div>

      <div class="event-hero__visual" aria-hidden="true">
        <div class="event-hero__visual-frame">
          <img
            src="${escapeHTML(ev.cover || "assets/img/decor/star-pair.webp")}"
            alt=""
            fetchpriority="high"
          />
        </div>

        <div class="event-hero__orbit">
          <span>NO SLEEP</span>
          <span>PURE FREQUENCY</span>
          <span>TND6TEM</span>
        </div>

        <span class="event-hero__cross event-hero__cross--one">✳</span>
        <span class="event-hero__cross event-hero__cross--two">+</span>
      </div>

      <div class="event-hero__bottom">
        <span>UNDERGROUND CULTURE / EST. TND</span>
        <span>01 — 04 / LIVE ARCHIVE</span>
      </div>
    </section>

    <!-- INFORMATIONS PRINCIPALES -->

    <section class="event-facts" aria-label="Date, horaires et lieu">
      <div class="event-fact event-fact--date">
        <span class="event-fact__label">DATE / ${escapeHTML(dateYear)}</span>

        <strong>
          ${escapeHTML(dateDay)}
          <em>${escapeHTML(dateMonth)}</em>
        </strong>

        <span class="event-fact__sub">Une nuit à part.</span>
      </div>

      <div class="event-fact">
        <span class="event-fact__label">DOORS / TIME</span>
        <strong>${escapeHTML(ev.time || "Horaire à confirmer")}</strong>
        <span class="event-fact__sub">Horaires de l'événement</span>
      </div>

      <div class="event-fact">
        <span class="event-fact__label">LOCATION</span>
        <strong>${escapeHTML(ev.place || "Lieu à confirmer")}</strong>
        <span class="event-fact__sub">Lieu de la soirée</span>
      </div>

      <div class="event-fact event-fact--action">
        <span class="event-fact__label">BE THERE</span>

        ${
          ticket ||
          `
            <a
              class="event-text-link"
              href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}"
            >
              Une question ? <span aria-hidden="true">↗</span>
            </a>
          `
        }
      </div>
    </section>

    <!-- LINE-UP -->

    <section class="event-lineup" aria-labelledby="lineup-title">
      <div class="event-section-head">
        <div>
          <p class="event-eyebrow">THE SOUND / THE PEOPLE</p>

          <h2 id="lineup-title">
            Line<span>-</span>up<span class="event-title__dot">.</span>
          </h2>
        </div>

        <p class="event-section-head__note">
          LES NOMS, LES VISAGES<br />
          ET LES FRÉQUENCES.
        </p>
      </div>

      ${
        lineupIsPreview
          ? `
            <p class="lineup-preview-note">
              APERÇU DE MISE EN PAGE — remplacer les portraits,
              noms, styles et horaires avant publication.
            </p>
          `
          : ""
      }

      <div class="lineup-grid">${lineupContent}</div>

      ${
        lineup.length
          ? `
            <p class="lineup-footnote">
              <span>↳</span>
              ${
                lineup.some((artist) => artist.demo)
                  ? "Les champs de démonstration sont à remplacer par les informations confirmées."
                  : "Ordre de passage chronologique, y compris après minuit."
              }
            </p>
          `
          : ""
      }
    </section>

    <!-- RÉCIT ET GALERIE -->

    <section class="event-story">
      <div class="event-story__label">
        <span>01</span>
        <span>THE NIGHT</span>
      </div>

      <div class="event-story__body">
        <p class="event-eyebrow">UNE NUIT / UN SOUND SYSTEM</p>

        <h2>
          Built for<br />
          <span>the dancefloor.</span>
        </h2>

        <p>
          ${escapeHTML(ev.description || "Une nuit signée Tekno Never Dies.")}
        </p>

        ${galleryLink}
      </div>

      <div class="event-story__stamp" aria-hidden="true">
        <span>TND</span>
        <b>✳</b>
        <small>NEVER DIES</small>
      </div>
    </section>

    ${practicalContent}

    <!-- ACTIONS DE FIN -->

    <section class="event-bottom-actions">
      <div>
        <p class="event-eyebrow">TND / KEEP IN TOUCH</p>

        <h2>
          On se retrouve<br />
          <span>au prochain son.</span>
        </h2>
      </div>

      <div class="actions">
        ${
          ev.status === "a-venir"
            ? `
              <button
                class="btn btn-line"
                type="button"
                id="add-to-calendar"
              >
                Ajouter à mon agenda
              </button>
            `
            : ""
        }

        <a
          class="btn btn-line"
          href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}"
        >
          Contacter l'équipe <span aria-hidden="true">↗</span>
        </a>

        <a class="btn btn-solid" href="evenements.html">
          Tous les événements
        </a>
      </div>
    </section>
  `;

  document
    .getElementById("add-to-calendar")
    ?.addEventListener("click", () => {
      downloadICS([ev], `tnd-${ev.slug}.ics`);
    });
}