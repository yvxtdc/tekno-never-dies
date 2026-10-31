/**
 * Événements (soirées) : fiche, line-up, photos « La soirée », statuts de publication.
 *
 * Statuts :
 *  - draft      brouillon, invisible sur le site ;
 *  - scheduled  mise en ligne programmée (publish_at) : une programmation (services/schedule.mjs) la publie
 *               à l'heure dite ;
 *  - published  visible sur le site ;
 *  - cancelled  visible, marquée « annulée » (agenda .ics : STATUS:CANCELLED) ;
 *  - archived   retirée du site mais conservée (restaurable en brouillon).
 * « À venir » / « passée » reste calculé par le site à partir de la date, comme avant.
 */
import crypto from "node:crypto";
import { now, fromJson } from "../db/index.mjs";
import { badRequest, conflict, notFound, ValidationError } from "../http/errors.mjs";
import { Validator, cleanText } from "./validation.mjs";
import { uniqueSlug, slugify } from "./slug.mjs";
import { like, saveRevision } from "./audit.mjs";
import { serializeMedia } from "./media.mjs";
import { serializeVenue, venuePlace } from "./venues.mjs";
import { nightMinutes, duration, parisToday } from "./timeutil.mjs";
import { validateTickets, normalizeTicket, normalizeContest, sortTickets } from "./tickets.mjs";

export const STATUSES = {
  draft: "Brouillon",
  scheduled: "Programmé",
  published: "Publié",
  cancelled: "Annulé",
  archived: "Archivé"
};
export const PUBLIC_STATUSES = ["published", "cancelled"];

const MAX_SLOTS = 40;
const MAX_PHOTOS = 2;

/* ---------- Lecture ---------- */

export function loadLineup(db, eventId) {
  const slots = db.all("SELECT * FROM lineup_slots WHERE event_id = ? ORDER BY position", eventId);
  const artists = db.all(
    `SELECT la.slot_id, la.position, a.id, a.name, a.styles, a.instagram_url, a.photo_media_id, a.archived, a.mystery FROM lineup_slot_artists la
       JOIN artists a ON a.id = la.artist_id JOIN lineup_slots s ON s.id = la.slot_id WHERE s.event_id = ? ORDER BY la.slot_id, la.position`,
    eventId
  );
  return slots.map((s) => ({
    id: s.id,
    uid: s.uid,
    position: s.position,
    label: s.label,
    style: s.style,
    startTime: s.start_time,
    endTime: s.end_time,
    notes: s.notes,
    artists: artists
      .filter((a) => a.slot_id === s.id)
      .map((a) => ({
        id: a.id,
        name: a.name,
        styles: a.styles,
        instagramUrl: a.instagram_url,
        archived: Boolean(a.archived),
        mystery: Boolean(a.mystery),
        photo: a.photo_media_id ? { id: a.photo_media_id, thumbUrl: `/api/media/${a.photo_media_id}/thumb` } : null
      }))
  }));
}

/** Nom affiché d'un passage : nom spécifique, sinon noms des fiches reliés par « B2B ». */
export const slotName = (slot) => slot.label || slot.artists.map((a) => a.name).join(" B2B ");

export function getEventRow(db, id) {
  const row = db.get("SELECT * FROM events WHERE id = ?", id);
  if (!row) throw notFound("Événement introuvable.");
  return row;
}

export function serializeEvent(db, row, { withChecks = true } = {}) {
  const media = (id) => (id ? serializeMedia(db.get("SELECT * FROM media WHERE id = ?", id)) : null);
  const venueRow = row.venue_id ? db.get("SELECT * FROM venues WHERE id = ?", row.venue_id) : null;
  const album = row.gallery_album_id ? db.get("SELECT id, slug, title, published FROM gallery_albums WHERE id = ?", row.gallery_album_id) : null;
  const event = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    statusLabel: STATUSES[row.status],
    publishAt: row.publish_at,
    date: row.date,
    datePrecision: row.date_precision,
    startTime: row.start_time,
    endTime: row.end_time,
    doorsTime: row.doors_time,
    timezone: row.timezone,
    venueId: row.venue_id,
    venue: venueRow ? serializeVenue(venueRow) : null,
    price: row.price,
    age: row.age,
    ticketUrl: row.ticket_url,
    tickets: sortTickets(fromJson(row.tickets, []).map(normalizeTicket)),
    contest: normalizeContest(fromJson(row.contest, {})),
    flyerMediaId: row.flyer_media_id,
    flyer: media(row.flyer_media_id),
    coverMediaId: row.cover_media_id,
    cover: media(row.cover_media_id),
    genres: fromJson(row.genres, []),
    description: row.description,
    practical: fromJson(row.practical, []),
    links: fromJson(row.links, []),
    aboutKicker: row.about_kicker,
    aboutTitle: row.about_title,
    aboutText: row.about_text,
    photos: db
      .all("SELECT * FROM event_photos WHERE event_id = ? ORDER BY position", row.id)
      .map((p) => ({ mediaId: p.media_id, caption: p.caption, media: media(p.media_id) })),
    galleryAlbumId: row.gallery_album_id,
    gallery: album,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    notes: row.notes,
    firstPublishedAt: row.first_published_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ? db.get("SELECT name FROM users WHERE id = ?", row.created_by)?.name ?? null : null,
    updatedBy: row.updated_by ? db.get("SELECT name FROM users WHERE id = ?", row.updated_by)?.name ?? null : null,
    lineup: loadLineup(db, row.id),
    redirects: db.all("SELECT old_slug FROM event_redirects WHERE event_id = ? ORDER BY created_at", row.id).map((r) => r.old_slug),
    publicPath: `evenement-${row.slug}.html`
  };
  if (withChecks) event.checks = eventChecks(db, event);
  return event;
}

