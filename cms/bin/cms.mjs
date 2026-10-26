#!/usr/bin/env node
/**
 * Outils d'exploitation du CMS :  npm run cms:admin -- <commande> [options]
 *
 *   migrate                               applique les migrations de la base
 *   import                                import initial des contenus du dépôt (base vide uniquement)
 *   verify                                compare l'export du CMS aux fichiers js/data actuels
 *   create-user --email E --name N [--role admin|editor]
 *                                         crée un compte ; le mot de passe temporaire est affiché une
 *                                         seule fois (à changer à la première connexion)
 *   reset-password --email E              nouveau mot de passe temporaire
 *   list-users                            liste des comptes
 *   publish [--force]                     mise en ligne (selon CMS_PUBLISH_MODE)
 *   backup [--label L]                    sauvegarde de la base dans CMS_DATA_DIR/backups
 *   restore <fichier> --yes               restaure une sauvegarde (serveur arrêté !)
 *   verify-backup [--name F]              teste la dernière sauvegarde (ou F) sur une copie temporaire,
 *                                         sans toucher à la base ; résultat affiché au tableau de santé
 *   status                                état de la base et de la configuration
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../server/config.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { importFromRepo, verifyRoundtrip, contentIsEmpty } from "../server/export/import-repo.mjs";
import { createUser, resetPassword, listUsers } from "../server/services/users.mjs";
import { Publisher } from "../server/publish/publisher.mjs";
import { createBackup, restoreBackup, inspectBackup, listBackups, verifyBackupRestore } from "../server/services/backup.mjs";
import { audit } from "../server/services/audit.mjs";
import { HttpError } from "../server/http/errors.mjs";

const [command, ...rest] = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    opts[key] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
  } else positional.push(rest[i]);
}

const config = loadConfig();
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
const openDb = () => {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o750 });
  const db = openDatabase(config.dbFile);
  const applied = db.migrate();
  if (applied.length) console.log(`✓ Migrations appliquées : ${applied.join(", ")}`);
  return db;
};
const cli = { user: null, ip: "cli" };

try {
  switch (command) {
    case "migrate": {
      openDb();
      console.log("✓ Base à jour.");
      break;
    }
    case "import": {
      const db = openDb();
      if (!contentIsEmpty(db)) fail("La base contient déjà des contenus : import refusé (rien n'a été modifié).");
      const { counts, warnings, diffs } = await importFromRepo(db, config);
      console.log("✓ Import terminé :", counts);
      for (const w of warnings) console.log(`  ! ${w}`);
      console.log(diffs.length ? `! ${diffs.length} différence(s) entre l'export du CMS et les fichiers actuels (npm run cms:admin -- verify)` : "✓ Vérifié : la première mise en ligne reproduira exactement les données actuelles.");
      audit(db, cli, "import", null, null, `${counts.events} soirées, ${counts.artists} artistes, ${counts.venues} lieux, ${counts.faq} questions, ${counts.team} membres, ${counts.media} images`);
      break;
    }
    case "verify": {
      const db = openDb();
      const diffs = await verifyRoundtrip(db, config);
      if (!diffs.length) console.log("✓ Aucune différence entre l'export du CMS et les fichiers js/data actuels.");
      for (const d of diffs) console.log(`- ${d.file} · ${d.key}\n  actuel : ${JSON.stringify(d.expected)?.slice(0, 300)}\n  CMS    : ${JSON.stringify(d.actual)?.slice(0, 300)}`);
      process.exitCode = diffs.length ? 2 : 0;
      break;
    }
    case "create-user": {
      const db = openDb();
      const { user, temporaryPassword } = await createUser(db, { email: opts.email, name: opts.name, role: opts.role || "editor" });
      audit(db, cli, "user.create", "user", user.id, `${user.email} (${user.roleLabel}) — ligne de commande`);
      console.log(`✓ Compte créé : ${user.email} (${user.roleLabel})`);
      console.log(`  Mot de passe temporaire (affiché une seule fois) : ${temporaryPassword}`);
      console.log("  Il devra être changé à la première connexion.");
      break;
    }
    case "reset-password": {
      const db = openDb();
      const row = db.get("SELECT id, email FROM users WHERE email = ?", String(opts.email || "").toLowerCase());
      if (!row) fail("Aucun compte avec cette adresse.");
      const temporary = await resetPassword(db, row.id);
      audit(db, cli, "user.reset-password", "user", row.id, "Ligne de commande");
      console.log(`✓ Nouveau mot de passe temporaire pour ${row.email} : ${temporary}`);
      break;
    }
    case "list-users": {
      const db = openDb();
      for (const u of listUsers(db)) console.log(`${u.active ? "●" : "○"} ${u.email.padEnd(32)} ${u.roleLabel.padEnd(15)} ${u.name}${u.mustChangePassword ? " (mot de passe temporaire)" : ""}`);
      break;
    }
    case "publish": {
      const db = openDb();
      const publisher = new Publisher({ config, db, log: console.log });
      const result = await publisher.publish({ trigger: "cli", force: opts.force === true });
      console.log(result.log);
      console.log(result.status === "success" ? `✓ ${result.summary}` : `✗ ${result.summary}`);
      process.exitCode = result.status === "success" ? 0 : 1;
      break;
    }
    case "backup": {
      const db = openDb();
      const b = await createBackup(config, db, typeof opts.label === "string" ? opts.label : "cli");
      console.log(`✓ Sauvegarde : ${path.join(config.backupDir, b.name)} (${Math.round(b.size / 1024)} Ko)`);
      console.log("  Pensez à sauvegarder aussi le dossier des médias :", config.mediaDir);
      break;
    }
    case "restore": {
      const file = positional[0] && path.resolve(positional[0]);
      if (!file || !fs.existsSync(file)) fail("Indiquez le fichier de sauvegarde à restaurer (voir CMS_DATA_DIR/backups).");
      const info = inspectBackup(file);
      console.log("Sauvegarde valide :", info.counts, "\nMigrations :", info.migrations.join(", "));
      if (opts.yes !== true) fail("Ajoutez --yes pour confirmer. Arrêtez d'abord le serveur du CMS.");
      const { safety } = await restoreBackup(config, file);
      if (safety) console.log(`✓ Base précédente conservée : ${safety}`);
      const db = openDb();
      audit(db, cli, "backup.restore", "backup", null, path.basename(file));
      console.log("✓ Restauration terminée. Redémarrez le serveur du CMS.");
      break;
    }
    case "verify-backup": {
      const db = openDb();
      const result = verifyBackupRestore(config, db, typeof opts.name === "string" ? opts.name : null);
      audit(db, cli, "backup.restore-test", "backup", null, `${result.ok ? "Réussi" : "Échec"} : ${result.backup || "aucune sauvegarde"}`);
      console.log(result.ok ? `✓ Sauvegarde ${result.backup} utilisable : ${result.detail}` : `✗ ${result.detail}`);
      process.exitCode = result.ok ? 0 : 1;
      break;
    }
    case "status": {
      const db = openDb();
      const n = (t) => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
      console.log(`Base : ${config.dbFile}`);
      console.log(`Site : ${config.siteDir} (mise en ligne : ${config.publishMode}${config.publishMode !== "files" ? ` → ${config.gitRemote}/${config.gitBranch}` : ""})`);
      console.log(`Contenus : ${n("events")} soirée(s), ${n("artists")} artiste(s), ${n("venues")} lieu(x), ${n("media")} média(s), ${n("users")} compte(s)`);
      const last = listBackups(config)[0];
      console.log(`Dernière sauvegarde : ${last ? `${last.name} (${last.createdAt})` : "aucune"}`);
      const publisher = new Publisher({ config, db });
      const pending = publisher.pending();
      console.log(pending.hasChanges ? `Modifications en attente de mise en ligne : ${pending.changed.join(", ") || "images"}` : "Site à jour.");
      const drift = publisher.drift();
      if (drift.length) console.log(`! Modifiés hors du CMS : ${drift.join(", ")}`);
      break;
    }
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ""));
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  if (error instanceof HttpError) fail(`${error.message}${error.extra?.fields ? ` ${JSON.stringify(error.extra.fields)}` : ""}`);
  throw error;
}
