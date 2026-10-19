/**
 * Point d'entrée du serveur du CMS : npm run cms (voir docs/cms/README.md).
 */
import http from "node:http";
import fs from "node:fs";
import { loadConfig } from "./config.mjs";
import { openDatabase } from "./db/index.mjs";
import { createApp, createLogger } from "./app.mjs";

const config = loadConfig();
const log = createLogger(config.logLevel);
fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o750 });
const db = openDatabase(config.dbFile);
const applied = db.migrate();
if (applied.length) log.info(`Migrations appliquées : ${applied.join(", ")}`);
if (!db.get("SELECT 1 FROM users WHERE role = 'admin' AND active = 1")) {
  log.warn("Aucun administrateur : créez le premier compte avec  npm run cms:admin -- create-user --email … --name … --role admin");
}

const { handler } = createApp({ config, db, log });
const server = http.createServer({ requestTimeout: 120e3, headersTimeout: 30e3 }, handler);
server.listen(config.port, config.host, () => {
  log.info(`CMS Tekno Never Dies : ${config.publicOrigin}/admin/ (écoute sur ${config.host}:${config.port}, données : ${config.dataDir})`);
  if (!config.cookieSecure && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(config.publicOrigin)) {
    log.warn("Cookies non sécurisés hors de localhost : servez le CMS en HTTPS (CMS_PUBLIC_URL=https://…).");
  }
});

const shutdown = (signal) => {
  log.info(`${signal} reçu : arrêt du serveur…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10e3).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
