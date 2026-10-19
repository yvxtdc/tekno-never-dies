#!/usr/bin/env node
/**
 * Outils d'exploitation du CMS :  npm run cms:admin -- <commande> [options]
 *
 *   migrate                               applique les migrations de la base
 *   create-user --email E --name N [--role admin|editor]
 *                                         crée un compte ; le mot de passe temporaire est affiché une
 *                                         seule fois (à changer à la première connexion)
 *   reset-password --email E              nouveau mot de passe temporaire
 *   list-users                            liste des comptes
 */
import fs from "node:fs";
import { loadConfig } from "../server/config.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { createUser, resetPassword, listUsers } from "../server/services/users.mjs";
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
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ""));
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  if (error instanceof HttpError) fail(`${error.message}${error.extra?.fields ? ` ${JSON.stringify(error.extra.fields)}` : ""}`);
  throw error;
}
