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