export function getEvent(db, id, options) {
  return serializeEvent(db, getEventRow(db, id), options);
}

export function listEvents(db, { q = "", status = "", period = "", sort = "date_desc", page = 1, pageSize = 25 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push(`(e.title LIKE ? ESCAPE '\\' OR e.slug LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR v.city LIKE ? ESCAPE '\\'
      OR e.id IN (SELECT s.event_id FROM lineup_slots s LEFT JOIN lineup_slot_artists la ON la.slot_id = s.id LEFT JOIN artists a ON a.id = la.artist_id
                  WHERE a.name LIKE ? ESCAPE '\\' OR s.label LIKE ? ESCAPE '\\'))`);
    params.push(like(q), like(q), like(q), like(q), like(q), like(q));
  }
  if (status === "active") where.push("e.status <> 'archived'");
  else if (STATUSES[status]) { where.push("e.status = ?"); params.push(status); }
  const today = parisToday();
  if (period === "upcoming") { where.push("e.date >= ?"); params.push(today); }
  if (period === "past") { where.push("e.date < ?"); params.push(today); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = {
    date_desc: "e.date DESC, e.start_time DESC",
    date_asc: "e.date ASC, e.start_time ASC",
    updated: "e.updated_at DESC",
    title: "e.title COLLATE NOCASE ASC"
  }[sort] || "e.date DESC";
  const from = "FROM events e LEFT JOIN venues v ON v.id = e.venue_id";
  const total = db.get(`SELECT COUNT(*) AS n ${from} ${clause}`, ...params).n;
  const rows = db.all(
    `SELECT e.id, e.slug, e.title, e.status, e.publish_at, e.date, e.date_precision, e.start_time, e.end_time, e.updated_at, e.ticket_url,
            e.flyer_media_id, e.cover_media_id, v.name AS venue_name, v.city AS venue_city,
            (SELECT COUNT(*) FROM lineup_slots s WHERE s.event_id = e.id) AS lineup_count
       ${from} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  const items = rows.map((r) => {
    const visual = r.flyer_media_id || r.cover_media_id;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      statusLabel: STATUSES[r.status],
      publishAt: r.publish_at,
      date: r.date,
      datePrecision: r.date_precision,
      startTime: r.start_time,
      endTime: r.end_time,
      venue: r.venue_name ? [r.venue_name, r.venue_city].filter(Boolean).join(" · ") : "",
      lineupCount: r.lineup_count,
      hasTickets: Boolean(r.ticket_url),
      thumbUrl: visual ? `/api/media/${visual}/thumb` : null,
      upcoming: r.date >= today,
      updatedAt: r.updated_at
    };
  });
  return { items, total, page, pageSize };
}

/* ---------- Contrôles avant publication ---------- */

/**
 * Contrôles d'une soirée, un par élément vérifié : { id, section, level, label, message }.
 *  - level « error » : bloque la publication (immédiate ou programmée) ;
 *  - « warning » : à vérifier, n'empêche pas de publier ;
 *  - « ok » : conforme ; « na » : sans objet dans ce contexte (soirée passée, annulée…).
 * section : ancre de la fiche dans l'administration (#billetterie…). Les règles dépendent du contexte :
 * une soirée passée, annulée ou archivée n'a pas besoin de billetterie ni de line-up complet.
 * Contrôles qui demandent les fichiers (images, rendu de la fiche) : services/event-checklist.mjs.
 */
export function eventCheckItems(db, ev) {
  const items = [];
  const add = (id, section, label, level, message = "") => items.push({ id, section, label, level, message });
  const upcoming = ev.date >= parisToday();
  const sellable = upcoming && ev.status !== "cancelled";

  // Essentiel
  add("title", "essentiel", "Nom de la soirée", ev.title ? "ok" : "error", ev.title ? "" : "Le nom de l'événement est obligatoire.");
  add("date", "horaires", "Date", ev.date ? "ok" : "error", ev.date ? "" : "La date est obligatoire.");
  add("description", "essentiel", "Résumé (Google, partages)", ev.description ? "ok" : "warning", ev.description ? "" : "Résumé vide : il sert de description pour Google et les partages.");
  if (ev.datePrecision === "month") add("date-precision", "horaires", "Date exacte", upcoming ? "warning" : "ok", ev.startTime ? "Date au mois près : les horaires ne seront pas affichés." : upcoming ? "Date au mois près : à préciser dès qu'elle est connue." : "");

  // Horaires
  if (ev.endTime && !ev.startTime) add("times", "horaires", "Horaires", "error", "L'heure de fin est renseignée sans heure de début.");
  else if (ev.datePrecision === "month" && ev.startTime) add("times", "horaires", "Horaires", "warning", "Date au mois près : les horaires ne seront pas affichés.");
  else add("times", "horaires", "Horaires", ev.startTime || !upcoming ? "ok" : "warning", ev.startTime || !upcoming ? "" : "Heure de début non renseignée.");
  if (ev.doorsTime && ev.startTime) {
    const late = nightMinutes(ev.doorsTime, ev.startTime) > nightMinutes(ev.startTime, ev.startTime);
    add("doors", "horaires", "Ouverture des portes", late ? "warning" : "ok", late ? "L'ouverture des portes est après le début de la soirée." : "");
  }

  // Lieu
  if (!ev.venue) add("venue", "lieu", "Lieu", "warning", upcoming ? "Lieu non renseigné : le site affichera « Lieu à confirmer »." : "Lieu non renseigné.");
  else if (ev.venue.lat == null) add("venue", "lieu", "Lieu", "warning", "Le lieu n'a pas de coordonnées GPS : pas de plan « Y aller » sur la fiche.");
  else add("venue", "lieu", "Lieu", "ok");
  if (ev.venue?.archived && upcoming) add("venue-archived", "lieu", "Lieu actif", "warning", "Le lieu est archivé : vérifiez qu'il est toujours le bon.");

  // Visuels (affiche ou photo : liste des soirées, aperçus de partage)
  add("visual", "visuels", "Affiche ou photo", ev.flyer || ev.cover ? "ok" : "warning", ev.flyer || ev.cover ? "" : "Aucun visuel : ajoutez l'affiche (ou une photo) pour la liste et les partages.");
  for (const [key, media, label] of [["flyer-alt", ev.flyer, "Texte alternatif de l'affiche"], ["cover-alt", ev.cover, "Texte alternatif de la photo de fond"]]) {
    if (media) add(key, "visuels", label, media.alt ? "ok" : "warning", media.alt ? "" : `${label} manquant (lecteurs d'écran) : à renseigner dans la médiathèque.`);
  }

  // Billetterie (sans objet pour une soirée passée ou annulée)
  const tickets = ev.tickets || [];
  const presale = tickets.filter((t) => !t.door);
  if (!sellable) add("ticket-url", "billetterie", "Billetterie", "na", ev.status === "cancelled" ? "Soirée annulée : pas de billetterie." : "Soirée passée : billetterie sans objet.");
  else {
    add("ticket-url", "billetterie", "Lien de billetterie", ev.ticketUrl ? "ok" : "warning", ev.ticketUrl ? "" : "Soirée à venir sans lien de billetterie.");
    if (tickets.length) {
      const noneAvailable = presale.length && presale.every((t) => t.status !== "available");
      add("tickets-open", "billetterie", "Tarifs en vente", noneAvailable ? "warning" : "ok", noneAvailable ? `Aucun tarif en prévente n'est « en vente » : le bouton de billetterie est désactivé sur la fiche${tickets.some((t) => t.door && t.status === "available") ? " (la caisse du soir reste affichée)" : ""}.` : "");
      const lateSale = tickets.some((t) => t.until && ev.date && t.until > ev.date);
      add("tickets-until", "billetterie", "Fins de vente", lateSale ? "warning" : "ok", lateSale ? "Un tarif a une fin de vente après la date de la soirée." : "");
    }
    if (presale.length && !ev.ticketUrl) add("tickets-url", "billetterie", "Tarifs et lien", "warning", "Des tarifs en prévente sont renseignés sans lien de billetterie : le bouton « Prendre ma place » sera désactivé.");
  }
  // Résumé du prix qui contredit les tarifs : un montant du résumé ne correspond à aucun tarif.
  if (ev.price && tickets.length) {
    const amounts = (ev.price.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(",", ".")));
    const prices = new Set(tickets.map((t) => Number(t.price)));
    const unknown = amounts.filter((n) => !prices.has(n));
    add("price-summary", "billetterie", "Résumé du prix", unknown.length ? "warning" : "ok", unknown.length ? `« Résumé du prix » (${ev.price}) cite ${unknown.map((n) => `${String(n).replace(".", ",")} €`).join(", ")}, qui ne correspond à aucun tarif : corrigez-le, ou videz-le pour qu'il soit calculé depuis les tarifs (« Dès … € »).` : "");
  }

  // DJ Contest
  const contestSlot = ev.lineup.some((s) => s.artists.some((a) => a.mystery));
  const contest = ev.contest || {};
  if (contestSlot && sellable) {
    if (!contest.deadline) add("contest", "contest", "DJ Contest", "warning", "DJ Contest : date limite d'envoi des sets non renseignée.");
    else if (ev.date && contest.deadline > ev.date) add("contest", "contest", "DJ Contest", "warning", "DJ Contest : la date limite est après la soirée.");
    else add("contest", "contest", "DJ Contest", "ok");
  }
  if (!contestSlot && (contest.deadline || contest.text)) add("contest", "contest", "DJ Contest", "warning", "DJ Contest renseigné, mais aucun artiste mystère (DJ Contest) dans le line-up : la fenêtre de participation ne sera pas proposée.");

  // Référencement et « La soirée »
  if (ev.seoDescription) add("seo-length", "seo", "Description SEO", ev.seoDescription.length > 170 ? "warning" : "ok", ev.seoDescription.length > 170 ? `Description SEO longue (${ev.seoDescription.length} caractères) : Google la coupe vers 160.` : "");
  if (ev.photos.length) add("photo-captions", "soiree", "Légendes des photos", ev.photos.some((p) => !p.caption) ? "warning" : "ok", ev.photos.some((p) => !p.caption) ? "Une photo « La soirée » n'a pas de légende." : "");
  if (ev.gallery && !ev.gallery.published) add("gallery", "soiree", "Album photo", "warning", "L'album lié n'est pas publié : le lien « Voir les photos » n'apparaîtra pas.");

  // Line-up
  const lineupProblems = [];
  const lineupErrors = [];
  if (upcoming && !ev.lineup.length) lineupProblems.push("Line-up vide.");
  const timed = ev.lineup.filter((s) => s.startTime);
  if (timed.length && timed.length < ev.lineup.length) lineupProblems.push("Certains passages du line-up n'ont pas d'horaire : ils seront affichés à la fin.");
  for (const [i, s] of ev.lineup.entries()) {
    const name = slotName(s) || `Passage ${i + 1}`;
    if (!s.artists.length && !s.label) lineupErrors.push(`Line-up, passage ${i + 1} : choisissez un artiste ou saisissez un nom.`);
    if (s.endTime && !s.startTime) lineupErrors.push(`Line-up, ${name} : heure de fin sans heure de début.`);
    if (s.artists.some((a) => a.archived)) lineupProblems.push(`Line-up, ${name} : la fiche d'un artiste est archivée.`);
    if (s.label && s.artists.length) {
      const key = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
      const parts = s.label.split(/\s+b2b\s+/i).map(key);
      if (s.artists.some((a) => !parts.includes(key(a.name)))) lineupProblems.push(`Line-up, ${name} : le nom affiché ne correspond pas exactement aux fiches artistes (liens Instagram et photos non reliés).`);
    }
    if (s.startTime && s.endTime && duration(s.startTime, s.endTime) > 6 * 60) lineupProblems.push(`Line-up, ${name} : passage de plus de 6 heures, vérifiez les horaires.`);
  }
  if (ev.startTime && timed.length) {
    const start = nightMinutes(ev.startTime, ev.startTime);
    const end = ev.endTime ? start + duration(ev.startTime, ev.endTime) : null;
    for (const s of timed) {
      const a = nightMinutes(s.startTime, ev.startTime);
      const b = s.endTime ? a + duration(s.startTime, s.endTime) : a;
      if (a < start || (end !== null && b > end)) lineupProblems.push(`Line-up, ${slotName(s)} : horaire en dehors de la soirée (${ev.startTime} – ${ev.endTime || "?"}).`);
    }
  }
  const sorted = timed
    .map((s) => {
      const a = nightMinutes(s.startTime, ev.startTime || s.startTime);
      return { s, a, b: s.endTime ? a + duration(s.startTime, s.endTime) : a };
    })
    .sort((x, y) => x.a - y.a);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].a < sorted[i - 1].b) lineupProblems.push(`Line-up : ${slotName(sorted[i - 1].s)} et ${slotName(sorted[i].s)} se chevauchent.`);
  }
  const order = ev.lineup.filter((s) => s.startTime).map((s) => nightMinutes(s.startTime, ev.startTime || s.startTime));
  if (order.some((t, i) => i && t < order[i - 1])) lineupProblems.push("L'ordre du line-up ne suit pas les horaires (le site les affiche dans l'ordre des horaires) : utilisez « Trier par horaire ».");
  lineupErrors.forEach((m, i) => add(`lineup-error-${i}`, "lineup", "Line-up", "error", m));
  lineupProblems.forEach((m, i) => add(`lineup-${i}`, "lineup", "Line-up", "warning", m));
  if (!lineupErrors.length && !lineupProblems.length && ev.lineup.length) add("lineup", "lineup", "Line-up", "ok", `${ev.lineup.length} passage(s) cohérent(s).`);

  // Traductions manquantes
  if (db) {
    const texts = translatableTexts(ev);
    if (texts.length) {
      const missing = { de: 0, en: 0 };
      for (const lang of ["de", "en"]) {
        for (const text of texts) if (!db.get("SELECT 1 FROM translations WHERE source = ? AND lang = ?", text, lang)) missing[lang]++;
      }
      add("translations", "traductions", "Traductions", missing.de || missing.en ? "warning" : "ok",
        missing.de || missing.en ? `Traductions manquantes : ${missing.de} en allemand, ${missing.en} en anglais (le texte français s'affiche à la place).` : `${texts.length} texte(s) traduit(s) en allemand et en anglais.`);
    }
  }
  return items;
}

