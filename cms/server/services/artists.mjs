/**
 * Artistes : fiches réutilisables. Un passage du line-up référence une ou plusieurs fiches :
 * renommer un artiste ou changer sa photo met à jour toutes les soirées où il joue (sauf si un
 * nom spécifique a été saisi pour un passage).
 */
import { now, fromJson } from "../db/index.mjs";
import { conflict, notFound, badRequest } from "../http/errors.mjs";
import { Validator } from "./validation.mjs";
import { uniqueSlug, artistKey, levenshtein } from "./slug.mjs";
import { like, saveRevision } from "./audit.mjs";
import { serializeMedia } from "./media.mjs";

export function serializeArtist(row, photo) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    matchKey: row.match_key,
    photoMediaId: row.photo_media_id,
    photo: photo ? serializeMedia(photo) : row.photo_media_id ? { id: row.photo_media_id, thumbUrl: `/api/media/${row.photo_media_id}/thumb` } : null,
    styles: row.styles,
    bio: row.bio,
    origin: row.origin,
    instagramUrl: row.instagram_url,
    soundcloudUrl: row.soundcloud_url,
    links: fromJson(row.links, []),
    contact: row.contact,
    notes: row.notes,
    archived: Boolean(row.archived),
    mystery: Boolean(row.mystery),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventCount: row.event_count,
    lastDate: row.last_date
  };
}

const COUNT_SQL = `(SELECT COUNT(DISTINCT s.event_id) FROM lineup_slot_artists la JOIN lineup_slots s ON s.id = la.slot_id WHERE la.artist_id = a.id)`;
const LAST_SQL = `(SELECT MAX(e.date) FROM lineup_slot_artists la JOIN lineup_slots s ON s.id = la.slot_id JOIN events e ON e.id = s.event_id WHERE la.artist_id = a.id)`;

