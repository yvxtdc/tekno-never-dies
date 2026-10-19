/** Formats français (dates, tailles, durées relatives). */
const TZ = "Europe/Paris";

export function formatDate(iso, { weekday = false, month = "long" } = {}) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { ...(weekday ? { weekday: "long" } : {}), day: "numeric", month, year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

export function relative(iso) {
  if (!iso) return "";
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  if (abs < 60) return "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDateTime(iso);
}

export const shortDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return {
    day: String(d),
    month: new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(date).replace(".", ""),
    year: String(y)
  };
};

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} Mo`;
}

export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Date ISO UTC -> valeur d'un <input type="datetime-local"> à l'heure de Paris. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

/** Valeur datetime-local (heure de Paris) -> ISO UTC. */
export function fromLocalInput(value) {
  if (!value) return "";
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Décalage de Paris à cette date (heure d'été / d'hiver)
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const v = (k) => Number(p.find((x) => x.type === k).value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute")) - t;
  };
  return new Date(guess - offset(guess)).toISOString();
}