/**
 * { errors, warnings } : les erreurs bloquent la publication, les avertissements la signalent.
 * Contrôle aussi la cohérence du line-up (horaires hors de la soirée, chevauchements…).
 */
export function eventChecks(db, ev) {
  const items = eventCheckItems(db, ev);
  return {
    errors: items.filter((i) => i.level === "error").map((i) => i.message),
    warnings: items.filter((i) => i.level === "warning").map((i) => i.message)
  };
}

/** Textes de la fiche traduits par le site (mêmes règles que tools/validate.mjs). */
export function translatableTexts(ev) {
  return [
    ev.description, ev.price, ev.age, ...(ev.tickets || []).flatMap((t) => [t.label, t.note]), ...(ev.practical || []),
    ev.contest?.text, ev.aboutKicker, ev.aboutTitle, ev.aboutText, ev.seoDescription, ...(ev.photos || []).map((p) => p.caption)
  ]
    .filter((s) => s && /\p{L}{2}/u.test(s))
    .map((s) => String(s).replace(/\s+/g, " ").trim());
}

/* ---------- Écriture ---------- */

function validateInput(db, input, { current } = {}) {
  const v = new Validator(input);
  const data = {
    title: v.text("title", { required: true, max: 120, label: "Le nom de l'événement" }),
    slug: v.slug("slug"),
    date: v.date("date", { required: true }),
    date_precision: v.oneOf("datePrecision", ["day", "month"], { fallback: "day", label: "La précision de la date" }),
    start_time: v.time("startTime", { label: "L'heure de début" }),
    end_time: v.time("endTime", { label: "L'heure de fin" }),
    doors_time: v.time("doorsTime", { label: "L'ouverture des portes" }),
    venue_id: v.id("venueId", { label: "Le lieu" }),
    price: v.text("price", { max: 160, label: "Le résumé du prix" }),
    age: v.text("age", { max: 60, label: "L'âge minimum" }),
    ticket_url: v.url("ticketUrl", { httpsOnly: true, label: "Le lien de billetterie" }),
    flyer_media_id: v.id("flyerMediaId", { label: "L'affiche" }),
    cover_media_id: v.id("coverMediaId", { label: "La photo de fond" }),
    genres: v.list("genres", { maxItems: 8, maxLength: 30, label: "Les styles musicaux" }),
    description: v.text("description", { max: 400, multiline: false, label: "Le résumé" }),
    practical: v.list("practical", { maxItems: 12, maxLength: 200, label: "Les infos pratiques" }),
    links: v.links("links", { maxItems: 6 }),
    about_kicker: v.text("aboutKicker", { max: 80, label: "La petite ligne" }),
    about_title: v.text("aboutTitle", { max: 120, label: "L'accroche" }),
    about_text: v.text("aboutText", { max: 2000, multiline: true, label: "La présentation" }),
    gallery_album_id: v.id("galleryAlbumId", { label: "L'album photo" }),
    seo_title: v.text("seoTitle", { max: 90, label: "Le titre SEO" }),
    seo_description: v.text("seoDescription", { max: 300, label: "La description SEO" }),
    notes: v.text("notes", { max: 4000, multiline: true, label: "Les notes internes" })
  };
  if (data.end_time && !data.start_time) v.error("endTime", "Indiquez d'abord l'heure de début.");

  // Billets (tarifs) et DJ Contest
  const tickets = validateTickets(input.tickets);
  for (const [field, message] of Object.entries(tickets.errors)) v.error(field, message);
  data.tickets = tickets.tickets;
  const cv = new Validator(input.contest && typeof input.contest === "object" ? input.contest : {});
  data.contest = {
    email: cv.email("email", { label: "L'adresse e-mail du DJ Contest" }),
    deadline: cv.date("deadline", { label: "La date limite du DJ Contest" }) || "",
    text: cv.text("text", { max: 600, multiline: true, label: "Le texte du DJ Contest" })
  };
  for (const [field, message] of Object.entries(cv.errors)) v.error(`contest.${field}`, message);

  if (data.venue_id && !db.get("SELECT id FROM venues WHERE id = ?", data.venue_id)) v.error("venueId", "Lieu introuvable.");
  for (const field of ["flyer_media_id", "cover_media_id"]) {
    if (data[field] && !db.get("SELECT id FROM media WHERE id = ?", data[field])) v.error(field === "flyer_media_id" ? "flyerMediaId" : "coverMediaId", "Image introuvable dans la médiathèque.");
  }
  if (data.gallery_album_id && !db.get("SELECT id FROM gallery_albums WHERE id = ?", data.gallery_album_id)) v.error("galleryAlbumId", "Album introuvable.");

  // Photos « La soirée »
  const photos = [];
  if (input.photos !== undefined) {
    if (!Array.isArray(input.photos)) v.error("photos", "Liste de photos invalide.");
    else if (input.photos.length > MAX_PHOTOS) v.error("photos", `${MAX_PHOTOS} photos maximum (ce sont celles affichées dans « La soirée »).`);
    else {
      for (const p of input.photos) {
        const mediaId = Number(p?.mediaId);
        if (!Number.isInteger(mediaId) || !db.get("SELECT id FROM media WHERE id = ?", mediaId)) { v.error("photos", "Une photo est introuvable dans la médiathèque."); break; }
        const caption = cleanText(p.caption);
        if (caption.length > 200) { v.error("photos", "Légende trop longue (200 caractères maximum)."); break; }
        photos.push({ mediaId, caption });
      }
    }
  }

  // Line-up
  const lineup = [];
  if (input.lineup !== undefined) {
    if (!Array.isArray(input.lineup)) v.error("lineup", "Line-up invalide.");
    else if (input.lineup.length > MAX_SLOTS) v.error("lineup", `${MAX_SLOTS} passages maximum.`);
    else {
      for (const [i, raw] of input.lineup.entries()) {
        const sv = new Validator(raw);
        const slot = {
          // Identifiant stable du passage (conservé d'un enregistrement à l'autre) ; absent = nouveau passage.
          uid: typeof raw?.uid === "string" && SLOT_UID.test(raw.uid) ? raw.uid : null,
          label: sv.text("label", { max: 100, label: "Le nom affiché" }),
          style: sv.text("style", { max: 60, label: "Le style" }),
          start_time: sv.time("startTime", { label: "L'heure de début" }),
          end_time: sv.time("endTime", { label: "L'heure de fin" }),
          notes: sv.text("notes", { max: 500, multiline: true, label: "La note" }),
          artistIds: []
        };
        // artistIds, ou la forme renvoyée par la lecture (artists: [{ id, … }]) : lire puis réenregistrer ne perd rien.
        const ids = Array.isArray(raw?.artistIds) ? raw.artistIds.map(Number) : Array.isArray(raw?.artists) ? raw.artists.map((a) => Number(a?.id)) : [];
        if (ids.length > 4) sv.error("artistIds", "4 artistes maximum par passage.");
        if (new Set(ids).size !== ids.length) sv.error("artistIds", "Le même artiste figure deux fois dans ce passage.");
        for (const id of ids) {
          if (!Number.isInteger(id) || !db.get("SELECT id FROM artists WHERE id = ?", id)) sv.error("artistIds", "Artiste introuvable.");
        }
        slot.artistIds = ids;
        if (slot.uid && lineup.some((other) => other.uid === slot.uid)) slot.uid = null;
        if (!ids.length && !slot.label) sv.error("artistIds", "Choisissez un artiste ou saisissez un nom.");
        if (slot.end_time && !slot.start_time) sv.error("endTime", "Indiquez d'abord l'heure de début.");
        for (const [field, message] of Object.entries(sv.errors)) v.error(`lineup.${i}.${field}`, `Passage ${i + 1} : ${message}`);
        lineup.push(slot);
      }
    }
  }

  // Slug : saisi, sinon dérivé du nom et de l'année ; unique, et différent des anciennes adresses des autres soirées.
  const base = data.slug || (current ? current.slug : `${data.title || "soiree"} ${String(data.date || "").slice(0, 4)}`);
  if (data.slug) {
    const takenByOther = db.get("SELECT id FROM events WHERE slug = ? AND id IS NOT ?", data.slug, current?.id ?? null);
    const redirectOfOther = db.get("SELECT event_id FROM event_redirects WHERE old_slug = ? AND event_id IS NOT ?", data.slug, current?.id ?? null);
    if (takenByOther) v.error("slug", "Cette adresse est déjà utilisée par une autre soirée.");
    else if (redirectOfOther) v.error("slug", "Cette adresse est l'ancienne adresse d'une autre soirée (elle y redirige).");
  }
  v.throwIfErrors();
  data.slug = data.slug ||
    (current ? current.slug : uniqueSlug(db, "events", base, null, (s) => Boolean(db.get("SELECT 1 FROM event_redirects WHERE old_slug = ?", s))));
  return { data, photos: input.photos !== undefined ? photos : null, lineup: input.lineup !== undefined ? lineup : null };
}

