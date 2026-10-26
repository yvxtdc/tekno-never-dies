/**
 * Contenus programmables (voir schedule.mjs) : pour chaque type, lecture, enregistrement avec les
 * mêmes validations que la saisie dans l'interface, et liste fermée des champs qu'une programmation
 * peut viser. Aucune modification par chemin libre : une clé inconnue est refusée.
 *
 * Clés d'une modification :
 *  - nom d'un champ (« price », « bio »…) : valeur complète du champ (texte, liste, tarifs…) ;
 *  - « status » : statut d'une soirée (publication, annulation, retrait, archivage) ;
 *  - « slot:<uid> » : ajout ou retrait d'un passage du line-up ;
 *  - « slot:<uid>:<champ> » : un champ d'un passage (artistes, horaires, nom affiché, style, notes) ;
 *  - « order:<uid> » : place d'un passage (après le passage indiqué).
 */
import * as events from "./events.mjs";
import * as artists from "./artists.mjs";
import * as venues from "./venues.mjs";
import * as faq from "./faq.mjs";
import * as team from "./team.mjs";
import { TICKET_STATUSES } from "./tickets.mjs";
import { frenchRange } from "./timeutil.mjs";

const f = (label, options = {}) => ({ label, schedulable: true, ...options });
const internal = (label) => ({ label, schedulable: false });

/** Valeur d'un passage comparée et programmée (sans les objets d'affichage). */
export const SLOT_FIELDS = { artistIds: "artistes", label: "nom affiché", style: "style", startTime: "début", endTime: "fin", notes: "notes internes" };
export const slotOf = (s) => ({
  uid: s.uid,
  label: s.label || "",
  style: s.style || "",
  startTime: s.startTime || null,
  endTime: s.endTime || null,
  notes: s.notes || "",
  artistIds: s.artistIds || (s.artists || []).map((a) => a.id)
});

/** Transition de statut d'une soirée qui mène à « to ». */
const STATUS_ACTION = { published: "publish", cancelled: "cancel", draft: "unpublish", archived: "archive" };