export function listArtists(db, { q = "", archived = "0", sort = "name", page = 1, pageSize = 50, missing = "" } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(a.name LIKE ? ESCAPE '\\' OR a.styles LIKE ? ESCAPE '\\' OR a.match_key LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q), like(`${artistKey(q)}`));
  }
  if (archived === "0") where.push("a.archived = 0");
  if (archived === "1") where.push("a.archived = 1");
  if (missing === "photo") where.push("a.photo_media_id IS NULL");
  if (missing === "instagram") where.push("a.instagram_url = ''");
  if (missing === "styles") where.push("a.styles = ''");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = { name: "a.name COLLATE NOCASE", events: "event_count DESC, a.name COLLATE NOCASE", recent: "a.updated_at DESC", last: "last_date DESC NULLS LAST, a.name COLLATE NOCASE" }[sort] || "a.name COLLATE NOCASE";
  const total = db.get(`SELECT COUNT(*) AS n FROM artists a ${clause}`, ...params).n;
  const items = db.all(
    `SELECT a.*, ${COUNT_SQL} AS event_count, ${LAST_SQL} AS last_date FROM artists a ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  return { items: items.map((r) => serializeArtist(r)), total, page, pageSize };
}

export function getArtist(db, id) {
  const row = db.get(`SELECT a.*, ${COUNT_SQL} AS event_count, ${LAST_SQL} AS last_date FROM artists a WHERE a.id = ?`, id);
  if (!row) throw notFound("Artiste introuvable.");
  const photo = row.photo_media_id ? db.get("SELECT * FROM media WHERE id = ?", row.photo_media_id) : null;
  const artist = serializeArtist(row, photo);
  artist.events = db.all(
    `SELECT DISTINCT e.id, e.title, e.date, e.status, s.label, s.start_time, s.end_time FROM lineup_slot_artists la
       JOIN lineup_slots s ON s.id = la.slot_id JOIN events e ON e.id = s.event_id WHERE la.artist_id = ? ORDER BY e.date DESC`,
    id
  );
  return artist;
}

function validate(db, input) {
  const v = new Validator(input);
  const data = {
    name: v.text("name", { required: true, max: 80, label: "Le nom d'artiste" }),
    slug: v.slug("slug"),
    photo_media_id: v.id("photoMediaId"),
    styles: v.text("styles", { max: 120, label: "Les styles" }),
    bio: v.text("bio", { max: 3000, multiline: true, label: "La biographie" }),
    origin: v.text("origin", { max: 100, label: "L'origine" }),
    instagram_url: v.url("instagramUrl", { httpsOnly: true, label: "Le lien Instagram" }),
    soundcloud_url: v.url("soundcloudUrl", { httpsOnly: true, label: "Le lien SoundCloud" }),
    links: v.links("links"),
    contact: v.text("contact", { max: 300, multiline: true, label: "Le contact" }),
    notes: v.text("notes", { max: 2000, multiline: true, label: "Les notes" }),
    archived: v.bool("archived") ? 1 : 0,
    mystery: v.bool("mystery") ? 1 : 0
  };
  if (data.name && !artistKey(data.name)) v.error("name", "Le nom doit contenir au moins une lettre ou un chiffre (a-z, 0-9).");
  if (data.instagram_url && !/^https:\/\/(www\.)?instagram\.com\/[^/?#]+/.test(data.instagram_url)) v.error("instagramUrl", "Adresse attendue : https://www.instagram.com/compte/");
  if (data.photo_media_id && !db.get("SELECT id FROM media WHERE id = ?", data.photo_media_id)) v.error("photoMediaId", "Photo introuvable dans la médiathèque.");
  v.throwIfErrors();
  return data;
}

/** Artistes au nom très proche (doublons probables). */
export function similarArtists(db, name, excludeId = null) {
  const key = artistKey(name);
  if (!key) return [];
  return db
    .all("SELECT id, name, match_key FROM artists WHERE id IS NOT ?", excludeId)
    .filter((a) => a.match_key === key || (key.length > 3 && levenshtein(a.match_key, key) <= (key.length > 7 ? 2 : 1)) || (key.length > 4 && (a.match_key.includes(key) || key.includes(a.match_key))))
    .map(({ id, name: n }) => ({ id, name: n }));
}

export function createArtist(db, input, user) {
  const data = validate(db, input);
  const key = artistKey(data.name);
  const same = db.get("SELECT id, name FROM artists WHERE match_key = ?", key);
  if (same) throw conflict(`L'artiste « ${same.name} » existe déjà (même nom, aux majuscules et à la ponctuation près).`, { duplicateId: same.id });
  const t = now();
  const slug = uniqueSlug(db, "artists", data.slug || data.name);
  const { lastInsertRowid } = db.run(
    `INSERT INTO artists (slug, name, match_key, photo_media_id, styles, bio, origin, instagram_url, soundcloud_url, links, contact, notes, archived, mystery, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug, data.name, key, data.photo_media_id, data.styles, data.bio, data.origin, data.instagram_url, data.soundcloud_url,
    JSON.stringify(data.links), data.contact, data.notes, data.archived, data.mystery, t, t
  );
  const id = Number(lastInsertRowid);
  const artist = getArtist(db, id);
  saveRevision(db, "artist", id, 1, artist, user?.id);
  return artist;
}

export function updateArtist(db, id, input, user) {
  const current = db.get("SELECT * FROM artists WHERE id = ?", id);
  if (!current) throw notFound("Artiste introuvable.");
  if (input.version !== undefined && Number(input.version) !== current.version) {
    throw conflict("Cette fiche a été modifiée par quelqu'un d'autre entre-temps. Rechargez la page pour voir sa dernière version.", { stale: true });
  }
  const data = validate(db, input);
  const key = artistKey(data.name);
  const same = db.get("SELECT id, name FROM artists WHERE match_key = ? AND id <> ?", key, id);
  if (same) throw conflict(`L'artiste « ${same.name} » existe déjà. Pour réunir les deux fiches, utilisez « Fusionner ».`, { duplicateId: same.id });
  const slug = data.slug && data.slug !== current.slug ? uniqueSlug(db, "artists", data.slug, id) : current.slug;
  db.run(
    `UPDATE artists SET slug = ?, name = ?, match_key = ?, photo_media_id = ?, styles = ?, bio = ?, origin = ?, instagram_url = ?, soundcloud_url = ?,
       links = ?, contact = ?, notes = ?, archived = ?, mystery = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    slug, data.name, key, data.photo_media_id, data.styles, data.bio, data.origin, data.instagram_url, data.soundcloud_url,
    JSON.stringify(data.links), data.contact, data.notes, data.archived, data.mystery, now(), id
  );
  // Les soirées où joue l'artiste changent aussi (nom, photo) : elles sont « à republier ».
  db.run(`UPDATE events SET updated_at = ? WHERE id IN (SELECT s.event_id FROM lineup_slots s JOIN lineup_slot_artists la ON la.slot_id = s.id WHERE la.artist_id = ?)`, now(), id);
  const artist = getArtist(db, id);
  saveRevision(db, "artist", id, artist.version, artist, user?.id);
  return artist;
}

/** Suppression refusée si l'artiste figure dans un line-up (pour ne pas casser les soirées). */
export function deleteArtist(db, id) {
  const artist = getArtist(db, id);
  if (artist.events.length) {
    throw conflict(`Cet artiste figure dans ${artist.events.length} line-up(s). Archivez-le, ou fusionnez-le avec une autre fiche.`, { usage: artist.events });
  }
  db.run("DELETE FROM artists WHERE id = ?", id);
  return artist;
}

/** Fusionne la fiche source dans la fiche cible (doublons) : les passages sont réattribués. */
export function mergeArtists(db, sourceId, targetId, user) {
  if (sourceId === targetId) throw badRequest("Choisissez deux fiches différentes.");
  const source = getArtist(db, sourceId);
  getArtist(db, targetId); // la fiche conservée doit exister
  db.tx(() => {
    // Passage où les deux artistes jouent déjà ensemble : on retire simplement la source.
    db.run(`DELETE FROM lineup_slot_artists WHERE artist_id = ? AND slot_id IN (SELECT slot_id FROM lineup_slot_artists WHERE artist_id = ?)`, sourceId, targetId);
    db.run("UPDATE lineup_slot_artists SET artist_id = ? WHERE artist_id = ?", targetId, sourceId);
    // Champs vides de la cible complétés par la source.
    db.run(
      `UPDATE artists SET photo_media_id = COALESCE(photo_media_id, ?), styles = CASE WHEN styles = '' THEN ? ELSE styles END,
         bio = CASE WHEN bio = '' THEN ? ELSE bio END, instagram_url = CASE WHEN instagram_url = '' THEN ? ELSE instagram_url END,
         soundcloud_url = CASE WHEN soundcloud_url = '' THEN ? ELSE soundcloud_url END, version = version + 1, updated_at = ? WHERE id = ?`,
      source.photoMediaId, source.styles, source.bio, source.instagramUrl, source.soundcloudUrl, now(), targetId
    );
    db.run("DELETE FROM artists WHERE id = ?", sourceId);
  });
  const merged = getArtist(db, targetId);
  saveRevision(db, "artist", targetId, merged.version, merged, user?.id);
  return { source, target: merged };
}