const SLOT_UID = /^[0-9a-f]{16}$/;
export const newSlotUid = () => crypto.randomBytes(8).toString("hex");

/**
 * Photos et line-up. Les passages sont mis à jour sur place d'après leur uid (identifiant stable,
 * visé par les programmations) ; un passage sans uid connu de cette soirée est ajouté (avec l'uid
 * demandé s'il est libre : passage préparé par une programmation), les passages absents sont retirés.
 */
function writeChildren(db, eventId, photos, lineup) {
  if (photos) {
    db.run("DELETE FROM event_photos WHERE event_id = ?", eventId);
    photos.forEach((p, i) => db.run("INSERT INTO event_photos (event_id, media_id, caption, position) VALUES (?, ?, ?, ?)", eventId, p.mediaId, p.caption, i));
  }
  if (lineup) {
    const existing = new Map(db.all("SELECT id, uid FROM lineup_slots WHERE event_id = ?", eventId).map((r) => [r.uid, r.id]));
    const kept = [];
    lineup.forEach((s, i) => {
      let slotId = s.uid ? existing.get(s.uid) : null;
      if (slotId) {
        db.run("UPDATE lineup_slots SET position = ?, label = ?, style = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ?", i, s.label, s.style, s.start_time, s.end_time, s.notes, slotId);
        db.run("DELETE FROM lineup_slot_artists WHERE slot_id = ?", slotId);
      } else {
        const uid = s.uid && !db.get("SELECT 1 FROM lineup_slots WHERE uid = ?", s.uid) ? s.uid : newSlotUid();
        slotId = Number(db.run(
          "INSERT INTO lineup_slots (event_id, position, label, style, start_time, end_time, notes, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          eventId, i, s.label, s.style, s.start_time, s.end_time, s.notes, uid
        ).lastInsertRowid);
      }
      kept.push(slotId);
      s.artistIds.forEach((artistId, j) => db.run("INSERT INTO lineup_slot_artists (slot_id, artist_id, position) VALUES (?, ?, ?)", slotId, artistId, j));
    });
    db.run(`DELETE FROM lineup_slots WHERE event_id = ? AND id NOT IN (${kept.map(() => "?").join(",") || "NULL"})`, eventId, ...kept);
  }
}

