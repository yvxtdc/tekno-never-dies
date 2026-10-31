/** Lieux : un lieu est réutilisé par plusieurs soirées ; suppression refusée s'il est utilisé. */
import { now } from "../db/index.mjs";
import { conflict, notFound } from "../http/errors.mjs";
import { Validator } from "./validation.mjs";
import { uniqueSlug, slugify } from "./slug.mjs";
import { like, saveRevision } from "./audit.mjs";

/** Libellé affiché sur le site : libellé public, sinon « Nom, adresse, ville ». */
export function venuePlace(v) {
  if (!v) return "";
  if (v.public_label) return v.public_label;
  return [v.name, v.address, v.city].map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

export function serializeVenue(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    publicLabel: row.public_label,
    place: venuePlace(row),
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lon: row.lon,
    precise: Boolean(row.precise),
    mapSpanKm: row.map_span_km,
    description: row.description,
    websiteUrl: row.website_url,
    accessInfo: row.access_info,
    capacity: row.capacity,
    notes: row.notes,
    archived: Boolean(row.archived),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventCount: row.event_count
  };
}

export function listVenues(db, { q = "", archived = "0", sort = "name" } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(v.name LIKE ? ESCAPE '\\' OR v.city LIKE ? ESCAPE '\\' OR v.address LIKE ? ESCAPE '\\' OR v.public_label LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q), like(q), like(q));
  }
  if (archived === "0") where.push("v.archived = 0");
  if (archived === "1") where.push("v.archived = 1");
  const order = { name: "v.name COLLATE NOCASE", city: "v.city COLLATE NOCASE, v.name COLLATE NOCASE", events: "event_count DESC, v.name COLLATE NOCASE", recent: "v.updated_at DESC" }[sort] || "v.name COLLATE NOCASE";
  return db
    .all(`SELECT v.*, (SELECT COUNT(*) FROM events e WHERE e.venue_id = v.id) AS event_count FROM venues v
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}`, ...params)
    .map(serializeVenue);
}

export function getVenue(db, id) {
  const row = db.get("SELECT v.*, (SELECT COUNT(*) FROM events e WHERE e.venue_id = v.id) AS event_count FROM venues v WHERE v.id = ?", id);
  if (!row) throw notFound("Lieu introuvable.");
  const venue = serializeVenue(row);
  venue.events = db.all("SELECT id, title, date, status FROM events WHERE venue_id = ? ORDER BY date DESC", id);
  return venue;
}

function validate(input) {
  const v = new Validator(input);
  const data = {
    name: v.text("name", { required: true, max: 120, label: "Le nom" }),
    slug: v.slug("slug"),
    public_label: v.text("publicLabel", { max: 200, label: "Le libellé public" }),
    address: v.text("address", { max: 200, label: "L'adresse" }),
    postal_code: v.text("postalCode", { max: 12, label: "Le code postal" }),
    city: v.text("city", { max: 100, label: "La ville" }),
    country: (v.text("country", { max: 2, label: "Le pays", fallback: "FR" }) || "FR").toUpperCase(),
    lat: v.number("lat", { min: -90, max: 90, label: "La latitude" }),
    lon: v.number("lon", { min: -180, max: 180, label: "La longitude" }),
    precise: v.bool("precise", true) ? 1 : 0,
    map_span_km: v.number("mapSpanKm", { min: 0.5, max: 20, label: "La largeur du plan" }),
    description: v.text("description", { max: 2000, multiline: true, label: "La description" }),
    website_url: v.url("websiteUrl", { label: "Le site officiel" }),
    access_info: v.text("accessInfo", { max: 2000, multiline: true, label: "Les informations d'accès" }),
    capacity: v.int("capacity", { min: 1, max: 100000, label: "La capacité" }),
    notes: v.text("notes", { max: 2000, multiline: true, label: "Les notes" }),
    archived: v.bool("archived") ? 1 : 0
  };
  if ((data.lat === null) !== (data.lon === null)) v.error(data.lat === null ? "lat" : "lon", "Renseignez la latitude et la longitude ensemble.");
  if (data.country && !/^[A-Z]{2}$/.test(data.country)) v.error("country", "Code pays sur deux lettres (FR, DE…).");
  if (data.postal_code && data.country === "FR" && !/^\d{5}$/.test(data.postal_code)) v.error("postalCode", "Code postal français sur 5 chiffres.");
  v.throwIfErrors();
  return data;
}

