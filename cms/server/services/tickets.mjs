/**
 * Billets d'une soirée : tarifs successifs (early, regular, late…) puis la caisse du soir, et
 * DJ Contest (place à gagner au line-up). Stockés en JSON dans events.tickets et events.contest.
 *
 * Un tarif : { label, price, note, status, until, door }
 *  - price : prix en euros (0 = gratuit) ;
 *  - status : available (en vente), soldout (épuisé : grisé sur le site), soon (bientôt), closed (terminé) ;
 *  - until : dernier jour de vente (facultatif) : passé ce jour, le site l'affiche « terminé » ;
 *  - door : caisse du soir, toujours rangée en dernier (une seule).
 */
import { cleanText, isValidDate } from "./validation.mjs";

export const TICKET_STATUSES = {
  available: "En vente",
  soldout: "Épuisé",
  soon: "Bientôt",
  closed: "Terminé"
};
export const MAX_TICKETS = 8;

/** Caisse du soir en dernier, ordre des autres conservé. */
export const sortTickets = (tickets) => [...tickets.filter((t) => !t.door), ...tickets.filter((t) => t.door)];

/** Forme complète d'un tarif (lecture de la base : champs manquants complétés). */
export const normalizeTicket = (t = {}) => ({
  label: String(t.label ?? ""),
  price: t.price === null || t.price === undefined || t.price === "" ? null : Number(t.price),
  note: String(t.note ?? ""),
  status: TICKET_STATUSES[t.status] ? t.status : "available",
  until: String(t.until ?? ""),
  door: Boolean(t.door)
});

/**
 * Valide la liste envoyée par l'interface. Renvoie { tickets, errors } ; errors : { "tickets.0.price": "…" }.
 */
export function validateTickets(raw) {
  const errors = {};
  if (raw === undefined) return { tickets: [], errors };
  if (!Array.isArray(raw)) return { tickets: [], errors: { tickets: "Liste de tarifs invalide." } };
  const tickets = [];
  for (const [i, item] of raw.entries()) {
    const n = i + 1;
    const label = cleanText(item?.label);
    const note = cleanText(item?.note);
    const priceText = cleanText(item?.price).replace(",", ".").replace(/\s*€$/, "");
    // Ligne laissée entièrement vide : ignorée.
    if (!label && !note && !priceText) continue;
    const price = priceText === "" ? null : Number(priceText);
    const until = cleanText(item?.until);
    const status = item?.status || "available";
    if (!label) errors[`tickets.${i}.label`] = `Tarif ${n} : le nom est obligatoire (ex. « Early », « Caisse du soir »).`;
    else if (label.length > 40) errors[`tickets.${i}.label`] = `Tarif ${n} : nom trop long (40 caractères maximum).`;
    if (price === null) errors[`tickets.${i}.price`] = `Tarif ${n} : indiquez le prix (0 pour une entrée gratuite).`;
    else if (!Number.isFinite(price) || price < 0 || price > 999) errors[`tickets.${i}.price`] = `Tarif ${n} : prix invalide (nombre entre 0 et 999).`;
    else if (Math.round(price * 100) !== price * 100) errors[`tickets.${i}.price`] = `Tarif ${n} : deux décimales maximum.`;
    if (note.length > 120) errors[`tickets.${i}.note`] = `Tarif ${n} : précision trop longue (120 caractères maximum).`;
    if (!TICKET_STATUSES[status]) errors[`tickets.${i}.status`] = `Tarif ${n} : état inconnu.`;
    if (until && !isValidDate(until)) errors[`tickets.${i}.until`] = `Tarif ${n} : date de fin de vente invalide.`;
    tickets.push({ label, price, note, status: TICKET_STATUSES[status] ? status : "available", until, door: Boolean(item?.door) });
  }
  if (tickets.length > MAX_TICKETS) errors.tickets = `${MAX_TICKETS} tarifs maximum.`;
  if (tickets.filter((t) => t.door).length > 1) errors.tickets = "Une seule caisse du soir par soirée.";
  return { tickets: sortTickets(tickets), errors };
}

/** Tarif au format de js/data/events.js : champs par défaut omis. */
export const exportTicket = (t) => ({
  label: t.label,
  price: t.price,
  ...(t.note ? { note: t.note } : {}),
  ...(t.status && t.status !== "available" ? { status: t.status } : {}),
  ...(t.until ? { until: t.until } : {}),
  ...(t.door ? { door: true } : {})
});

/** Forme complète du DJ Contest (lecture de la base). */
export const normalizeContest = (c = {}) => ({
  email: String(c.email ?? ""),
  deadline: String(c.deadline ?? ""),
  text: String(c.text ?? "")
});

/** DJ Contest au format du site : champs vides omis. */
export const exportContest = (c) => Object.fromEntries(Object.entries(normalizeContest(c)).filter(([, v]) => v));