const COLUMNS = [
  "slug", "title", "date", "date_precision", "start_time", "end_time", "doors_time", "venue_id", "price", "age", "ticket_url", "tickets",
  "flyer_media_id", "cover_media_id", "genres", "description", "practical", "links", "contest", "about_kicker", "about_title", "about_text",
  "gallery_album_id", "seo_title", "seo_description", "notes"
];
const JSON_COLUMNS = { genres: [], practical: [], links: [], tickets: [], contest: {} };
const values = (data) => COLUMNS.map((c) => (c in JSON_COLUMNS ? JSON.stringify(data[c] || JSON_COLUMNS[c]) : data[c]));

const snapshot = (db, id) => {
  const ev = getEvent(db, id, { withChecks: false });
  return ev;
};

export function createEvent(db, input, user, { origin = "manual" } = {}) {
  return db.tx(() => {
    const { data, photos, lineup } = validateInput(db, input);
    const t = now();
    const { lastInsertRowid } = db.run(
      `INSERT INTO events (${COLUMNS.join(", ")}, status, created_by, updated_by, created_at, updated_at)
       VALUES (${COLUMNS.map(() => "?").join(", ")}, 'draft', ?, ?, ?, ?)`,
      ...values(data), user?.id, user?.id, t, t
    );
    const id = Number(lastInsertRowid);
    writeChildren(db, id, photos, lineup);
    saveRevision(db, "event", id, 1, snapshot(db, id), user?.id, { origin });
    return getEvent(db, id);
  });
}