/** Doublon probable : même nom dans la même ville. */
function duplicateOf(db, data, excludeId) {
  return db.get(
    "SELECT id, name, city FROM venues WHERE lower(name) = lower(?) AND lower(city) = lower(?) AND id IS NOT ?",
    data.name, data.city, excludeId
  );
}

export function createVenue(db, input, user) {
  const data = validate(input);
  const dup = duplicateOf(db, data, null);
  if (dup && !input.allowDuplicate) throw conflict(`Un lieu « ${dup.name} » existe déjà à ${dup.city || "cette ville"}.`, { duplicateId: dup.id });
  const t = now();
  const slug = data.slug ? uniqueSlug(db, "venues", data.slug) : uniqueSlug(db, "venues", `${data.name} ${data.city}`);
  const { lastInsertRowid } = db.run(
    `INSERT INTO venues (slug, name, public_label, address, postal_code, city, country, lat, lon, precise, map_span_km, description,
       website_url, access_info, capacity, notes, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug, data.name, data.public_label, data.address, data.postal_code, data.city, data.country, data.lat, data.lon, data.precise,
    data.map_span_km, data.description, data.website_url, data.access_info, data.capacity, data.notes, data.archived, t, t
  );
  const id = Number(lastInsertRowid);
  saveRevision(db, "venue", id, 1, getVenue(db, id), user?.id);
  return getVenue(db, id);
}

/**
 * Même contrat pour artistes, FAQ et équipe : l'entrée est la fiche complète, envoyée par le formulaire
 * ou reconstruite par une programmation (TARGETS, schedule-targets.mjs) ; un champ absent n'est pas
 * conservé mais prend sa valeur par défaut, le plus souvent vide.
 * `version` facultative : fournie, elle doit correspondre (409 `stale`), sinon rien n'est contrôlé.
 */
export function updateVenue(db, id, input, user, { origin = "manual", changeId = null } = {}) {
  const current = db.get("SELECT * FROM venues WHERE id = ?", id);
  if (!current) throw notFound("Lieu introuvable.");
  if (input.version !== undefined && Number(input.version) !== current.version) {
    throw conflict("Ce lieu a été modifié par quelqu'un d'autre entre-temps. Rechargez la page pour voir sa dernière version.", { stale: true });
  }
  const data = validate(input);
  const dup = duplicateOf(db, data, id);
  if (dup && !input.allowDuplicate) throw conflict(`Un autre lieu « ${dup.name} » existe déjà à ${dup.city || "cette ville"}.`, { duplicateId: dup.id });
  const slug = data.slug && data.slug !== current.slug ? uniqueSlug(db, "venues", data.slug, id) : current.slug;
  db.run(
    `UPDATE venues SET slug = ?, name = ?, public_label = ?, address = ?, postal_code = ?, city = ?, country = ?, lat = ?, lon = ?, precise = ?,
       map_span_km = ?, description = ?, website_url = ?, access_info = ?, capacity = ?, notes = ?, archived = ?, version = version + 1, updated_at = ?
     WHERE id = ?`,
    slug, data.name, data.public_label, data.address, data.postal_code, data.city, data.country, data.lat, data.lon, data.precise,
    data.map_span_km, data.description, data.website_url, data.access_info, data.capacity, data.notes, data.archived, now(), id
  );
  const venue = getVenue(db, id);
  saveRevision(db, "venue", id, venue.version, venue, user?.id, { origin, changeId });
  return venue;
}

export function deleteVenue(db, id) {
  const venue = getVenue(db, id);
  if (venue.events.length) {
    throw conflict(`Ce lieu est utilisé par ${venue.events.length} soirée(s) : choisissez un autre lieu pour ces soirées, ou archivez-le.`, { usage: venue.events });
  }
  db.run("DELETE FROM venues WHERE id = ?", id);
  return venue;
}

export { slugify };
