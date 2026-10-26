/** Journal d'activité et historique des versions. */
import { now } from "../db/index.mjs";

export function audit(db, actor, action, entityType = null, entityId = null, summary = "") {
  db.run(
    "INSERT INTO audit_log (user_id, action, entity_type, entity_id, summary, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    actor?.user?.id ?? actor?.id ?? null, action, entityType, entityId, String(summary).slice(0, 500), actor?.ip ?? null, now()
  );
}

const KEEP_REVISIONS = 200;
/** Table de chaque type de fiche (génération du contenu enregistrée avec chaque version). */
const TABLES = { event: "events", artist: "artists", venue: "venues", faq: "faq_items", team: "team_members" };

/** Champs d'une version qui ne sont que de l'affichage ou du suivi (jamais comparés). */
const VOLATILE = new Set([
  "version", "updatedAt", "updatedBy", "createdAt", "createdBy", "checks", "statusLabel", "eventCount", "lastDate", "events",
  "photo", "flyer", "cover", "venue", "gallery", "publicPath", "answerHtml", "matchKey", "redirects", "firstPublishedAt", "position"
]);

/** Valeur comparable d'un champ de version : sans les objets d'affichage des passages et photos. */
export function comparable(key, value) {
  if (key === "lineup" && Array.isArray(value)) {
    return value.map((s) => ({ label: s.label || "", style: s.style || "", startTime: s.startTime || null, endTime: s.endTime || null, notes: s.notes || "", artistIds: (s.artists || []).map((a) => a.id) }));
  }
  if (key === "photos" && Array.isArray(value)) return value.map((p) => ({ mediaId: p.mediaId, caption: p.caption || "" }));
  return value ?? null;
}

const same = (key, a, b) => JSON.stringify(comparable(key, a)) === JSON.stringify(comparable(key, b));

/** Champs différents entre deux versions d'une fiche. */
export function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((k) => !VOLATILE.has(k) && !same(k, before?.[k], after?.[k]));
}

/**
 * Enregistre une version de la fiche. origin : manual (saisie), schedule (programmation), restore,
 * status (changement de statut) ; changeId : programmation à l'origine de la version.
 */
export function saveRevision(db, entityType, entityId, version, data, userId, { origin = "manual", changeId = null } = {}) {
  const generation = TABLES[entityType] ? db.get(`SELECT generation FROM ${TABLES[entityType]} WHERE id = ?`, entityId)?.generation ?? null : null;
  const previous = db.get("SELECT data FROM revisions WHERE entity_type = ? AND entity_id = ? AND generation IS ? ORDER BY id DESC LIMIT 1", entityType, entityId, generation);
  const changes = previous ? changedKeys(JSON.parse(previous.data), data) : [];
  const { lastInsertRowid } = db.run(
    "INSERT INTO revisions (entity_type, entity_id, version, data, user_id, created_at, origin, change_id, changes, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    entityType, entityId, version, JSON.stringify(data), userId ?? null, now(), origin, changeId, JSON.stringify(changes), generation
  );
  // On garde les 200 dernières versions de chaque fiche.
  db.run(
    `DELETE FROM revisions WHERE entity_type = ? AND entity_id = ? AND id NOT IN (
       SELECT id FROM revisions WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?)`,
    entityType, entityId, entityType, entityId, KEEP_REVISIONS
  );
  return Number(lastInsertRowid);
}

/**
 * generation : seulement les versions de ce contenu-là (pas celles d'un contenu supprimé dont
 * l'identifiant a été réutilisé). Sans generation : toutes les versions de l'identifiant.
 */
export function listRevisions(db, entityType, entityId, { generation } = {}) {
  return db.all(
    `SELECT r.id, r.version, r.created_at, r.origin, r.change_id, r.changes, u.name AS user_name FROM revisions r
       LEFT JOIN users u ON u.id = r.user_id WHERE r.entity_type = ? AND r.entity_id = ? ${generation === undefined ? "" : "AND r.generation = ?"} ORDER BY r.id DESC`,
    entityType, entityId, ...(generation === undefined ? [] : [generation])
  ).map((r) => ({ ...r, changes: JSON.parse(r.changes || "[]") }));
}

export function getRevision(db, entityType, entityId, revisionId, { generation } = {}) {
  const row = db.get(
    `SELECT * FROM revisions WHERE id = ? AND entity_type = ? AND entity_id = ? ${generation === undefined ? "" : "AND generation = ?"}`,
    revisionId, entityType, entityId, ...(generation === undefined ? [] : [generation])
  );
  return row ? { ...row, data: JSON.parse(row.data), changes: JSON.parse(row.changes || "[]") } : null;
}

export function listAudit(db, { page = 1, pageSize = 50, entityType, userId, q } = {}) {
  const where = [];
  const params = [];
  if (entityType) { where.push("a.entity_type = ?"); params.push(entityType); }
  if (userId) { where.push("a.user_id = ?"); params.push(userId); }
  if (q) { where.push("(a.summary LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\')"); params.push(like(q), like(q)); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db.get(`SELECT COUNT(*) AS n FROM audit_log a ${clause}`, ...params).n;
  const items = db.all(
    `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${clause}
      ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  return { items, total, page, pageSize };
}

/** Motif LIKE avec les caractères spéciaux échappés. */
export const like = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