/**
 * options : origine de la version (saisie, programmation, restauration) et programmation associée.
 * L'entrée est la fiche complète : un champ simple absent n'est pas conservé (valeur par défaut, le plus
 * souvent vide ; refusé s'il est obligatoire), alors que `photos` et `lineup` absents restent inchangés.
 * `version` est obligatoire (409 `stale` si elle ne correspond plus).
 */
export function updateEvent(db, id, input, user, { origin = "manual", changeId = null } = {}) {
  return db.tx(() => {
    const current = getEventRow(db, id);
    if (input.version === undefined || Number(input.version) !== current.version) {
      throw conflict("Cet événement a été modifié par quelqu'un d'autre entre-temps. Rechargez la page pour récupérer sa dernière version (vos modifications non enregistrées seraient perdues).", { stale: true, version: current.version });
    }
    const { data, photos, lineup } = validateInput(db, input, { current });
    if (data.slug !== current.slug) {
      // Ancienne adresse déjà publiée : elle reste valable et mène à la nouvelle.
      if (current.first_published_at) {
        db.run("INSERT OR REPLACE INTO event_redirects (old_slug, event_id, created_at) VALUES (?, ?, ?)", current.slug, id, now());
      }
      db.run("DELETE FROM event_redirects WHERE old_slug = ?", data.slug);
    }
    db.run(
      `UPDATE events SET ${COLUMNS.map((c) => `${c} = ?`).join(", ")}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`,
      ...values(data), user?.id, now(), id
    );
    writeChildren(db, id, photos, lineup);
    const ev = snapshot(db, id);
    saveRevision(db, "event", id, ev.version, ev, user?.id, { origin, changeId });
    return getEvent(db, id);
  });
}