export const TARGETS = {
  event: {
    label: "Soirée",
    table: "events",
    nameColumn: "title",
    load: (db, id) => events.getEvent(db, id, { withChecks: false }),
    save: (db, id, input, options, user = null) => events.updateEvent(db, id, input, user, options),
    name: (x) => x.title,
    adminPath: (id) => `/admin/events/${id}`,
    toInput: (x) => ({
      ...x,
      photos: x.photos.map((p) => ({ mediaId: p.mediaId, caption: p.caption })),
      lineup: x.lineup.map(slotOf)
    }),
    fields: {
      title: f("Nom"), slug: internal("Adresse de la fiche"), date: f("Date"), datePrecision: f("Précision de la date"),
      startTime: f("Heure de début"), endTime: f("Heure de fin"), doorsTime: f("Ouverture des portes"), venueId: f("Lieu", { ref: "venue" }),
      price: f("Résumé du prix"), age: f("Âge minimum"), ticketUrl: f("Lien de billetterie"), tickets: f("Tarifs"), contest: f("DJ Contest"),
      flyerMediaId: f("Affiche", { ref: "media" }), coverMediaId: f("Photo de fond", { ref: "media" }), genres: f("Styles musicaux"),
      description: f("Résumé"), practical: f("Infos pratiques"), links: f("Liens complémentaires"), aboutKicker: f("Petite ligne"),
      aboutTitle: f("Accroche"), aboutText: f("Présentation"),
      photos: f("Photos « La soirée »", { pick: (x) => x.photos.map((p) => ({ mediaId: p.mediaId, caption: p.caption || "" })) }),
      galleryAlbumId: f("Album photo", { ref: "album" }), seoTitle: f("Titre SEO"), seoDescription: f("Description SEO"), notes: internal("Notes internes")
    },
    lineup: true,
    // Statut : visibilité sur le site, modifié par les transitions de events.changeStatus.
    status: { values: events.STATUSES, action: (to) => STATUS_ACTION[to] },
    publicKey: "status",
    isPublicValue: (value) => events.PUBLIC_STATUSES.includes(value)
  },
  artist: {
    label: "Artiste",
    table: "artists",
    nameColumn: "name",
    load: (db, id) => artists.getArtist(db, id),
    save: (db, id, input, options, user = null) => artists.updateArtist(db, id, input, user, options),
    name: (x) => x.name,
    adminPath: (id) => `/admin/artists/${id}`,
    toInput: (x) => ({ ...x }),
    fields: {
      name: f("Nom d'artiste"), slug: internal("Adresse"), photoMediaId: f("Photo", { ref: "media" }), styles: f("Styles"), origin: f("Origine"),
      bio: f("Biographie"), instagramUrl: f("Instagram"), soundcloudUrl: f("SoundCloud"), links: f("Autres liens"),
      mystery: f("Artiste mystère (DJ Contest)"), archived: f("Archivé"), contact: internal("Contact"), notes: internal("Notes internes")
    }
  },
  venue: {
    label: "Lieu",
    table: "venues",
    nameColumn: "name",
    load: (db, id) => venues.getVenue(db, id),
    // Les soirées du lieu changent aussi (adresse, plan) : elles sont à republier (comme api/content.mjs).
    save: (db, id, input, options, user = null) => {
      const venue = venues.updateVenue(db, id, { ...input, allowDuplicate: true }, user, options);
      db.run("UPDATE events SET updated_at = ? WHERE venue_id = ?", new Date().toISOString(), id);
      return venue;
    },
    name: (x) => x.name,
    adminPath: (id) => `/admin/venues/${id}`,
    toInput: (x) => ({ ...x }),
    fields: {
      name: f("Nom"), slug: internal("Adresse"), publicLabel: f("Libellé sur le site"), address: f("Adresse"), postalCode: f("Code postal"),
      city: f("Ville"), country: f("Pays"), lat: f("Latitude"), lon: f("Longitude"), precise: f("Adresse exacte connue"),
      mapSpanKm: f("Largeur du plan"), description: f("Description"), websiteUrl: f("Site officiel"), accessInfo: f("Informations d'accès"),
      capacity: f("Capacité"), archived: f("Archivé"), notes: internal("Notes internes")
    }
  },
  faq: {
    label: "Question (FAQ)",
    table: "faq_items",
    nameColumn: "question",
    load: (db, id) => faq.getFaq(db, id),
    save: (db, id, input, options, user = null) => faq.updateFaq(db, id, input, user, options),
    name: (x) => x.question,
    adminPath: () => "/admin/faq",
    toInput: (x) => ({ ...x }),
    fields: { question: f("Question"), answer: f("Réponse"), category: f("Catégorie"), needsValidation: f("À faire valider"), published: f("Affichée sur le site") },
    publicKey: "published",
    isPublicValue: (value) => value === true
  },
  team: {
    label: "Membre de l'équipe",
    table: "team_members",
    nameColumn: "name",
    load: (db, id) => team.getMember(db, id),
    save: (db, id, input, options, user = null) => team.updateMember(db, id, input, user, options),
    name: (x) => x.name,
    adminPath: () => "/admin/team",
    toInput: (x) => ({ ...x }),
    fields: {
      name: f("Nom"), slug: internal("Adresse"), role: f("Rôle"), photoMediaId: f("Photo", { ref: "media" }), tags: f("Missions"),
      extra: f("Détails de la carte"), bio: f("Présentation"), published: f("Affiché sur le site")
    },
    publicKey: "published",
    isPublicValue: (value) => value === true
  }
};

export const exists = (db, type, id) => Boolean(db.get(`SELECT 1 FROM ${TARGETS[type].table} WHERE id = ?`, id));

/**
 * Génération d'un contenu : numéro immuable attribué par la base à sa création, jamais réutilisé
 * (migration 005). Un identifiant réutilisé par SQLite après une suppression a une autre génération.
 */
export const generationOf = (db, type, id) => db.get(`SELECT generation FROM ${TARGETS[type].table} WHERE id = ?`, id)?.generation ?? null;

/** Valeur d'un champ dans une fiche lue (forme comparable). */
export function pick(type, x, key) {
  const def = TARGETS[type].fields[key];
  if (def?.pick) return def.pick(x);
  return x[key] ?? null;
}

