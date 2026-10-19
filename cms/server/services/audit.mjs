/** Journal d'activité et historique des versions. */
import { now } from "../db/index.mjs";

export function audit(db, actor, action, entityType = null, entityId = null, summary = "") {
  db.run(
    "INSERT INTO audit_log (user_id, action, entity_type, entity_id, summary, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    actor?.user?.id ?? actor?.id ?? null, action, entityType, entityId, String(summary).slice(0, 500), actor?.ip ?? null, now()
  );
}

const KEEP_REVISIONS = 50;

export function saveRevision(db, entityType, entityId, version, data, userId) {
  db.run(
    "INSERT INTO revisions (entity_type, entity_id, version, data, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    entityType, entityId, version, JSON.stringify(data), userId ?? null, now()
  );
  // On garde les 50 dernières versions de chaque fiche.
  db.run(
    `DELETE FROM revisions WHERE entity_type = ? AND entity_id = ? AND id NOT IN (
       SELECT id FROM revisions WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?)`,
    entityType, entityId, entityType, entityId, KEEP_REVISIONS
  );
}

export function listRevisions(db, entityType, entityId) {
  return db.all(
    `SELECT r.id, r.version, r.created_at, u.name AS user_name FROM revisions r
       LEFT JOIN users u ON u.id = r.user_id WHERE r.entity_type = ? AND r.entity_id = ? ORDER BY r.id DESC`,
    entityType, entityId
  );
}

export function getRevision(db, entityType, entityId, revisionId) {
  const row = db.get("SELECT * FROM revisions WHERE id = ? AND entity_type = ? AND entity_id = ?", revisionId, entityType, entityId);
  return row ? { ...row, data: JSON.parse(row.data) } : null;
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
