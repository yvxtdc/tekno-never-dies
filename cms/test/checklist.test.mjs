/**
 * Vérification avant publication (services/event-checklist.mjs), contrôle à l'exécution des
 * programmations, suivi des soirées (services/lifecycle.mjs) et migration 006.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, eventInput, testImage, tempDir } from "./helpers.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { runDue } from "../server/services/schedule.mjs";
import { translatableTexts } from "../server/services/events.mjs";
import { parseValidation } from "../server/publish/publisher.mjs";
import { parisToUtc, utcToParis, parisToday } from "../server/services/timeutil.mjs";
import { REPO_ROOT } from "../server/config.mjs";
import { execFileSync } from "node:child_process";

const local = (days, time = "18:00") => `${utcToParis(Date.now() + days * 86400e3).local.slice(0, 10)}T${time}`;
const utc = (value) => parisToUtc(value).iso;
const dayFromToday = (n) => utcToParis(Date.now() + n * 86400e3).local.slice(0, 10);

describe("vérification avant publication et suivi des soirées", { timeout: 120e3 }, () => {
  let cms, editor, admin, venue, flyer, artist;
  before(async () => {
    cms = await startCms();
    editor = await cms.login("editor");
    admin = await cms.login("admin");
    venue = (await editor.post("/api/venues", { name: "Salle des fêtes", city: "Munchhausen", postalCode: "67470", lat: "48.92", lon: "8.15" })).data;
    flyer = (await editor.upload("/api/media", await testImage({ width: 1080, height: 1350, format: "jpeg" }), "affiche.jpg")).data.media;
    await editor.put(`/api/media/${flyer.id}`, { alt: "Affiche de la soirée", credit: "", originalName: "affiche.jpg" });
    artist = (await editor.post("/api/artists", { name: "Valk" })).data;
  });
  after(() => cms.close());

  /** Soirée à venir complète : lieu avec plan, affiche avec texte alternatif, billets, line-up, traductions. */
  const completeEvent = async (overrides = {}) => {
    const ev = (await editor.post("/api/events", eventInput({
      title: "Soirée complète", date: dayFromToday(40), venueId: venue.id, flyerMediaId: flyer.id, ticketUrl: "https://www.helloasso.com/x",
      tickets: [{ label: "Regular", price: "12", status: "available" }], lineup: [{ artistIds: [artist.id], startTime: "21:00", endTime: "23:00" }],
      practical: ["Dès 18 ans"], description: "Une soirée complète.", ...overrides
    }))).data;
    for (const text of translatableTexts(ev)) for (const lang of ["de", "en"]) cms.db.run("INSERT OR IGNORE INTO translations (source, lang, text, updated_at) VALUES (?, ?, ?, ?)", text, lang, `[${lang}] ${text}`, new Date().toISOString());
    return (await editor.get(`/api/events/${ev.id}`)).data;
  };
  /** Image dont le fichier a disparu du serveur (import incomplet, disque restauré partiellement…). */
  const brokenMedia = () => Number(cms.db.run(
    "INSERT INTO media (uid, storage, file_name, original_name, mime, alt, created_at, updated_at) VALUES (?, 'upload', 'absent.webp', 'disparue.webp', 'image/webp', 'Affiche', ?, ?)",
    `b${Date.now().toString(16).slice(-11)}`, new Date().toISOString(), new Date().toISOString()
  ).lastInsertRowid);
  const check = async (id) => (await editor.get(`/api/events/${id}/check`)).data;
  const lifecycle = async (id) => (await editor.get(`/api/events/${id}/lifecycle`)).data;

  test("soirée complète : aucune erreur ni avertissement, fiche publique générée, contrôles impossibles signalés", async () => {
    const ev = await completeEvent();
    const report = await check(ev.id);
    assert.equal(report.counts.error, 0, JSON.stringify(report.items.filter((i) => i.level === "error")));
    assert.equal(report.counts.warning, 0, JSON.stringify(report.items.filter((i) => i.level === "warning")));
    assert.ok(report.counts.ok >= 8);
    assert.equal(report.items.find((i) => i.id === "render").level, "ok");
    assert.equal(report.items.find((i) => i.id === "ticket-reachable").level, "unverified");
    assert.equal(report.canPublish, true);
    assert.ok(report.items.every((i) => typeof i.section === "string"));
  });

  test("erreur bloquante (image absente du serveur) : publication immédiate et programmation refusées", async () => {
    const ev = await completeEvent({ title: "Image disparue", flyerMediaId: brokenMedia() });
    const report = await check(ev.id);
    assert.equal(report.canPublish, false);
    const error = report.items.find((i) => i.level === "error");
    assert.equal(error.section, "visuels");
    assert.match(error.message, /disparue\.webp.*introuvable/);
    const publish = await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    assert.equal(publish.status, 422);
    assert.match(Object.values(publish.data.fields).join(" "), /introuvable/);
    const scheduled = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(3) });
    assert.equal(scheduled.status, 422);
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.status, "draft");
  });

  test("avertissements seulement : la publication reste possible", async () => {
    const ev = await completeEvent({ title: "Sans billetterie", ticketUrl: "", tickets: [], description: "" });
    const report = await check(ev.id);
    assert.equal(report.counts.error, 0);
    assert.ok(report.items.some((i) => i.level === "warning" && /sans lien de billetterie/.test(i.message)));
    assert.ok(report.items.some((i) => i.level === "warning" && i.id === "description"));
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "publish" })).status, 200);
  });

  test("soirée passée ou archivée : billetterie et line-up sans objet, pas d'avertissement abusif", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "Édition 2024", date: "2024-06-01", venueId: venue.id, flyerMediaId: flyer.id, lineup: [], practical: [] }))).data;
    const report = await check(ev.id);
    assert.equal(report.items.find((i) => i.id === "ticket-url").level, "na");
    assert.ok(!report.items.some((i) => /Line-up vide|sans lien de billetterie/.test(i.message)));
    assert.equal(report.counts.error, 0);
    await editor.post(`/api/events/${ev.id}/status`, { action: "archive" });
    const archived = await check(ev.id);
    assert.equal(archived.counts.error, 0);
    assert.equal((await lifecycle(ev.id)).phase, "archived");
    assert.equal((await lifecycle(ev.id)).tasks.length, 0);
  });

  test("publication programmée : contrôle refait à l'exécution, programmation conservée, reprise après correction", async () => {
    const ev = await completeEvent({ title: "Programmée puis abîmée" });
    const op = (await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(4) })).data.change;
    // Entre-temps, l'affiche est remplacée par une image dont le fichier manque.
    const current = (await editor.get(`/api/events/${ev.id}`)).data;
    assert.equal((await editor.put(`/api/events/${ev.id}`, { ...current, flyerMediaId: brokenMedia() })).status, 200);
    runDue(cms.db, { at: utc(local(4)) });
    let change = (await editor.get(`/api/schedule/${op.id}`)).data;
    assert.equal(change.status, "failed");
    assert.match(change.result, /introuvable/);
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.status, "scheduled", "rien n'est publié");
    // Correction, puis reprise : appliquée, sans perte de la programmation ni de son journal.
    const again = (await editor.get(`/api/events/${ev.id}`)).data;
    await editor.put(`/api/events/${ev.id}`, { ...again, flyerMediaId: flyer.id });
    const retried = await editor.post(`/api/schedule/${op.id}/resolve`, { action: "retry" });
    assert.equal(retried.data.change.status, "pending", "de nouveau programmée (échéance simulée encore à venir)");
    runDue(cms.db, { at: utc(local(4)) });
    assert.equal((await editor.get(`/api/schedule/${op.id}`)).data.status, "applied");
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.status, "published");
    change = (await editor.get(`/api/schedule/${op.id}`)).data;
    assert.ok(change.log.some((l) => l.action === "failed") && change.log.some((l) => l.action === "applied"));
  });

  test("modification programmée d'une soirée en ligne qui introduirait une erreur : refusée à l'exécution", async () => {
    const ev = await completeEvent({ title: "En ligne, modif. programmée" });
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const live = (await editor.get(`/api/events/${ev.id}`)).data;
    const op = (await editor.post("/api/schedule", { entityType: "event", entityId: ev.id, input: { ...live, flyerMediaId: brokenMedia() }, runAt: local(5), basis: { mode: "current", version: live.version } })).data.change;
    runDue(cms.db, { at: utc(local(5)) });
    assert.equal((await editor.get(`/api/schedule/${op.id}`)).data.status, "failed");
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.flyerMediaId, flyer.id, "soirée en ligne inchangée");
  });

  test("checklist : tâches déduites des données, confirmations manuelles persistantes, « non concerné »", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "En préparation", date: dayFromToday(10), description: "" }))).data;
    let l = await lifecycle(ev.id);
    assert.equal(l.phase, "before");
    const task = (key) => l.tasks.find((t) => t.key === key);
    assert.equal(task("infos").state, "todo");
    assert.equal(task("visuels").state, "todo");
    assert.equal(task("pratique").kind, "manual");
    // Données complétées : les tâches automatiques passent d'elles-mêmes.
    const cur = (await editor.get(`/api/events/${ev.id}`)).data;
    await editor.put(`/api/events/${ev.id}`, { ...cur, description: "Résumé.", flyerMediaId: flyer.id, venueId: venue.id, startTime: "21:00" });
    l = await lifecycle(ev.id);
    assert.equal(task("infos").state, "done");
    assert.equal(task("visuels").state, "done");
    assert.equal(task("horaires-lieu").state, "done");
    // Confirmation manuelle : enregistrée avec l'auteur, relue après coup.
    assert.equal((await editor.put(`/api/events/${ev.id}/tasks/pratique`, { state: "done" })).status, 200);
    l = await lifecycle(ev.id);
    assert.equal(task("pratique").state, "done");
    assert.equal(task("pratique").confirmedBy, "Éditeur Test");
    assert.ok(cms.db.get("SELECT 1 FROM event_tasks WHERE event_id = ? AND task_key = 'pratique'", ev.id));
    // Une tâche déduite ne se coche pas à la main ; « non concerné » seulement si prévu.
    assert.equal((await editor.put(`/api/events/${ev.id}/tasks/infos`, { state: "done" })).status, 409);
    assert.equal((await editor.put(`/api/events/${ev.id}/tasks/infos`, { state: "skipped" })).status, 409);
    assert.equal((await editor.put(`/api/events/${ev.id}/tasks/billetterie`, { state: "skipped" })).status, 200);
    l = await lifecycle(ev.id);
    assert.equal(task("billetterie").state, "skipped");
    assert.equal((await editor.put(`/api/events/${ev.id}/tasks/inconnue`, { state: "done" })).status, 404);
    // Échéances relatives à la date : recalculées quand la date change.
    const due = task("infos").dueDate;
    const moved = (await editor.get(`/api/events/${ev.id}`)).data;
    await editor.put(`/api/events/${ev.id}`, { ...moved, date: dayFromToday(20) });
    l = await lifecycle(ev.id);
    assert.notEqual(task("infos").dueDate, due);
    assert.equal(task("infos").dueDate, utcToParis(Date.parse(`${dayFromToday(20)}T12:00:00Z`) - 30 * 86400e3).local.slice(0, 10));
    // Duplication : la nouvelle édition repart sans aucune confirmation.
    const copy = (await editor.post(`/api/events/${ev.id}/duplicate`)).data;
    const copied = await lifecycle(copy.id);
    assert.ok(copied.tasks.filter((t) => t.kind === "manual").every((t) => t.state === "todo"));
    assert.equal(copied.tasks.find((t) => t.key === "billetterie").state === "skipped", false);
    assert.equal(cms.db.get("SELECT COUNT(*) AS n FROM event_tasks WHERE event_id = ?", copy.id).n, 0);
  });

  test("après la soirée : clôture (photos, participants, DJ Contest), annulée, brouillon jamais publié", async () => {
    const mystery = (await editor.post("/api/artists", { name: "DJ Mystère", mystery: true })).data;
    const ev = (await editor.post("/api/events", eventInput({ title: "Passée", date: dayFromToday(-3), venueId: venue.id, flyerMediaId: flyer.id, lineup: [{ artistIds: [mystery.id], startTime: "21:00" }], contest: { deadline: dayFromToday(-10) } }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    let l = await lifecycle(ev.id);
    assert.equal(l.phase, "after");
    assert.ok(l.tasks.every((t) => t.phase === "after"), "la préparation n'est plus affichée");
    assert.equal(l.tasks.find((t) => t.key === "contest-resultat").state, "todo");
    assert.equal(l.tasks.find((t) => t.key === "participants").state, "todo");
    const cur = (await editor.get(`/api/events/${ev.id}`)).data;
    await editor.put(`/api/events/${ev.id}`, { ...cur, practical: ["320 participant·es"], lineup: [{ artistIds: [artist.id], startTime: "21:00" }] });
    l = await lifecycle(ev.id);
    assert.equal(l.tasks.find((t) => t.key === "participants").state, "done");
    assert.equal(l.tasks.find((t) => t.key === "contest-resultat").state, "done");
    assert.equal(l.phaseLabel, "Clôture à faire");
    // Annulée : tâches d'annulation, sans billetterie ni line-up.
    const cancelled = await completeEvent({ title: "Annulée" });
    await editor.post(`/api/events/${cancelled.id}/status`, { action: "publish" });
    await editor.post(`/api/events/${cancelled.id}/status`, { action: "cancel" });
    const lc = await lifecycle(cancelled.id);
    assert.equal(lc.phase, "cancelled");
    assert.deepEqual(lc.tasks.map((t) => t.key).sort(), ["annulation", "annulation-communiquee", "deploiement", "infos", "horaires-lieu", "traductions", "verification", "visuels"].sort());
    // Brouillon dont la date est passée, jamais publié : aucune tâche de clôture.
    const draft = (await editor.post("/api/events", eventInput({ title: "Jamais publiée", date: dayFromToday(-5) }))).data;
    assert.equal((await lifecycle(draft.id)).phase, "unpublished-past");
  });

  test("mise en ligne : la tâche n'est faite que lorsque le déploiement du site est confirmé", async () => {
    const ev = await completeEvent({ title: "Déploiement suivi" });
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const updated = cms.db.get("SELECT updated_at FROM events WHERE id = ?", ev.id).updated_at;
    const later = new Date(Date.parse(updated) + 1000).toISOString();
    const id = Number(cms.db.run("INSERT INTO publications (status, trigger, mode, started_at, finished_at, commit_sha, deploy_status) VALUES ('success', 'manual', 'push', ?, ?, 'abc1234', 'in_progress')", later, later).lastInsertRowid);
    let task = (await lifecycle(ev.id)).tasks.find((t) => t.key === "deploiement");
    assert.equal(task.state, "todo");
    assert.match(task.progress, /en cours/);
    cms.db.run("UPDATE publications SET deploy_status = 'success' WHERE id = ?", id);
    task = (await lifecycle(ev.id)).tasks.find((t) => t.key === "deploiement");
    assert.equal(task.state, "done");
  });

  test("vue d'ensemble : filtres et compteurs", async () => {
    const all = (await editor.get("/api/lifecycle")).data;
    assert.ok(all.items.length >= 3);
    for (const filter of ["preparation", "late", "errors", "closing", "done"]) {
      const res = (await editor.get(`/api/lifecycle?filter=${filter}`)).data;
      assert.equal(res.items.length, all.counts[filter]);
    }
    assert.ok(all.counts.errors >= 1, "la soirée à l'image disparue est signalée");
    assert.ok(!all.items.some((i) => i.event.status === "archived"));
    assert.equal((await cms.client().get("/api/lifecycle")).status, 401);
  });
});

describe("validation du site à la mise en ligne", () => {
  test("tools/validate.mjs --json : mêmes règles que la sortie texte, erreurs et avertissements séparés", () => {
    const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, ["tools/validate.mjs", ...args], { cwd: REPO_ROOT, encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
    const json = run(["--json"]);
    const report = parseValidation(json);
    const text = run([]);
    assert.equal(report.ok, text.code === 0);
    assert.equal(report.warnings.length, (text.out.match(/^ {2}- /gm) || []).length);
    assert.ok(report.files > 50 && report.pages > 10);
    // Sortie illisible : jamais une validation réussie par défaut.
    assert.equal(parseValidation({ code: 0, out: "rien d'exploitable" }).ok, false);
    assert.equal(parseValidation({ code: 1, out: JSON.stringify({ ok: true, errors: [], warnings: [] }) }).ok, false);
  });
});

describe("migration 006 sur une base existante", () => {
  test("mises en ligne et soirées conservées ; déploiements antérieurs « inconnus », aucune tâche", async () => {
    const { listMigrations } = await import("../server/db/migrate.mjs");
    const dir = tempDir();
    const db = openDatabase(path.join(dir, "cms.sqlite"));
    try {
      db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of listMigrations().filter((n) => n < "006")) {
        db.exec(fs.readFileSync(path.join(import.meta.dirname, "../server/db/migrations", name), "utf8"));
        db.run("INSERT INTO schema_migrations VALUES (?, ?)", name, new Date().toISOString());
      }
      const t = new Date().toISOString();
      db.run("INSERT INTO events (slug, title, date, created_at, updated_at) VALUES ('ancienne-2025', 'Ancienne', '2025-05-01', ?, ?)", t, t);
      db.run("INSERT INTO publications (status, trigger, mode, started_at, finished_at, commit_sha, summary) VALUES ('success', 'manual', 'push', ?, ?, 'abc', 'ok')", t, t);
      db.run("INSERT INTO publications (status, trigger, mode, started_at, finished_at, summary) VALUES ('failed', 'manual', 'push', ?, ?, 'échec')", t, t);
      db.run("INSERT INTO publications (status, trigger, mode, started_at, finished_at, summary) VALUES ('success', 'manual', 'files', ?, ?, 'ok')", t, t);
      const before = db.get("SELECT * FROM events WHERE id = 1");
      assert.deepEqual(db.migrate(), ["006_supervision.sql"]);
      assert.deepEqual(db.get("SELECT * FROM events WHERE id = 1"), before);
      assert.deepEqual(db.all("SELECT status, deploy_status FROM publications ORDER BY id").map((r) => [r.status, r.deploy_status]), [["success", "unknown"], ["failed", null], ["success", "not_sent"]]);
      assert.equal(db.get("SELECT COUNT(*) AS n FROM event_tasks").n, 0);
      // Noms déjà portés à la migration : sans date (tout leur historique revient à la soirée).
      assert.deepEqual(db.all("SELECT kind, value, since FROM event_names WHERE event_id = 1 ORDER BY kind").map((r) => ({ ...r })), [{ kind: "slug", value: "ancienne-2025", since: null }, { kind: "title", value: "Ancienne", since: null }]);
      // Noms pris ensuite : datés, quel que soit le code qui écrit.
      db.run("UPDATE events SET title = 'Ancienne (renommée)', slug = 'ancienne-renommee-2025' WHERE id = 1");
      assert.ok(db.get("SELECT since FROM event_names WHERE event_id = 1 AND value = 'ancienne-renommee-2025'").since);
      assert.ok(db.get("SELECT since FROM event_names WHERE event_id = 1 AND value = 'Ancienne (renommée)'").since);
      // Une adresse (actuelle ou ancienne) n'appartient qu'à une soirée, même par une écriture directe.
      db.run("INSERT INTO event_redirects (old_slug, event_id, created_at) VALUES ('ancienne-2025', 1, ?)", t);
      db.run("INSERT INTO events (slug, title, date, created_at, updated_at) VALUES ('autre-2026', 'Autre', '2026-05-01', ?, ?)", t, t);
      assert.throws(() => db.run("UPDATE events SET slug = 'ancienne-2025' WHERE slug = 'autre-2026'"), /ancienne adresse d'une autre soirée/);
      assert.throws(() => db.run("INSERT INTO events (slug, title, date, created_at, updated_at) VALUES ('ancienne-2025', 'X', '2026-05-01', ?, ?)", t, t), /ancienne adresse d'une autre soirée/);
      assert.throws(() => db.run("INSERT INTO event_redirects (old_slug, event_id, created_at) VALUES ('autre-2026', 1, ?)", t), /déjà utilisée par une autre soirée/);
      db.run("DELETE FROM events WHERE slug = 'autre-2026'");
      // Une confirmation suit la soirée : supprimée avec elle.
      db.run("INSERT INTO event_tasks (event_id, event_generation, task_key, state, updated_at) VALUES (1, 1, 'pratique', 'done', ?)", t);
      db.run("DELETE FROM events WHERE id = 1");
      assert.equal(db.get("SELECT COUNT(*) AS n FROM event_tasks").n, 0);
      assert.equal(db.get("SELECT COUNT(*) AS n FROM event_names WHERE event_id = 1").n, 0, "noms supprimés avec la soirée");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
