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

const DEFAULT_HOURS = 4;

// Fuseau Europe/Paris (heure d'été / heure d'hiver), reconnu par Google Agenda,
// Apple Calendrier et Outlook.
const VTIMEZONE = [
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
      out.push(current);
      current = ch;
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

function vevent(ev, baseUrl, stamp) {
  const { allDay, start, end } = eventTimes(ev);
  const url = new URL(`evenement.html?slug=${ev.slug}`, baseUrl).href;
  const description = [ev.description, ...(ev.practical || []).map((p) => `• ${p}`), "", url]
    .filter((x) => x !== undefined)
    .join("\n");
  return [
    "BEGIN:VEVENT",
    `UID:${ev.slug}@tekno-never-dies`,
    `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${fmtDay(start)}` : `DTSTART;TZID=Europe/Paris:${fmtLocal(start)}`,
    allDay ? `DTEND;VALUE=DATE:${fmtDay(end)}` : `DTEND;TZID=Europe/Paris:${fmtLocal(end)}`,
    `SUMMARY:${esc(ev.title)} — Tekno Never Dies`,
    `LOCATION:${esc(ev.place)}`,
    `DESCRIPTION:${esc(description)}`,
    `URL:${url}`,
    "ORGANIZER;CN=Tekno Never Dies:mailto:tnd6tem@gmail.com",
    "END:VEVENT"
  ];
}

/** Construit le texte complet du fichier .ics pour une liste d'événements. */
export function buildICS(events, baseUrl = location.href) {
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
    ...events.flatMap((ev) => vevent(ev, baseUrl, stamp)),
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
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
