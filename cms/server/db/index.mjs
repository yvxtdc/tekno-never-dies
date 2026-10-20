/**
 * Accès à la base SQLite (module node:sqlite intégré à Node.js ≥ 22.13 : aucune dépendance native).
 *
 * Toutes les requêtes passent par des requêtes préparées avec paramètres liés : pas de
 * concaténation de valeurs dans le SQL (prévention des injections SQL).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrate.mjs";

export function openDatabase(file, { readOnly = false } = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file, { readOnly });
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 5000");
  if (!readOnly && file !== ":memory:") {
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA synchronous = NORMAL");
  }
  return wrap(raw);
}

/** Petite surcouche : cache des requêtes préparées et transactions imbriquables. */
function wrap(raw) {
  const cache = new Map();
  let depth = 0;
  const prepare = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = raw.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };
  const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p));
  const db = {
    raw,
    get: (sql, ...params) => prepare(sql).get(...norm(params)),
    all: (sql, ...params) => prepare(sql).all(...norm(params)),
    run: (sql, ...params) => prepare(sql).run(...norm(params)),
    exec: (sql) => raw.exec(sql),
    /** Exécute fn dans une transaction (SAVEPOINT si déjà dans une transaction). */
    tx(fn) {
      const name = `sp${depth}`;
      raw.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
      depth++;
      try {
        const result = fn();
        depth--;
        raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return result;
      } catch (error) {
        depth--;
        raw.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      }
    },
    close: () => raw.close(),
    migrate: () => migrate(db)
  };
  return db;
}

/** Date ISO (UTC) pour les colonnes created_at / updated_at. */
export const now = () => new Date().toISOString();

/** Colonnes JSON : lecture tolérante. */
export const fromJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
