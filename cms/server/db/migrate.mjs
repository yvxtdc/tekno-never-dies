/**
 * Migrations de schéma : fichiers NNN_nom.sql de ce dossier, appliqués une seule fois, dans l'ordre,
 * chacun dans une transaction. La table schema_migrations garde la liste de ceux déjà appliqués.
 * Une migration déjà appliquée ne doit jamais être modifiée : ajouter un nouveau fichier.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
/** Dossier des migrations (lecture seule : test de restauration, qui en déduit le schéma attendu). */
export const MIGRATIONS_DIR = DIR;

export function listMigrations() {
  return fs.readdirSync(DIR).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const done = new Set(db.all("SELECT name FROM schema_migrations").map((r) => r.name));
  const applied = [];
  for (const name of listMigrations()) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(DIR, name), "utf8");
    db.tx(() => {
      db.exec(sql);
      db.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", name, new Date().toISOString());
    });
    applied.push(name);
  }
  return applied;
}
