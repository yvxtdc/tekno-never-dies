/**
 * Données structurées d'une soirée (schema.org/Event, résultats enrichis Google) : date de début et
 * de fin, lieu, tarif, visuel. Écrites dans chaque fiche evenement-….html par tools/event-pages.mjs.
 *
 * Le résultat ne dépend que de js/data (pas de la date du jour) : la fiche générée reste identique
 * d'un jour à l'autre, et npm run validate peut vérifier qu'elle est à jour.
 */
import { SITE } from "../data/site.js";
import { eventPath, safeUrl } from "../pages/helpers.js";
import { eventTimes, parisOffset } from "../pages/ics.js";
import { visibleLineup } from "./artists.js";

const pad = (n) => String(n).padStart(2, "0");
const iso = ({ y, mo, d, h, mi }) => `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00`;
const dateOf = ({ y, mo, d }) => `${y}-${pad(mo)}-${pad(d)}`;

export function eventSchema(ev) {
  const pageUrl = new URL(eventPath(ev.slug), SITE.url).href;
  const ticketUrl = safeUrl(ev.ticketUrl);
  const visual = ev.flyer || ev.cover;
  const times = ev.datePrecision !== "month" && ev.time ? eventTimes(ev) : null;
  const [placeName, ...placeRest] = (ev.place || "").split(",").map((part) => part.trim());
  const price = ev.price?.match(/\d+(?:[.,]\d+)?/)?.[0];
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: ev.title,
    description: ev.description,
    url: pageUrl,
    startDate: times ? iso(times.start) + parisOffset(dateOf(times.start), times.start.h) : ev.date,
    ...(times ? { endDate: iso(times.end) + parisOffset(dateOf(times.end), times.end.h) } : {}),
    eventStatus: ev.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
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
    ...(ev.lineup?.length ? { performer: visibleLineup(ev).filter((artist) => !artist.mystery).map((artist) => ({ "@type": "PerformingGroup", name: artist.name })) } : {}),
    ...(price
      ? {
          offers: {
            "@type": "Offer",
            price: price.replace(",", "."),
            priceCurrency: "EUR",
            // Billetterie en ligne = places disponibles. Google ignore de lui-même les soirées passées.
            ...(ticketUrl ? { availability: "https://schema.org/InStock" } : {}),
            url: ticketUrl || pageUrl
          }
        }
      : {}),
    organizer: { "@type": "Organization", name: SITE.official.legalName, url: SITE.url }
  };
}
