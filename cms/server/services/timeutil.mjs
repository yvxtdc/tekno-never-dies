/**
 * Horaires d'une nuit : "21:00" -> 1260 minutes. Une heure plus petite que le début de la soirée
 * est le lendemain (02:30 après 21:00 = 26:30, soit 1590 minutes).
 */
export const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Minutes depuis le début de la journée de la soirée (après minuit : + 24 h). */
export function nightMinutes(hhmm, eventStart) {
  const t = toMinutes(hhmm);
  if (t === null) return null;
  const start = toMinutes(eventStart);
  if (start === null) return t;
  // Un horaire jusqu'à 2 h avant le début reste le même jour (ex. ouverture des portes).
  return t < start - 120 ? t + 1440 : t;
}

/** "21:00" -> "21h00", "04:00" -> "4h00", "00:00" -> "00h00" (écriture du site). */
export function frenchTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h === 0 ? "00" : h}h${String(m).padStart(2, "0")}`;
}

/** "21h00" ou "21:00" ou "21h" -> "21:00" ; null si illisible. */
export function parseFrenchTime(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})\s*[h:]\s*(\d{2})?$/i);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Plage écrite sur le site : "21h00 – 4h00" ; début seul : "21h00". */
export function frenchRange(start, end) {
  if (!start) return "";
  return end ? `${frenchTime(start)} – ${frenchTime(end)}` : frenchTime(start);
}

/** "21h00 – 4h00" -> { start: "21:00", end: "04:00" } ; null si illisible. */
export function parseFrenchRange(text) {
  const value = String(text || "").trim();
  if (!value) return { start: null, end: null };
  const parts = value.split(/\s*[–—-]\s*/);
  const start = parseFrenchTime(parts[0]);
  const end = parts[1] ? parseFrenchTime(parts[1]) : null;
  if (!start || (parts[1] && !end) || parts.length > 2) return null;
  return { start, end };
}

/** Durée d'un passage, en minutes (gère le passage de minuit). */
export function duration(start, end) {
  const a = toMinutes(start), b = toMinutes(end);
  if (a === null || b === null) return null;
  return b > a ? b - a : b + 1440 - a;
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export function parisToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Instant (ISO UTC ou millisecondes) -> heure de Paris « AAAA-MM-JJTHH:MM » et décalage (« +01:00 »). */
export function utcToParis(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "longOffset"
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const offset = (get("timeZoneName") || "GMT+01:00").replace("GMT", "") || "+00:00";
  return { local: `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`, offset };
}

/**
 * Heure de Paris « AAAA-MM-JJTHH:MM » -> { iso } (UTC) ou { error }.
 * Changement d'heure : au printemps, de 2 h à 3 h n'existe pas (refusé) ; à l'automne, de 2 h à 3 h
 * existe deux fois : la première (heure d'été, UTC+2) est retenue et signalée par ambiguous: true.
 */
export function parisToUtc(local) {
  const m = String(local || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return { error: "Indiquez une date et une heure (JJ/MM/AAAA HH:MM)." };
  const [y, mo, d, hh, mm] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, hh, mm);
  if (new Date(naive).getUTCDate() !== d || hh > 23 || mm > 59) return { error: "Date ou heure invalide." };
  // Paris est à UTC+1 (hiver) ou UTC+2 (été) : seuls ces deux instants peuvent correspondre.
  const matches = [2, 1].map((h) => naive - h * 3600e3).filter((t) => utcToParis(t).local === local);
  if (!matches.length) return { error: "Cette heure n'existe pas à Paris (passage à l'heure d'été : de 2 h à 3 h, l'heure avance d'une heure)." };
  return { iso: new Date(matches[0]).toISOString(), ambiguous: matches.length > 1 };
}
