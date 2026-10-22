/**
 * Génère un fichier calendrier (.ics) à partir des données de js/data/events.js.
 * Rien à maintenir à la main : dès qu'un événement est ajouté ou modifié dans
 * events.js, le fichier téléchargé est à jour.
 *
 * Format des horaires compris dans events.js → champ "time" :
 *   "22h00 – 5h00"  → début 22h00, fin 5h00 le lendemain
 *   "14h00 – 19h00" → début 14h00, fin 19h00
 *   "21h00"         → début 21h00, durée par défaut de 4 h
 *   (vide)          → événement sur la journée entière
 */

import { SITE } from "../data/site.js";
import { formatTime } from "./helpers.js";
import { tr, locale } from "../i18n/i18n.js";
import { eventCalendarDetails } from "../components/event-ics.js";

const DEFAULT_HOURS = 4;

// Fuseau Europe/Paris (heure d'été / heure d'hiver), reconnu par Google Agenda,
// Apple Calendrier et Outlook.
export const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE"
];

const pad = (n) => String(n).padStart(2, "0");

/** Échappe les caractères spéciaux du format iCalendar. */
function esc(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Coupe les lignes trop longues (75 octets max, règle du format .ics). */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let current = "";
  for (const ch of line) {
    const limit = out.length ? 74 : 75; // les lignes suivantes commencent par une espace
    if (enc.encode(current + ch).length > limit) {
      const carriesSpace = /\s$/.test(current);
      out.push(carriesSpace ? current.trimEnd() : current);
      current = (carriesSpace ? " " : "") + ch;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

/** "22h00" → { h: 22, m: 0 } */
function parseHour(str) {
  const m = str?.match(/(\d{1,2})\s*h\s*(\d{2})?/i);
  return m ? { h: Number(m[1]), m: Number(m[2] || 0) } : null;
}

/** Ajoute des minutes à une date "locale" {y,mo,d,h,mi} sans dépendre du fuseau du visiteur. */
function addMinutes({ y, mo, d, h, mi }, minutes) {
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi) + minutes * 60000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

const fmtLocal = (x) => `${x.y}${pad(x.mo)}${pad(x.d)}T${pad(x.h)}${pad(x.mi)}00`;
const fmtDay = (x) => `${x.y}${pad(x.mo)}${pad(x.d)}`;

/** Début / fin d'un événement à partir de ses champs "date" et "time". */
export function eventTimes(ev) {
  const [y, mo, d] = ev.date.split("-").map(Number);
  const [startStr, endStr] = (ev.time || "").split(/[–—-]/);
  const s = parseHour(startStr);
  if (!s) {
    return { allDay: true, start: { y, mo, d }, end: addMinutes({ y, mo, d, h: 0, mi: 0 }, 24 * 60) };
  }
  const start = { y, mo, d, h: s.h, mi: s.m };
  const e = parseHour(endStr);
  let minutes = DEFAULT_HOURS * 60;
  if (e) {
    minutes = e.h * 60 + e.m - (s.h * 60 + s.m);
    if (minutes <= 0) minutes += 24 * 60; // fin après minuit → lendemain
  }
  return { allDay: false, start, end: addMinutes(start, minutes) };
}

/** Décalage horaire de Paris pour une date : "+01:00" (hiver) ou "+02:00" (été). */
export function parisOffset(isoDate, hour = 12) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const lastSunday = (month) => {
    const last = new Date(Date.UTC(y, month, 0)); // dernier jour du mois
    return last.getUTCDate() - last.getUTCDay();
  };
  const key = mo * 10000 + d * 100 + hour;
  const summerStart = 3 * 10000 + lastSunday(3) * 100 + 2;
  const summerEnd = 10 * 10000 + lastSunday(10) * 100 + 3;
  return key >= summerStart && key < summerEnd ? "+02:00" : "+01:00";
}

/** { y, mo, d, h, mi } (heure de Paris) -> Date */
export function partsToDate({ y, mo, d, h = 0, mi = 0 }) {
  const isoDate = `${y}-${pad(mo)}-${pad(d)}`;
  return new Date(`${isoDate}T${pad(h)}:${pad(mi)}:00${parisOffset(isoDate, h)}`);
}

/**
 * Début et fin réels (Date) d'une soirée, ou d'un créneau du line-up si `time` est donné
 * ("1h00 – 2h30" pour une soirée qui commence à 21h00 = le lendemain). null sans horaire.
 */
export function eventRange(ev, time = ev.time) {
  if (ev.datePrecision === "month") return null;
  const slot = eventTimes({ date: ev.date, time });
  if (slot.allDay) return null;
  let start = partsToDate(slot.start);
  let end = partsToDate(slot.end);
  const evStart = parseHour(ev.time);
  if (time !== ev.time && evStart && slot.start.h * 60 + slot.start.mi < evStart.h * 60 + evStart.m) {
    start = new Date(start.getTime() + 864e5);
    end = new Date(end.getTime() + 864e5);
  }
  return { start, end };
}

function vevent(ev, stamp) {
  const { allDay, start, end } = eventTimes(ev);
  // Titre, description, lieu, lien et rappel : js/components/event-ics.js (comme l'agenda d'abonnement),
  // dans la langue de la page.
  const details = eventCalendarDetails(ev, { tr, locale, time: formatTime });
  return [
    "BEGIN:VEVENT",
    // Même identifiant que l'agenda d'abonnement : une soirée ajoutée des deux façons n'apparaît qu'une fois.
    `UID:${ev.slug}@tekno-never-dies.fr`,
    `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${fmtDay(start)}` : `DTSTART;TZID=Europe/Paris:${fmtLocal(start)}`,
    allDay ? `DTEND;VALUE=DATE:${fmtDay(end)}` : `DTEND;TZID=Europe/Paris:${fmtLocal(end)}`,
    `SUMMARY:${esc(details.summary)}`,
    `LOCATION:${esc(details.location)}`,
    `DESCRIPTION:${esc(details.description)}`,
    `URL:${details.url}`,
    ...(details.categories.length ? [`CATEGORIES:${details.categories.map(esc).join(",")}`] : []),
    `ORGANIZER;CN=Tekno Never Dies:mailto:${SITE.email}`,
    ...details.alarms.flatMap((alarm) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:${alarm.trigger}`,
      `DESCRIPTION:${esc(alarm.text)}`,
      "END:VALARM"
    ]),
    "END:VEVENT"
  ];
}

/** Construit le texte complet du fichier .ics pour une liste d'événements. */
export function buildICS(events) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tekno Never Dies//Agenda//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Tekno Never Dies",
    "X-WR-TIMEZONE:Europe/Paris",
    ...VTIMEZONE,
    ...events.filter((ev) => ev.datePrecision !== "month").flatMap((ev) => vevent(ev, stamp)),
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Lien « ajouter à Google Agenda » d'une soirée : mêmes horaires (heure de Paris), titre, lieu et
 * description que le fichier .ics. Sur Android, Google Agenda ne sait pas importer un .ics téléchargé :
 * ce lien ouvre directement la fiche d'ajout (appli ou site).
 */
export function googleCalendarUrl(ev) {
  const { allDay, start, end } = eventTimes(ev);
  const details = eventCalendarDetails(ev, { tr, locale, time: formatTime });
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: details.summary,
    dates: allDay ? `${fmtDay(start)}/${fmtDay(end)}` : `${fmtLocal(start)}/${fmtLocal(end)}`,
    ctz: "Europe/Paris",
    details: details.description,
    location: details.location
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Fait télécharger le fichier .ics au visiteur. */
export function downloadICS(events, filename) {
  const blob = new Blob([buildICS(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
