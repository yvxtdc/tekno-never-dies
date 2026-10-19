/** Utilitaires de test : base temporaire, serveur HTTP réel, client avec cookies. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { loadConfig, REPO_ROOT } from "../server/config.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { createApp } from "../server/app.mjs";
import { createUser } from "../server/services/users.mjs";

export const ORIGIN = "http://cms.test";
export const PASSWORD = "mot-de-passe-de-test-solide";

export function tempDir(prefix = "tnd-cms-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copie du site (sans .git ni données) dans un dossier temporaire, avec node_modules en lien. */
export function copySite({ git = false } = {}) {
  const dir = tempDir("tnd-site-");
  for (const entry of fs.readdirSync(REPO_ROOT)) {
    if ([".git", "node_modules", ".cms-data"].includes(entry)) continue;
    fs.cpSync(path.join(REPO_ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
  if (git) {
    const run = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    run("init", "-q", "-b", "main");
    run("config", "user.email", "test@example.org");
    run("config", "user.name", "Test");
    run("add", "-A");
    run("commit", "-q", "-m", "initial");
  }
  return dir;
}

/**
 * Démarre un CMS de test. options.import : importe les contenus du site ; options.siteDir : copie du site.
 */
export async function startCms({ importContent = false, siteDir = REPO_ROOT, env = {} } = {}) {
  const dataDir = tempDir();
  const config = loadConfig({
    CMS_SKIP_ENV_FILE: "1",
    CMS_DATA_DIR: dataDir,
    CMS_SITE_DIR: siteDir,
    CMS_PUBLIC_URL: ORIGIN,
    CMS_LOG_LEVEL: "silent",
    CMS_SCHEDULER: "0",
    CMS_RUN_MAPS: "0",
    ...env
  });
  const db = openDatabase(config.dbFile);
  db.migrate();
  if (importContent) throw new Error("import des contenus : pas encore disponible");
  const { handler } = createApp({ config, db, log: { info() {}, warn() {}, error() {} } });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    config, db, base, dataDir,
    async createUser(role = "admin", email = `${role}@test.fr`, password = PASSWORD) {
      return (await createUser(db, { email, name: role === "admin" ? "Admin Test" : "Éditeur Test", role }, { password })).user;
    },
    client() {
      return new Client(base);
    },
    async login(role = "admin") {
      const email = `${role}@test.fr`;
      if (!db.get("SELECT 1 FROM users WHERE email = ?", email)) await this.createUser(role, email);
      const client = new Client(base);
      const res = await client.post("/api/auth/login", { email, password: PASSWORD });
      if (res.status !== 200) throw new Error(`login ${res.status} ${JSON.stringify(res.data)}`);
      return client;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = "";
    this.csrf = "";
    this.origin = ORIGIN;
  }

  async request(method, url, { body, headers = {}, raw } = {}) {
    const init = {
      method,
      redirect: "manual",
      headers: {
        ...(this.origin ? { origin: this.origin } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf ? { "x-csrf-token": this.csrf } : {}),
        ...headers
      }
    };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
    const res = await fetch(this.base + url, init);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0].endsWith("=") ? "" : setCookie.split(";")[0];
    const type = res.headers.get("content-type") || "";
    const buffer = Buffer.from(await res.arrayBuffer());
    let data = buffer;
    if (type.includes("json")) data = buffer.length ? JSON.parse(buffer.toString("utf8")) : null;
    else if (type.startsWith("text/")) data = buffer.toString("utf8");
    if (data?.csrf) this.csrf = data.csrf;
    return { status: res.status, headers: res.headers, data, setCookie };
  }

  get(url, o) { return this.request("GET", url, o); }
  post(url, body, o) { return this.request("POST", url, { body, ...o }); }
  put(url, body, o) { return this.request("PUT", url, { body, ...o }); }
  delete(url, o) { return this.request("DELETE", url, o); }

  upload(url, buffer, name, method = "POST") {
    return this.request(method, url, { raw: buffer, headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
  }
}

/** Image de test (PNG, JPEG…) générée par sharp. */
export function testImage({ width = 640, height = 480, format = "png", color = { r: 149, g: 106, b: 255 } } = {}) {
  return sharp({ create: { width, height, channels: 3, background: color } })[format]().toBuffer();
}

/** Soirée minimale valide pour l'API. */
export function eventInput(overrides = {}) {
  return {
    title: "Soirée de test",
    date: "2030-03-14",
    startTime: "21:00",
    endTime: "04:00",
    description: "Une soirée de test.",
    genres: ["Techno"],
    practical: ["Dès 18 ans"],
    lineup: [],
    photos: [],
    ...overrides
  };
}