/** Transitions de statut autorisées : action -> { from, to }. */
export const TRANSITIONS = {
  publish: { from: ["draft", "scheduled", "cancelled", "archived"], to: "published", label: "publié" },
  schedule: { from: ["draft", "scheduled"], to: "scheduled", label: "programmé" },
  unpublish: { from: ["published", "scheduled", "cancelled"], to: "draft", label: "repassé en brouillon" },
  cancel: { from: ["published", "scheduled"], to: "cancelled", label: "marqué annulé" },
  archive: { from: ["draft", "scheduled", "published", "cancelled"], to: "archived", label: "archivé" },
  restore: { from: ["archived"], to: "draft", label: "restauré en brouillon" }
};

export function changeStatus(db, id, action, { publishAt } = {}, user, { origin = "status", changeId = null } = {}) {
  const transition = TRANSITIONS[action];
  if (!transition) throw badRequest("Action inconnue.");
  return db.tx(() => {
    const row = getEventRow(db, id);
    if (!transition.from.includes(row.status)) {
      throw conflict(`Impossible : l'événement est « ${STATUSES[row.status]} ».`);
    }
    let when = null;
    if (action === "publish" || action === "schedule") {
      const checks = eventChecks(db, serializeEvent(db, row, { withChecks: false }));
      if (checks.errors.length) throw new ValidationError({ status: checks.errors.join(" ") }, "Corrigez d'abord les erreurs signalées avant de publier.");
    }
    if (action === "schedule") {
      const t = Date.parse(publishAt);
      if (!Number.isFinite(t)) throw new ValidationError({ publishAt: "Indiquez la date et l'heure de mise en ligne." });
      if (t <= Date.now() + 60e3) throw new ValidationError({ publishAt: "La mise en ligne programmée doit être dans le futur." });
      when = new Date(t).toISOString();
    }
    const t = now();
    db.run(
      `UPDATE events SET status = ?, publish_at = ?, first_published_at = CASE WHEN ? = 'published' OR ? = 'cancelled' THEN COALESCE(first_published_at, ?) ELSE first_published_at END,
         version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`,
      transition.to, when, transition.to, transition.to, t, user?.id ?? null, t, id
    );
    // Chaque version a son entrée dans l'historique (fusion des enregistrements concurrents, comparaison).
    const ev = snapshot(db, id);
    saveRevision(db, "event", id, ev.version, ev, user?.id, { origin, changeId });
    return { event: getEvent(db, id), transition };
  });
}

