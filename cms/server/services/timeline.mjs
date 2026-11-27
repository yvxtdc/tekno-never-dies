/**
 * « Notre histoire » (page L'association) : étapes clés de l'association, triées par date (table
 * history_items, migration 009). Exportées dans js/data/histoire.js (exportTimeline) ; sur le site,
 * js/pages/association.js les intercale par année avec les chapitres des soirées. Titre et texte sont
 * traduits dans l'écran Traductions (timelineTexts).
 */
import { now } from "../db/index.mjs";
import { notFound, conflict } from "../http/errors.mjs";
import { Validator, isValidDate } from "./validation.mjs";
import { saveRevision } from "./audit.mjs";
import { serializeMedia } from "./media.mjs";

export const PRECISIONS = { day: "Jour précis", month: "Mois", year: "Année" };
export const VISUALS = { decor: "Étincelles", badge: "Logo de l'association", photo: "Photo" };

const serialize = (db, r) => ({
  id: r.id,
  date: r.date,
  datePrecision: r.date_precision,
  title: r.title,
  text: r.text,
  visual: r.visual,
  mediaId: r.media_id,
  media: r.media_id ? serializeMedia(db.get("SELECT * FROM media WHERE id = ?", r.media_id)) : null,
  published: Boolean(r.published),
  version: r.version,
  updatedAt: r.updated_at
});

export const listTimeline = (db) => db.all("SELECT * FROM history_items ORDER BY date, id").map((r) => serialize(db, r));

export function getTimelineItem(db, id) {
  const row = db.get("SELECT * FROM history_items WHERE id = ?", id);
  if (!row) throw notFound("Étape introuvable.");
  return serialize(db, row);
}

function validate(db, input) {
  const v = new Validator(input);
  const precision = v.oneOf("datePrecision", Object.keys(PRECISIONS), { fallback: "day", label: "La précision de la date" });
  let date = v.text("date", { required: true, max: 10, label: "La date" });
  if (date && !isValidDate(date)) v.error("date", "Date invalide (AAAA-MM-JJ).");
  // Mois ou année seulement : ramenée au premier jour (une seule façon d'écrire la même étape)
  if (date && isValidDate(date)) date = precision === "year" ? `${date.slice(0, 4)}-01-01` : precision === "month" ? `${date.slice(0, 7)}-01` : date;
  const data = {
    date,
    date_precision: precision,
    title: v.text("title", { required: true, max: 80, label: "Le titre" }),
    text: v.text("text", { max: 300, label: "Le texte" }),
    visual: v.oneOf("visual", Object.keys(VISUALS), { fallback: "decor", label: "L'illustration" }),
    media_id: v.id("mediaId", { label: "La photo" }),
    published: v.bool("published", true) ? 1 : 0
  };
  if (data.visual === "photo" && !data.media_id) v.error("mediaId", "Choisissez la photo, ou une autre illustration.");
  if (data.media_id && !db.get("SELECT id FROM media WHERE id = ?", data.media_id)) v.error("mediaId", "Photo introuvable.");
  if (data.visual !== "photo") data.media_id = null;
  v.throwIfErrors();
  return data;
}

export function createTimelineItem(db, input, user) {
  const d = validate(db, input);
  const t = now();
  const { lastInsertRowid } = db.run(
    "INSERT INTO history_items (date, date_precision, title, text, visual, media_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    d.date, d.date_precision, d.title, d.text, d.visual, d.media_id, d.published, t, t
  );
  const item = getTimelineItem(db, Number(lastInsertRowid));
  saveRevision(db, "timeline", item.id, 1, item, user?.id);
  return item;
}

export function updateTimelineItem(db, id, input, user) {
  const current = getTimelineItem(db, id);
  if (input.version !== undefined && Number(input.version) !== current.version) throw conflict("Cette étape a été modifiée entre-temps. Rechargez la page.", { stale: true });
  const d = validate(db, input);
  db.run(
    "UPDATE history_items SET date = ?, date_precision = ?, title = ?, text = ?, visual = ?, media_id = ?, published = ?, version = version + 1, updated_at = ? WHERE id = ?",
    d.date, d.date_precision, d.title, d.text, d.visual, d.media_id, d.published, now(), id
  );
  const item = getTimelineItem(db, id);
  saveRevision(db, "timeline", id, item.version, item, user?.id);
  return item;
}

export function deleteTimelineItem(db, id) {
  const item = getTimelineItem(db, id);
  db.run("DELETE FROM history_items WHERE id = ?", id);
  return item;
}

/** Étapes publiées, au format de js/data/histoire.js ; ref(mediaId, variante) : chemin de l'image exportée. */
export function exportTimeline(db, ref) {
  return db.all("SELECT * FROM history_items WHERE published = 1 ORDER BY date, id").map((r) => ({
    date: r.date,
    datePrecision: r.date_precision,
    title: r.title,
    ...(r.text ? { text: r.text } : {}),
    visual: r.visual,
    ...(r.visual === "photo" && r.media_id ? { image: ref(r.media_id, "web") } : {})
  }));
}

/** Textes à traduire (étapes publiées ou non : on peut traduire avant de publier). */
export const timelineTexts = (db, { publishedOnly = false } = {}) =>
  db.all(`SELECT title, text FROM history_items ${publishedOnly ? "WHERE published = 1" : ""} ORDER BY date`).flatMap((r) => [r.title, r.text]).filter(Boolean);

/** Import initial (js/data/histoire.js) : remplace les étapes de départ de la migration 009. */
export function importTimeline(db, items, mediaIds) {
  db.run("DELETE FROM history_items");
  const t = now();
  for (const it of items) {
    const mediaId = it.image ? mediaIds.get(it.image) ?? null : null;
    db.run(
      "INSERT INTO history_items (date, date_precision, title, text, visual, media_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
      it.date, it.datePrecision || "day", it.title, it.text || "", it.visual === "photo" && !mediaId ? "decor" : it.visual || "decor", mediaId, t, t
    );
  }
}
