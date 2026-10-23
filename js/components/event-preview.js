/**
 * Aperçu d'une soirée quand on partage le lien de sa fiche (WhatsApp, Instagram, Messenger, iMessage…) :
 * titre avec la date et description factuelle, courte (les applis coupent vers 150-200 caractères).
 * Utilisé par tools/event-pages.mjs (fiches françaises) et tools/langues.mjs (de/ et en/).
 *
 *   « ICE BOILER v2 · 28 novembre 2026 »
 *   « Samedi 28 novembre 2026, 21h00 – 4h00 · Salle polyvalente, 81 rue du Rhin, Munchhausen.
 *     Trance · Groovy · Bouncy · Techno. 10 à 16 € en prévente, 18 € sur place. »
 */
const same = (text) => text;

function formatDate(ev, locale, weekday) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const options = ev.datePrecision === "month"
    ? { month: "long", year: "numeric" }
    : { ...(weekday ? { weekday: "long" } : {}), day: "numeric", month: "long", year: "numeric" };
  const text = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function eventPreview(ev, { tr = same, locale = "fr-FR", time = same } = {}) {
  const when = [formatDate(ev, locale, true), ev.time ? time(ev.time) : ""].filter(Boolean).join(", ");
  const parts = [
    // Soirée annulée : dit en premier (l'aperçu garde la date pour les personnes qui l'avaient notée).
    ev.cancelled ? tr("Soirée annulée") : "",
    [when, ev.place].filter(Boolean).join(" · "),
    (ev.genres || []).join(" · "),
    ev.price ? tr(ev.price) : ""
  ].filter(Boolean);
  return {
    title: `${ev.title} · ${formatDate(ev, locale, false)}`,
    description: parts.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`)).join(" ")
  };
}