export function duplicateEvent(db, id, user) {
  const src = getEvent(db, id, { withChecks: false });
  const input = {
    ...src,
    title: `${src.title} (copie)`.slice(0, 120),
    slug: "",
    galleryAlbumId: null,
    photos: src.photos.map((p) => ({ mediaId: p.mediaId, caption: p.caption })),
    lineup: src.lineup.map((s) => ({ ...s, uid: null, artistIds: s.artists.map((a) => a.id) }))
  };
  delete input.slug;
  return createEvent(db, input, user);
}

/** Suppression définitive : seulement un brouillon ou une archive (jamais une fiche en ligne). */
export function deleteEvent(db, id) {
  const row = getEventRow(db, id);
  if (!["draft", "archived"].includes(row.status)) {
    throw conflict("Seul un brouillon ou un événement archivé peut être supprimé. Archivez d'abord cet événement.");
  }
  db.run("DELETE FROM events WHERE id = ?", id);
  return row;
}

/** Restaure le contenu d'une version antérieure (le statut et l'adresse actuels sont conservés). */
export function restoreRevision(db, id, data, user, options = { origin: "restore" }) {
  const current = getEventRow(db, id);
  const artistExists = (aid) => db.get("SELECT 1 FROM artists WHERE id = ?", aid);
  const mediaExists = (mid) => mid && db.get("SELECT 1 FROM media WHERE id = ?", mid);
  const input = {
    ...data,
    slug: current.slug,
    version: current.version,
    venueId: data.venueId && db.get("SELECT 1 FROM venues WHERE id = ?", data.venueId) ? data.venueId : null,
    flyerMediaId: mediaExists(data.flyerMediaId) ? data.flyerMediaId : null,
    coverMediaId: mediaExists(data.coverMediaId) ? data.coverMediaId : null,
    galleryAlbumId: data.galleryAlbumId && db.get("SELECT 1 FROM gallery_albums WHERE id = ?", data.galleryAlbumId) ? data.galleryAlbumId : null,
    photos: (data.photos || []).filter((p) => mediaExists(p.mediaId)).map((p) => ({ mediaId: p.mediaId, caption: p.caption })),
    lineup: (data.lineup || [])
      .map((s) => ({ ...s, artistIds: (s.artists || []).map((a) => a.id).filter(artistExists) }))
      .filter((s) => s.artistIds.length || s.label)
  };
  return updateEvent(db, id, input, user, options);
}

export { venuePlace, slugify };
