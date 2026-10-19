import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startCms, copySite, eventInput, testImage, tempDir } from "./helpers.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("mise en ligne (mode commit, dépôt Git temporaire)", { timeout: 300e3 }, () => {
  let siteDir, cms, admin, editor;
  before(async () => {
    siteDir = copySite({ git: true });
    cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "commit" } });
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(async () => {
    await cms.close();
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  test("première mise en ligne : seuls les fichiers de données changent de format (et l'ordre de l'agenda), pages inchangées", async () => {
    const before = git(siteDir, "rev-parse", "HEAD");
    const res = await editor.post("/api/publications", {});
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "success", res.data.log);
    assert.match(res.data.log, /Validation OK/);
    const files = git(siteDir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    assert.notEqual(git(siteDir, "rev-parse", "HEAD"), before);
    // L'agenda est réordonné par date (ordre des soirées dans le fichier, sans effet dans les applications d'agenda).
    assert.ok(files.every((f) => f.startsWith("js/data/") || f.startsWith("js/i18n/contenus-") || f.startsWith("calendar/")), files.join(", "));
    assert.ok(!files.some((f) => f.endsWith(".html") || f === "sitemap.xml"), "aucune page modifiée");
    assert.equal(git(siteDir, "status", "--porcelain"), "", "rien d'autre n'est modifié");
    assert.match(git(siteDir, "log", "-1", "--format=%an %s"), /^CMS Tekno Never Dies contenu: mise en ligne depuis le CMS/);
  });

  test("mise en ligne sans modification : aucun commit", async () => {
    const head = git(siteDir, "rev-parse", "HEAD");
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "success", res.data.log);
    assert.match(res.data.summary, /Aucun changement/);
    assert.equal(git(siteDir, "rev-parse", "HEAD"), head);
  });

  test("nouvelle soirée publiée : fiche, pages traduites, agenda, sitemap, image optimisée", async () => {
    const flyer = (await editor.upload("/api/media", await testImage({ width: 1080, height: 1350, format: "jpeg", color: { r: 180, g: 30, b: 150 } }), "Flyer Printemps.jpg")).data.media;
    const ev = (await editor.post("/api/events", eventInput({ title: "Printemps Tekno", slug: "printemps-tekno-2030", flyerMediaId: flyer.id, ticketUrl: "https://www.helloasso.com/x" }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const pending = await editor.get("/api/publications/pending");
    assert.equal(pending.data.hasChanges, true);
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "success", res.data.log);
    const files = git(siteDir, "show", "--name-only", "--format=", "HEAD").split("\n");
    for (const f of ["evenement-printemps-tekno-2030.html", "de/evenement-printemps-tekno-2030.html", "en/evenement-printemps-tekno-2030.html", "calendar/events.ics", "sitemap.xml", "js/data/events.js", "assets/img/events/og/printemps-tekno-2030.jpg"]) {
      assert.ok(files.includes(f), `${f} dans le commit`);
    }
    assert.ok(files.some((f) => /^assets\/img\/cms\/flyer-printemps-[0-9a-f]{12}-v1\.webp$/.test(f)));
    const page = fs.readFileSync(path.join(siteDir, "evenement-printemps-tekno-2030.html"), "utf8");
    assert.match(page, /<title>Printemps Tekno — Tekno Never Dies<\/title>/);
    assert.match(page, /"@type": "Event"/);
    assert.match(fs.readFileSync(path.join(siteDir, "calendar/events.ics"), "utf8"), /Printemps Tekno/);
    assert.equal((await editor.get("/api/publications/pending")).data.hasChanges, false);
  });

  test("dépublier : la fiche disparaît du site au prochain envoi", async () => {
    const id = cms.db.get("SELECT id FROM events WHERE slug = 'printemps-tekno-2030'").id;
    await editor.post(`/api/events/${id}/status`, { action: "unpublish" });
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "success", res.data.log);
    assert.equal(fs.existsSync(path.join(siteDir, "evenement-printemps-tekno-2030.html")), false);
    assert.doesNotMatch(fs.readFileSync(path.join(siteDir, "sitemap.xml"), "utf8"), /printemps-tekno/);
    assert.equal(fs.readdirSync(path.join(siteDir, "assets/img/cms")).filter((f) => f.includes("printemps")).length, 0, "image inutilisée retirée");
  });

  test("fichier modifié à la main hors du CMS : mise en ligne bloquée, forçage réservé aux administrateurs", async () => {
    const faq = path.join(siteDir, "js/data/faq.js");
    fs.appendFileSync(faq, "\n// modification manuelle\n");
    git(siteDir, "commit", "-qam", "modif manuelle");
    const blocked = await editor.post("/api/publications", {});
    assert.equal(blocked.data.status, "failed");
    assert.match(blocked.data.summary, /modifiés hors du CMS.*: js\/data\/faq\.js/);
    assert.match(fs.readFileSync(faq, "utf8"), /modification manuelle/, "rien n'a été écrasé");
    const editorForce = await editor.post("/api/publications", { force: true });
    assert.equal(editorForce.data.status, "failed", "un éditeur ne peut pas forcer");
    const forced = await admin.post("/api/publications", { force: true });
    assert.equal(forced.data.status, "success", forced.data.log);
    assert.doesNotMatch(fs.readFileSync(faq, "utf8"), /modification manuelle/);
  });

  test("lieu sans plan (OpenStreetMap indisponible) : soirée publiée sans « Y aller », toujours signalée en attente", async () => {
    const venue = (await editor.post("/api/venues", { name: "Salle sans plan", city: "Seltz", lat: 48.89, lon: 8.1 })).data;
    const ev = (await editor.post("/api/events", eventInput({ title: "Sans plan", slug: "sans-plan-2030", venueId: venue.id }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "success", res.data.log);
    assert.match(res.data.summary, /Sans plan « Y aller »/);
    const events = fs.readFileSync(path.join(siteDir, "js/data/events.js"), "utf8");
    assert.match(events, /sans-plan-2030/);
    assert.equal((await editor.get("/api/publications/pending")).data.hasChanges, true, "le plan reste à publier");
    await editor.post(`/api/events/${ev.id}/status`, { action: "unpublish" });
    assert.equal((await editor.post("/api/publications", {})).data.status, "success");
  });

  test("validation du site en échec : fichiers restaurés, rien n'est commité", async () => {
    // Image du dépôt supprimée alors qu'une soirée l'utilise : validate signale « fichier absent ».
    git(siteDir, "rm", "-q", "assets/img/events/soiree2.webp");
    git(siteDir, "commit", "-qm", "image supprimée par erreur");
    const id = cms.db.get("SELECT id FROM events WHERE slug = 'center-drop-2026'").id;
    const full = (await editor.get(`/api/events/${id}`)).data;
    await editor.put(`/api/events/${id}`, { ...full, aboutTitle: "Nouvelle accroche" });
    const head = git(siteDir, "rev-parse", "HEAD");
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "failed");
    assert.match(res.data.log, /fichier absent : assets\/img\/events\/soiree2\.webp/);
    assert.match(res.data.log, /restaurés/);
    assert.equal(git(siteDir, "rev-parse", "HEAD"), head);
    assert.equal(git(siteDir, "status", "--porcelain"), "", "copie de travail propre");
    assert.equal((await editor.get("/api/publications/pending")).data.drift.length, 0, "pas de faux signalement après restauration");
    git(siteDir, "revert", "--no-edit", "HEAD");
  });

  test("historique des mises en ligne et journal", async () => {
    const list = await editor.get("/api/publications");
    assert.ok(list.data.items.length >= 4);
    assert.ok(list.data.items.some((p) => p.status === "failed"));
    const detail = await editor.get(`/api/publications/${list.data.items[0].id}`);
    assert.ok(detail.data.log.length > 0);
    assert.ok(cms.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'site.publish'").n >= 3);
  });
});

describe("mise en ligne : modes fichiers et push", { timeout: 300e3 }, () => {
  test("mode files : fichiers écrits sans Git", async () => {
    const siteDir = copySite();
    const cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "files" } });
    const editor = await cms.login("editor");
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "success", res.data.log);
    assert.match(fs.readFileSync(path.join(siteDir, "js/data/events.js"), "utf8"), /FICHIER GÉNÉRÉ par le CMS/);
    await cms.close();
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  test("mode push : le commit arrive sur le dépôt distant ; une branche distante divergente bloque", async () => {
    const remote = tempDir("tnd-remote-");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    const siteDir = copySite({ git: true });
    git(siteDir, "remote", "add", "origin", remote);
    git(siteDir, "push", "-q", "origin", "main");
    const cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "push" } });
    const editor = await cms.login("editor");
    const res = await editor.post("/api/publications", {});
    assert.equal(res.data.status, "success", res.data.log);
    assert.equal(git(remote, "rev-parse", "main"), git(siteDir, "rev-parse", "HEAD"));
    // Quelqu'un pousse un autre commit, et la copie du CMS a un commit local non poussé : divergence.
    const other = tempDir("tnd-clone-");
    execFileSync("git", ["clone", "-q", remote, other]);
    git(other, "-c", "user.email=a@b.c", "-c", "user.name=Dev", "commit", "-q", "--allow-empty", "-m", "dev");
    git(other, "push", "-q", "origin", "main");
    git(siteDir, "commit", "-q", "--allow-empty", "-m", "local");
    const ev = (await editor.post("/api/events", eventInput({ title: "Divergence" }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const blocked = await editor.post("/api/publications", {});
    assert.equal(blocked.data.status, "failed");
    assert.match(blocked.data.log, /historique divergent/);
    await cms.close();
    for (const d of [remote, siteDir, other]) fs.rmSync(d, { recursive: true, force: true });
  });
});