/** Fiche visible sur le site ? (contenus sans notion de publication : toujours.) */
export function isPublic(type, x) {
  const t = TARGETS[type];
  return t.publicKey ? t.isPublicValue(x[t.publicKey]) : true;
}

export const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ---------- Affichage lisible des valeurs (interface, historique) ---------- */

const EMPTY = "(vide)";
const yesNo = (v) => (v ? "Oui" : "Non");
const euro = (p) => (p === null || p === undefined || p === "" ? "?" : Number(p) === 0 ? "gratuit" : `${String(p).replace(".", ",")} €`);

function refName(db, ref, id) {
  if (!id) return EMPTY;
  if (ref === "venue") return db.get("SELECT name FROM venues WHERE id = ?", id)?.name || `Lieu n° ${id} (supprimé)`;
  if (ref === "album") return db.get("SELECT title FROM gallery_albums WHERE id = ?", id)?.title || `Album n° ${id} (supprimé)`;
  const m = db.get("SELECT original_name, repo_path FROM media WHERE id = ?", id);
  return m ? m.original_name || m.repo_path : `Image n° ${id} (supprimée)`;
}

export const artistNames = (db, ids) => (ids || []).map((id) => db.get("SELECT name FROM artists WHERE id = ?", id)?.name || `artiste n° ${id}`);

/** Nom d'un passage : nom affiché, sinon noms des artistes (B2B). */
export const slotName = (db, s) => (s ? s.label || artistNames(db, s.artistIds).join(" B2B ") || "passage sans nom" : "");

/** Texte lisible d'une valeur de champ. */
export function showValue(db, type, key, value) {
  if (key === "status") return TARGETS.event.status.values[value] || String(value ?? EMPTY);
  if (key.startsWith("slot:") && key.split(":").length === 2) {
    if (!value) return "(absent)";
    const times = value.startTime ? ` · ${frenchRange(value.startTime, value.endTime)}` : "";
    return `${slotName(db, value)}${times}${value.style ? ` (${value.style})` : ""}`;
  }
  if (key.startsWith("slot:")) {
    const field = key.split(":")[2];
    if (field === "artistIds") return artistNames(db, value).join(" B2B ") || EMPTY;
    return value ? String(value) : EMPTY;
  }
  if (key.startsWith("order:")) return value ? `après ${value}` : "en premier";
  const def = TARGETS[type].fields[key];
  if (def?.ref) return refName(db, def.ref, value);
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "boolean") return yesNo(value);
  if (key === "tickets") return value.length ? value.map((t) => `${t.label} : ${euro(t.price)}${t.status !== "available" ? ` (${TICKET_STATUSES[t.status] || t.status})` : ""}`).join(" · ") : EMPTY;
  if (key === "contest") return [value.deadline && `date limite ${value.deadline}`, value.email, value.text].filter(Boolean).join(" · ") || EMPTY;
  if (key === "photos") return value.length ? value.map((p) => `${refName(db, "media", p.mediaId)}${p.caption ? ` (« ${p.caption} »)` : ""}`).join(" · ") : EMPTY;
  if (key === "links") return value.length ? value.map((l) => `${l.label} (${l.url})`).join(" · ") : EMPTY;
  if (key === "extra") return value.length ? value.map((e) => `${e.label} : ${e.value}`).join(" · ") : EMPTY;
  if (key === "lineup") return value.length ? value.map((s) => showValue(db, type, "slot:x", slotOf(s))).join(" · ") : EMPTY;
  if (Array.isArray(value)) return value.length ? value.join(" · ") : EMPTY;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Libellé d'une clé (« Tarifs », « Line-up · Dann Octa : début »…). */
export function keyLabel(db, type, change) {
  const { key } = change;
  if (key === "status") return "Statut (visibilité sur le site)";
  if (key.startsWith("slot:") || key.startsWith("order:")) {
    const name = change.slotName || "passage";
    if (key.startsWith("order:")) return `Line-up · ordre de « ${name} »`;
    const field = key.split(":")[2];
    if (!field) return change.to ? `Line-up · ajout de « ${name} »` : `Line-up · retrait de « ${name} »`;
    return `Line-up · « ${name} » : ${SLOT_FIELDS[field] || field}`;
  }
  if (key === "lineup") return "Line-up";
  return TARGETS[type].fields[key]?.label || key;
}
