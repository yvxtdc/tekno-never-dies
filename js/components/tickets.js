/**
 * Billets d'une soirée (js/data/events.js, champ tickets, saisi dans le CMS) : tarifs successifs
 * (Early, Regular, Late…) puis la caisse du soir, toujours en dernier.
 *   { label, price, note?, status?: "soldout" | "soon" | "closed", until?: "AAAA-MM-JJ", door?: true }
 * Partagé par la fiche soirée, les données structurées (Google) et les résumés de prix.
 */
import { t, tr, locale } from "../i18n/i18n.js";

/** Caisse du soir en dernier, ordre des autres conservé. */
export const sortedTickets = (ev) => {
  const list = Array.isArray(ev?.tickets) ? ev.tickets.filter((ticket) => ticket && ticket.label) : [];
  return [...list.filter((ticket) => !ticket.door), ...list.filter((ticket) => ticket.door)];
};

/** Jour actuel à Paris (AAAA-MM-JJ), pour les fins de vente. */
const parisToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());

/** État affiché : available, soldout, soon ou closed (fin de vente passée = closed). */
export function ticketState(ticket, today = parisToday()) {
  const status = ["soldout", "soon", "closed"].includes(ticket.status) ? ticket.status : "available";
  if (status !== "soldout" && ticket.until && today > ticket.until) return "closed";
  return status;
}

/** 10 -> « 10 € », 12.5 -> « 12,50 € », 0 -> « Gratuit ». */
export function formatPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return tr("Gratuit");
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
}

/** Résumé pour le haut de la fiche et l'accueil : le texte saisi, sinon « Dès 10 € ». */
export function priceSummary(ev) {
  if (ev.price) return tr(ev.price);
  const prices = sortedTickets(ev).map((ticket) => Number(ticket.price)).filter(Number.isFinite);
  if (!prices.length) return "";
  const min = Math.min(...prices);
  return min === 0 && prices.every((p) => p === 0) ? tr("Gratuit") : t("Dès {price}", { price: formatPrice(min) });
}
