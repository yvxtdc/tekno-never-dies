/** Galerie photo : albums (un par soirée en général), photos ordonnées issues de la médiathèque. */
import { now } from "../db/index.mjs";
import { notFound, conflict, badRequest } from "../http/errors.mjs";
import { Validator } from "./validation.mjs";
import { uniqueSlug } from "./slug.mjs";
import { serializeMedia } from "./media.mjs";

const serialize = (r) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  date: r.date,
  published: Boolean(r.published),
  version: r.version,
  updatedAt: r.updated_at,
  photoCount: r.photo_count,
  coverUrl: r.cover_id ? `/api/media/${r.cover_id}/thumb` : null
});

export function listAlbums(db) {
  return db
    .all(`SELECT a.*, (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id = a.id) AS photo_count,
            (SELECT media_id FROM gallery_photos p WHERE p.album_id = a.id ORDER BY position LIMIT 1) AS cover_id
          FROM gallery_albums a ORDER BY a.date DESC`)
    .map(serialize);
}

export function getAlbum(db, id) {
  const row = db.get(`SELECT a.*, (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id = a.id) AS photo_count FROM gallery_albums a WHERE a.id = ?`, id);
  if (!row) throw notFound("Album introuvable.");
  const album = serialize(row);
  album.photos = db
    .all("SELECT p.id AS photo_id, m.* FROM gallery_photos p JOIN media m ON m.id = p.media_id WHERE p.album_id = ? ORDER BY p.position", id)
    .map((m) => ({ photoId: m.photo_id, media: serializeMedia(m) }));
  album.events = db.all("SELECT id, title, date FROM events WHERE gallery_album_id = ?", id);
  return album;
}

function validate(input) {
  const v = new Validator(input);
  const data = {
    title: v.text("title", { required: true, max: 120, label: "Le titre" }),
    slug: v.slug("slug"),
    date: v.date("date", { required: true }),
    published: v.bool("published") ? 1 : 0
  };
  v.throwIfErrors();
  return data;
}

export function createAlbum(db, input) {
  const data = validate(input);
  const t = now();
  const { lastInsertRowid } = db.run(
    "INSERT INTO gallery_albums (slug, title, date, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    uniqueSlug(db, "gallery_albums", data.slug || data.title), data.title, data.date, data.published, t, t
  );
  return getAlbum(db, Number(lastInsertRowid));
}

export function updateAlbum(db, id, input) {
  const current = db.get("SELECT * FROM gallery_albums WHERE id = ?", id);
  if (!current) throw notFound("Album introuvable.");
  if (input.version !== undefined && Number(input.version) !== current.version) throw conflict("Cet album a été modifié entre-temps. Rechargez la page.", { stale: true });
  const data = validate(input);
  const slug = data.slug && data.slug !== current.slug ? uniqueSlug(db, "gallery_albums", data.slug, id) : current.slug;
  db.run("UPDATE gallery_albums SET slug = ?, title = ?, date = ?, published = ?, version = version + 1, updated_at = ? WHERE id = ?", slug, data.title, data.date, data.published, now(), id);
  // Les soirées liées affichent le lien vers l'album : elles sont à republier.
  db.run("UPDATE events SET updated_at = ? WHERE gallery_album_id = ?", now(), id);
  return getAlbum(db, id);
}

export function setAlbumPhotos(db, id, mediaIds) {
  getAlbum(db, id);
  if (!Array.isArray(mediaIds)) throw badRequest("Liste de photos invalide.");
  const ids = mediaIds.map(Number);
  if (new Set(ids).size !== ids.length) throw badRequest("Une photo figure deux fois dans l'album.");
  if (ids.length > 500) throw badRequest("500 photos maximum par album.");
  for (const mid of ids) if (!db.get("SELECT 1 FROM media WHERE id = ?", mid)) throw badRequest("Une photo est introuvable dans la médiathèque.");
  db.tx(() => {
    db.run("DELETE FROM gallery_photos WHERE album_id = ?", id);
    ids.forEach((mid, i) => db.run("INSERT INTO gallery_photos (album_id, media_id, position) VALUES (?, ?, ?)", id, mid, i));
    db.run("UPDATE gallery_albums SET version = version + 1, updated_at = ? WHERE id = ?", now(), id);
  });
  return getAlbum(db, id);
}

export function deleteAlbum(db, id) {
  const album = getAlbum(db, id);
  db.run("DELETE FROM gallery_albums WHERE id = ?", id);
  return album;
}
