/**
 * Contenu d'une soirée dans un agenda (.ics), partagé par :
 *   - tools/generate-calendar.mjs : l'agenda auquel on s'abonne (calendar/events.ics) ;
 *   - js/pages/ics.js : le fichier téléchargé par « Ajouter à l'agenda » sur une fiche.
 * Tout vient de js/data/events.js : rien à écrire en double.
 *
 * Renvoie du texte brut (titre, description, lieu, lien, catégories, rappels) ; chaque générateur
 * l'échappe et le met en forme iCalendar lui-même.
 *
 * Options (fichier téléchargé depuis une page allemande ou anglaise) :
 *   tr      traduction d'un texte français (js/i18n/i18n.js) ;
 *   locale  langue des dates ("fr-FR", "de-DE", "en-GB") ;
 *   time    mise en forme des horaires ("21h00" ou "21:00").
 */
import { SITE } from "../data/site.js";
import { eventPath, safeUrl } from "../pages/helpers.js";

const same = (text) => text;

/** "2026-11-28" -> "Samedi 28 novembre 2026" (sans le jour de la semaine si seul le mois est connu) */
function longDate(ev, locale) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const options = ev.datePrecision === "month"
    ? { month: "long", year: "numeric" }
    : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  const text = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function eventCalendarDetails(ev, { tr = same, locale = "fr-FR", time = same } = {}) {
  const t = (template, vars = {}) => tr(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const pageUrl = new URL(eventPath(ev.slug), SITE.url).href;
  const ticketUrl = safeUrl(ev.ticketUrl);
  const genres = (ev.genres || []).join(" · ");
  const lineup = (ev.lineup || []).filter((slot) => slot.name);
  // L'âge et l'horaire de début ont déjà leur ligne : pas de doublon dans les infos pratiques.
  const practical = (ev.practical || []).filter((item) => item !== ev.age && !/^Début\s*:/i.test(item));
  // « Billetterie : … » en français, « Tickets: … » en allemand et en anglais
  const colon = locale.startsWith("fr") ? " : " : ": ";

  const description = [
    `🔊 ${ev.title}${genres ? ` — ${genres}` : ""}`,
    ev.description ? tr(ev.description) : null,
    "",
    `📅 ${longDate(ev, locale)}`,
    ev.time ? `🕘 ${time(ev.time)}` : null,
    ev.place ? `📍 ${ev.place}` : null,
    ev.price ? `💶 ${tr(ev.price)}` : null,
    ev.age ? `🔞 ${tr(ev.age)}` : null,
    ...(lineup.length
      ? ["", `🎧 ${tr("Line-up")}`, ...lineup.map((slot) =>
          `${slot.time ? `${time(slot.time)} · ` : "• "}${slot.name}${slot.style ? ` (${tr(slot.style)})` : ""}`)]
      : []),
    ...(practical.length ? ["", `ℹ️ ${tr("Infos pratiques")}`, ...practical.map((item) => `• ${tr(item)}`)] : []),
    "",
    ticketUrl ? `🎟️ ${tr("Billetterie")}${colon}${ticketUrl}` : null,
    `🌐 ${tr("Fiche de la soirée")}${colon}${pageUrl}`,
    `📸 Instagram${colon}@tnd6tem`
  ].filter((line) => line !== null);

  return {
    summary: `🔊 ${ev.title} · Tekno Never Dies`,
    description: description.join("\n"),
    location: ev.place || "",
    url: pageUrl,
    categories: ev.genres || [],
    // Rappel une semaine avant (affiché par Apple Calendrier, Outlook, Thunderbird… ;
    // Google Agenda applique ses propres rappels par défaut).
    alarms: [{ trigger: "-P7D", text: t("Dans une semaine : {title} 🎟️", { title: ev.title }) }]
  };
}
