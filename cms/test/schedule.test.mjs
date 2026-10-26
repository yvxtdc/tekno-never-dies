/**
 * Programmations ciblées (services/schedule.mjs) : modifications précises appliquées à une date, chaînes
 * par clé, conflits, dépendances, reprise, mise en ligne. Le temps qui passe est simulé en exécutant les
 * programmations dues à une date donnée (runDue({ at })) : aucun test n'attend l'heure réelle.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, copySite, eventInput } from "./helpers.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { runDue, executeChange, parseRunAt } from "../server/services/schedule.mjs";
import { TARGETS, pick } from "../server/services/schedule-targets.mjs";
import { buildSiteData } from "../server/export/site-data.mjs";
import { Publisher } from "../server/publish/publisher.mjs";
import { startScheduler } from "../server/publish/scheduler.mjs";
import { parisToUtc, utcToParis } from "../server/services/timeutil.mjs";

/** Heure de Paris « AAAA-MM-JJTHH:MM », dans `days` jours. */
const local = (days, time = "18:00") => `${utcToParis(Date.now() + days * 86400e3).local.slice(0, 10)}T${time}`;
const utc = (value) => parisToUtc(value).iso;
const publicData = (db) => buildSiteData(db, { mode: "public" });

describe("programmations ciblées", { timeout: 120e3 }, () => {
  let cms, editor, admin, artists;
  before(async () => {
    cms = await startCms();
    editor = await cms.login("editor");
    admin = await cms.login("admin");
    artists = {};
    for (const name of ["Dann Octa", "Valk", "Redfox", "Leander", "Nova"]) artists[name] = (await editor.post("/api/artists", { name })).data.id;
  });
  after(() => cms.close());

  const run = (when) => runDue(cms.db, { at: utc(when) });
  const getEvent = async (id) => (await editor.get(`/api/events/${id}`)).data;
  const createEvent = async (overrides = {}) => (await editor.post("/api/events", eventInput(overrides))).data;
  const publishedEvent = async (overrides = {}) => {
    const ev = await createEvent(overrides);
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "publish" })).status, 200);
    return getEvent(ev.id);
  };
  /** Programme le formulaire `input` (fiche complète) préparé sur l'état actuel ou prévu. */
  const schedule = (entityType, entityId, input, runAt, basis) => editor.post("/api/schedule", { entityType, entityId, input, runAt, basis: basis || { mode: "current", version: input.version } });
  const change = async (id) => (await editor.get(`/api/schedule/${id}`)).data;
  const hour = (h) => `${String(h % 24).padStart(2, "0")}:00`;
  const lineup = (...names) => names.map((n, i) => ({ artistIds: [artists[n]], startTime: hour(21 + i), endTime: hour(22 + i) }));

  test("1. publication programmée d'une nouvelle soirée : invisible avant, publiée à l'heure", async () => {
    const ev = await createEvent({ title: "Nouvelle soirée programmée", lineup: lineup("Valk") });
    const res = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(10, "18:00") });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal((await getEvent(ev.id)).status, "scheduled");
    assert.ok(!publicData(cms.db).events.some((e) => e.slug === ev.slug), "pas sur le site avant l'échéance");
    assert.deepEqual(run(local(10, "17:59")).filter((r) => r.id === res.data.change.id), [], "rien avant l'heure");
    const done = run(local(10, "18:00")).find((r) => r.id === res.data.change.id);
    assert.equal(done.status, "applied");
    assert.equal((await getEvent(ev.id)).status, "published");
    assert.ok(publicData(cms.db).events.some((e) => e.slug === ev.slug));
    assert.equal((await change(res.data.change.id)).status, "applied");
  });

  test("2. modification programmée d'une soirée publiée : seul le champ visé change, à l'échéance", async () => {
    const ev = await publishedEvent({ title: "Soirée à modifier", price: "10 €", age: "Dès 18 ans" });
    const res = await schedule("event", ev.id, { ...ev, price: "15 €" }, local(11));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.change.changes.map((c) => c.key), ["price"]);
    assert.equal((await getEvent(ev.id)).price, "10 €", "rien n'est visible avant l'heure");
    run(local(11));
    const after = await getEvent(ev.id);
    assert.equal(after.price, "15 €");
    assert.equal(after.age, "Dès 18 ans");
    assert.equal(after.title, "Soirée à modifier");
  });

  test("3 et 20. line-up : ajout, retrait, horaire, ordre ; le reste de la fiche et des passages est préservé", async () => {
    const ev = await publishedEvent({ title: "Line-up programmé", lineup: lineup("Valk", "Redfox", "Leander"), practical: ["Bouchons offerts"] });
    const [valk, redfox, leander] = ev.lineup;
    // Formulaire : Leander retiré, Nova ajoutée en ouverture, Redfox avance à 22:30, Valk passe après Redfox.
    const desired = [
      { artistIds: [artists.Nova], startTime: "20:00", endTime: "21:00" },
      { ...redfox, startTime: "22:30" },
      { ...valk }
    ];
    const res = await schedule("event", ev.id, { ...ev, lineup: desired }, local(12));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const kinds = [...new Set(res.data.change.changes.map((c) => c.kind))].sort();
    assert.deepEqual(kinds, ["slot-add", "slot-field", "slot-order", "slot-remove"]);
    // Modification manuelle indépendante entre-temps : un autre champ et un autre passage.
    const current = await getEvent(ev.id);
    const manual = await editor.put(`/api/events/${ev.id}`, { ...current, title: "Line-up programmé (titre corrigé)", lineup: current.lineup.map((s) => (s.uid === valk.uid ? { ...s, style: "Hard Trance" } : s)) });
    assert.equal(manual.status, 200, JSON.stringify(manual.data));
    const before = await getEvent(ev.id);
    run(local(12));
    const after = await getEvent(ev.id);
    assert.equal(after.title, "Line-up programmé (titre corrigé)", "modification manuelle conservée");
    assert.deepEqual(after.lineup.map((s) => s.artists[0].name), ["Nova", "Redfox", "Valk"]);
    assert.equal(after.lineup[1].uid, redfox.uid, "identifiant stable du passage conservé");
    assert.equal(after.lineup[1].startTime, "22:30");
    assert.equal(after.lineup[2].style, "Hard Trance", "style saisi entre-temps sur un autre passage conservé");
    assert.ok(!after.lineup.some((s) => s.uid === leander.uid));
    // 20. Préservation stricte : tous les champs non visés sont identiques.
    for (const key of Object.keys(TARGETS.event.fields)) {
      if (key === "lineup") continue;
      assert.deepEqual(pick("event", after, key), pick("event", before, key), `champ ${key} préservé`);
    }
  });

  test("4. ajout programmé d'un membre de l'association", async () => {
    const member = (await editor.post("/api/team", { name: "Camille", role: "Bénévole", published: false })).data;
    assert.ok(!publicData(cms.db).TEAM.some((m) => m.slug === member.slug));
    const res = await schedule("team", member.id, { ...member, published: true }, local(13, "20:00"));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(!publicData(cms.db).TEAM.some((m) => m.slug === member.slug), "toujours masqué avant l'heure");
    run(local(13, "20:00"));
    assert.ok(publicData(cms.db).TEAM.some((m) => m.slug === member.slug && m.name === "Camille"));
  });

  test("5. scénario de référence : quatre programmations indépendantes sur les mêmes fichiers", async () => {
    const day = 14;
    const a = await createEvent({ title: "Soirée A", lineup: lineup("Valk") });
    const b = await publishedEvent({ title: "Soirée B", practical: ["Parking à côté"] });
    const member = (await editor.post("/api/team", { name: "Sam", role: "Technique", published: false })).data;
    const r18 = await editor.post("/api/schedule/status", { entityType: "event", entityId: a.id, action: "publish", runAt: local(day, "18:00") });
    const aNow = await getEvent(a.id);
    const r19 = await schedule("event", a.id, { ...aNow, lineup: [...aNow.lineup, ...lineup("Redfox").map((s) => ({ ...s, startTime: "23:00", endTime: "00:30" }))] }, local(day, "19:00"));
    const r20 = await schedule("team", member.id, { ...member, published: true }, local(day, "20:00"));
    const r21 = await schedule("event", b.id, { ...b, practical: ["Parking à côté", "Navette gratuite depuis la gare"] }, local(day, "21:00"));
    for (const r of [r18, r19, r20, r21]) assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r19.data.change.dependsOn.map((d) => d.id), [r18.data.change.id], "le line-up dépend de la mise en ligne");
    // Entre 19 h et 20 h : A publiée avec son nouveau line-up, le membre pas encore visible.
    run(local(day, "19:30"));
    let data = publicData(cms.db);
    const exportedA = data.events.find((e) => e.slug === a.slug);
    assert.deepEqual(exportedA.lineup.map((s) => s.name), ["Valk", "Redfox"]);
    assert.ok(!data.TEAM.some((m) => m.slug === member.slug));
    run(local(day, "21:00"));
    data = publicData(cms.db);
    assert.ok(data.events.some((e) => e.slug === a.slug));
    assert.ok(data.TEAM.some((m) => m.slug === member.slug));
    assert.deepEqual(data.events.find((e) => e.slug === b.slug).practical, ["Parking à côté", "Navette gratuite depuis la gare"]);
    for (const r of [r18, r19, r20, r21]) assert.equal((await change(r.data.change.id)).status, "applied");
  });

  test("6. deux champs différents du même objet : horaires puis prix, les deux sont conservés", async () => {
    const ev = await publishedEvent({ title: "Deux champs", price: "10 €" });
    assert.equal((await schedule("event", ev.id, { ...ev, startTime: "22:00" }, local(15, "18:00"))).status, 200);
    const later = await schedule("event", ev.id, { ...(await getEvent(ev.id)), price: "12 €" }, local(15, "20:00"));
    assert.equal(later.status, 200, JSON.stringify(later.data));
    run(local(15, "21:00"));
    const after = await getEvent(ev.id);
    assert.equal(after.startTime, "22:00");
    assert.equal(after.price, "12 €");
  });

  test("6 bis. artiste : nouvelle photo puis nouvelle biographie, sans s'annuler", async () => {
    const media = cms.db.run("INSERT INTO media (uid, storage, repo_path, original_name, mime, created_at, updated_at) VALUES ('abc123def456', 'repo', 'assets/img/artistes/dj-contest.webp', 'photo.webp', 'image/webp', ?, ?)", new Date().toISOString(), new Date().toISOString());
    const artist = (await editor.get(`/api/artists/${artists.Leander}`)).data;
    assert.equal((await schedule("artist", artist.id, { ...artist, photoMediaId: Number(media.lastInsertRowid) }, local(16, "18:00"))).status, 200);
    assert.equal((await schedule("artist", artist.id, { ...artist, bio: "Pilier de la scène strasbourgeoise." }, local(16, "19:00"))).status, 200);
    run(local(16, "19:00"));
    const after = (await editor.get(`/api/artists/${artist.id}`)).data;
    assert.equal(after.photoMediaId, Number(media.lastInsertRowid));
    assert.equal(after.bio, "Pilier de la scène strasbourgeoise.");
  });

  test("7 et 16. même champ programmé deux fois : ordre respecté, sans faux conflit", async () => {
    const ev = await publishedEvent({ title: "Prix successifs", price: "10 €" });
    const first = await schedule("event", ev.id, { ...ev, price: "12 €" }, local(17, "18:00"));
    assert.equal(first.status, 200);
    // Préparée sur l'état actuel, la seconde serait ambiguë : refus explicite (pas d'écrasement silencieux).
    const stale = await schedule("event", ev.id, { ...ev, price: "15 €" }, local(17, "20:00"));
    assert.equal(stale.status, 409);
    assert.equal(stale.data.scheduleConflicts[0].key, "price");
    // Préparée sur l'état prévu à 20 h (prix à 12 €) : acceptée.
    const predicted = (await editor.get(`/api/schedule/predict/event/${ev.id}?at=${local(17, "20:00")}`)).data;
    assert.equal(predicted.entity.price, "12 €");
    const second = await schedule("event", ev.id, { ...predicted.entity, price: "15 €" }, local(17, "20:00"), predicted.basis);
    assert.equal(second.status, 200, JSON.stringify(second.data));
    run(local(17, "19:00"));
    assert.equal((await getEvent(ev.id)).price, "12 €");
    run(local(17, "20:00"));
    assert.equal((await getEvent(ev.id)).price, "15 €");
    assert.equal((await change(second.data.change.id)).status, "applied", "aucun faux conflit");

    // 16. Programmation insérée AVANT une autre déjà prévue sur le même champ.
    const ev2 = await publishedEvent({ title: "Insertion avant", price: "10 €" });
    const late = await schedule("event", ev2.id, { ...ev2, price: "20 €" }, local(18, "20:00"));
    const early = await schedule("event", ev2.id, { ...ev2, price: "14 €" }, local(18, "18:00"));
    assert.equal(early.status, 200, JSON.stringify(early.data));
    assert.match(early.data.warnings.join(" "), /modifie aussi/);
    run(local(18, "18:30"));
    assert.equal((await getEvent(ev2.id)).price, "14 €");
    run(local(18, "20:00"));
    assert.equal((await getEvent(ev2.id)).price, "20 €");
    assert.equal((await change(late.data.change.id)).status, "applied");
  });

  test("8 et 9. modification manuelle : autres champs préservés ; même champ = conflit, puis résolution", async () => {
    const ev = await publishedEvent({ title: "Conflit", price: "10 €", description: "Avant." });
    const op = await schedule("event", ev.id, { ...ev, price: "12 €" }, local(19));
    const other = await schedule("event", ev.id, { ...ev, description: "Description programmée." }, local(19, "19:00"));
    let current = await getEvent(ev.id);
    assert.equal((await editor.put(`/api/events/${ev.id}`, { ...current, title: "Conflit (renommé)", price: "11 €" })).status, 200);
    run(local(19, "19:00"));
    const conflicted = await change(op.data.change.id);
    assert.equal(conflicted.status, "conflict");
    const priceChange = conflicted.changes.find((c) => c.key === "price");
    assert.deepEqual([priceChange.from, priceChange.current, priceChange.to], ["10 €", "11 €", "12 €"], "valeurs de référence, actuelle et programmée");
    current = await getEvent(ev.id);
    assert.equal(current.price, "11 €", "valeur saisie à la main jamais écrasée silencieusement");
    assert.equal(current.title, "Conflit (renommé)");
    assert.equal(current.description, "Description programmée.", "programmation indépendante appliquée");
    assert.equal((await change(other.data.change.id)).status, "applied");
    const forced = await editor.post(`/api/schedule/${op.data.change.id}/resolve`, { action: "force" });
    assert.equal(forced.data.change.status, "applied");
    assert.equal((await getEvent(ev.id)).price, "12 €");
    assert.equal((await getEvent(ev.id)).title, "Conflit (renommé)");
  });

  test("10. annulation, déplacement et modification du contenu d'une programmation", async () => {
    const ev = await publishedEvent({ title: "Gestion", price: "10 €", age: "Dès 18 ans" });
    const moved = await schedule("event", ev.id, { ...ev, price: "13 €" }, local(20, "18:00"));
    const cancelled = await schedule("event", ev.id, { ...ev, age: "Dès 16 ans" }, local(20, "18:00"));
    const reschedule = await editor.put(`/api/schedule/${moved.data.change.id}`, { runAt: local(21, "18:00"), version: moved.data.change.version });
    assert.equal(reschedule.status, 200, JSON.stringify(reschedule.data));
    assert.equal((await editor.post(`/api/schedule/${cancelled.data.change.id}/cancel`, {})).data.change.status, "cancelled");
    run(local(20, "23:00"));
    assert.equal((await getEvent(ev.id)).price, "10 €", "déplacée : pas exécutée à l'ancienne date");
    assert.equal((await getEvent(ev.id)).age, "Dès 18 ans", "annulée : jamais exécutée");
    // Nouveau contenu (même programmation, même numéro).
    const predicted = (await editor.get(`/api/schedule/predict/event/${ev.id}?at=${local(21, "18:00")}`)).data;
    assert.equal(predicted.entity.price, "13 €");
    const edited = await editor.post("/api/schedule", { entityType: "event", entityId: ev.id, input: { ...predicted.entity, price: "14 €" }, runAt: local(21, "18:00"), basis: predicted.basis, replaceId: moved.data.change.id });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.change.id, moved.data.change.id);
    run(local(21, "18:00"));
    assert.equal((await getEvent(ev.id)).price, "14 €");
  });

  test("11 et 12. dépendance : modification d'une soirée pas encore publiée ; échec de la publication", async () => {
    const ev = await createEvent({ title: "Dépendance", lineup: lineup("Valk") });
    const pub = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(22, "18:00") });
    const draft = await getEvent(ev.id);
    const up = await schedule("event", ev.id, { ...draft, lineup: [...draft.lineup, ...lineup("Nova").map((s) => ({ ...s, startTime: "23:00", endTime: "00:00" }))] }, local(22, "19:00"));
    assert.deepEqual(up.data.change.dependsOn.map((d) => d.id), [pub.data.change.id]);
    // La mise en ligne échoue (soirée archivée en dehors de l'interface) : la suite est bloquée.
    cms.db.run("UPDATE events SET status = 'archived' WHERE id = ?", ev.id);
    run(local(22, "19:30"));
    assert.equal((await change(pub.data.change.id)).status, "conflict");
    const blocked = await change(up.data.change.id);
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.result, /dont elle dépend/);
    assert.equal((await getEvent(ev.id)).lineup.length, 1, "line-up non modifié");
    // Résolution : la mise en ligne est imposée, la suite est débloquée puis exécutée.
    await editor.post(`/api/schedule/${pub.data.change.id}/resolve`, { action: "force" });
    assert.equal((await change(up.data.change.id)).status, "pending");
    run(local(22, "19:30"));
    assert.equal((await change(up.data.change.id)).status, "applied");
    assert.equal((await getEvent(ev.id)).lineup.length, 2);
    // Dépendance annulée : la suite est bloquée (jamais appliquée comme si de rien n'était).
    const ev2 = await createEvent({ title: "Dépendance annulée" });
    const pub2 = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev2.id, action: "publish", runAt: local(23, "18:00") });
    const draft2 = await getEvent(ev2.id);
    const up2 = await schedule("event", ev2.id, { ...draft2, price: "8 €" }, local(23, "19:00"));
    const cancel = await editor.post(`/api/schedule/${pub2.data.change.id}/cancel`, {});
    assert.deepEqual(cancel.data.dependents, [up2.data.change.id]);
    assert.equal((await getEvent(ev2.id)).status, "draft", "plus de mise en ligne prévue : retour en brouillon");
    run(local(23, "20:00"));
    assert.equal((await change(up2.data.change.id)).status, "blocked");
    assert.equal((await getEvent(ev2.id)).price, "");
  });

  test("13 et 15. redémarrage, rattrapage, échéances simultanées et double exécution", async () => {
    const ev = await publishedEvent({ title: "Simultanées", price: "10 €", age: "Dès 18 ans" });
    const m1 = (await editor.post("/api/team", { name: "Alex", role: "Bar", published: false })).data;
    const ids = [];
    for (const r of [
      await schedule("event", ev.id, { ...ev, price: "9 €" }, local(24)),
      await schedule("event", ev.id, { ...ev, age: "Dès 16 ans" }, local(24)),
      await schedule("team", m1.id, { ...m1, published: true }, local(24))
    ]) ids.push(r.data.change.id);
    // Échéance passée pendant un arrêt du serveur : un nouveau processus (nouvelle connexion) rattrape.
    for (const id of ids) cms.db.run("UPDATE scheduled_changes SET run_at = ? WHERE id = ?", new Date(Date.now() - 3600e3).toISOString(), id);
    const db2 = openDatabase(cms.config.dbFile);
    try {
      // Deux processus exécutent la même programmation : une seule application.
      const revisionsBefore = cms.db.get("SELECT COUNT(*) AS n FROM revisions WHERE entity_type = 'event' AND entity_id = ?", ev.id).n;
      assert.equal(executeChange(db2, ids[0]).status, "applied");
      assert.equal(executeChange(cms.db, ids[0]).skipped, true);
      const scheduler = startScheduler({ config: { ...cms.config, autoPublishScheduled: false, backupEveryHours: 0 }, db: db2, publisher: { running: null }, log: { info() {}, warn() {}, error(m, e) { throw e; } } });
      await scheduler.tick();
      scheduler.stop();
      for (const id of ids) assert.equal((await change(id)).status, "applied");
      assert.match((await change(ids[1])).result, /retard/);
      const after = await getEvent(ev.id);
      assert.equal(after.price, "9 €");
      assert.equal(after.age, "Dès 16 ans");
      assert.equal(cms.db.get("SELECT COUNT(*) AS n FROM revisions WHERE entity_type = 'event' AND entity_id = ?", ev.id).n, revisionsBefore + 2, "une version par programmation, aucune en double");
      assert.equal(runDue(db2).length, 0, "relancer ne refait rien");
    } finally {
      db2.close();
    }
  });

  test("17. opérations incompatibles : passage retiré avant d'être modifié, statut impossible", async () => {
    const ev = await publishedEvent({ title: "Incompatibles", lineup: lineup("Valk", "Redfox") });
    const [valk] = ev.lineup;
    const removal = await schedule("event", ev.id, { ...ev, lineup: ev.lineup.filter((s) => s.uid !== valk.uid) }, local(25, "18:00"));
    assert.equal(removal.status, 200);
    const restyle = await schedule("event", ev.id, { ...ev, lineup: ev.lineup.map((s) => (s.uid === valk.uid ? { ...s, style: "Schranz" } : s)) }, local(25, "19:00"));
    assert.equal(restyle.status, 200, JSON.stringify(restyle.data));
    run(local(25, "19:00"));
    const failed = await change(restyle.data.change.id);
    assert.equal(failed.status, "conflict");
    assert.match(failed.result, /n'est plus dans le line-up/);
    assert.equal((await editor.post(`/api/schedule/${failed.id}/resolve`, { action: "force" })).status, 409, "impossible à imposer");
    // Archivage programmé puis mise en ligne programmée : les transitions suivent la chaîne de statut.
    const cancelOp = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "cancel", runAt: local(26, "18:00") });
    assert.equal(cancelOp.status, 200);
    const again = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "cancel", runAt: local(26, "19:00") });
    assert.equal(again.status, 422, "déjà annulée à cette date");
  });

  test("18. heure d'été et d'hiver (Europe/Paris)", async () => {
    assert.throws(() => parseRunAt("2027-03-28T02:30"), (e) => /n'existe pas/.test(e.extra.fields.runAt));
    assert.equal(parseRunAt("2027-03-28T03:00").iso, "2027-03-28T01:00:00.000Z");
    assert.equal(parseRunAt("2027-03-28T01:59").iso, "2027-03-28T00:59:00.000Z");
    const autumn = parseRunAt("2027-10-31T02:30");
    assert.deepEqual(autumn, { iso: "2027-10-31T00:30:00.000Z", ambiguous: true });
    assert.equal(parseRunAt("2027-10-31T03:00").iso, "2027-10-31T02:00:00.000Z");
    const ev = await publishedEvent({ title: "Changement d'heure", price: "10 €" });
    const gap = await schedule("event", ev.id, { ...ev, price: "11 €" }, "2027-03-28T02:15");
    assert.equal(gap.status, 422);
    assert.match(gap.data.fields.runAt, /heure d'été/);
    const overlap = await schedule("event", ev.id, { ...ev, price: "11 €" }, "2027-10-31T02:30");
    assert.equal(overlap.status, 200);
    assert.equal(overlap.data.change.runAt, "2027-10-31T00:30:00.000Z");
    assert.equal(overlap.data.change.runAtLocal, "2027-10-31T02:30");
    assert.match(overlap.data.warnings.join(" "), /heure d'été/);
    assert.equal(runDue(cms.db, { at: "2027-10-31T00:29:00.000Z" }).filter((r) => r.id === overlap.data.change.id).length, 0);
    assert.equal(runDue(cms.db, { at: "2027-10-31T00:30:00.000Z" }).find((r) => r.id === overlap.data.change.id).status, "applied");
  });

  test("19. contenu supprimé ou retiré : la programmation échoue, rien ne réapparaît", async () => {
    const member = (await admin.post("/api/team", { name: "Temporaire", role: "Bénévole", published: true })).data;
    const op = await schedule("team", member.id, { ...member, bio: "Arrivé en 2026." }, local(27));
    assert.equal((await admin.delete(`/api/team/${member.id}`)).status, 200);
    run(local(27));
    const failed = await change(op.data.change.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.result, /supprimé/);
    assert.equal(failed.entityName, "Temporaire", "nom conservé pour l'historique");
    // Soirée programmée puis archivée à la main : la mise en ligne programmée est annulée.
    const ev = await createEvent({ title: "Archivée avant sa mise en ligne" });
    const pub = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(27, "20:00") });
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "archive" })).data.status, "archived");
    assert.equal((await change(pub.data.change.id)).status, "cancelled");
    run(local(27, "21:00"));
    assert.equal((await getEvent(ev.id)).status, "archived", "ne réapparaît pas");
    // Soirée publiée, retrait programmé, puis archivée à la main : conflit, pas de retour en arrière.
    const ev2 = await publishedEvent({ title: "Retrait programmé" });
    const unpub = await editor.post("/api/schedule/status", { entityType: "event", entityId: ev2.id, action: "unpublish", runAt: local(28) });
    await editor.post(`/api/events/${ev2.id}/status`, { action: "archive" });
    run(local(28));
    assert.equal((await change(unpub.data.change.id)).status, "conflict");
    assert.equal((await getEvent(ev2.id)).status, "archived");
  });

  test("19 bis. identifiant réutilisé par SQLite (même id, même date de création) : l'ancienne programmation ne touche pas le nouveau contenu", async () => {
    const old = (await admin.post("/api/team", { name: "Ancien membre", role: "Bar", bio: "", published: true })).data;
    const op = await schedule("team", old.id, { ...old, bio: "Texte de l'ancien membre" }, local(32));
    assert.equal(op.status, 200, JSON.stringify(op.data));
    const oldRow = cms.db.get("SELECT created_at, generation FROM team_members WHERE id = ?", old.id);
    // Suppression hors de l'interface (aucun nettoyage des programmations), puis nouveau membre qui
    // reprend le même identifiant ; même milliseconde de création, pour ne rien laisser au hasard.
    cms.db.run("DELETE FROM team_members WHERE id = ?", old.id);
    const fresh = (await admin.post("/api/team", { name: "Nouveau membre", role: "Son", bio: "", published: true })).data;
    assert.equal(fresh.id, old.id, "SQLite a réutilisé l'identifiant");
    cms.db.run("UPDATE team_members SET created_at = ? WHERE id = ?", oldRow.created_at, fresh.id);
    const freshGeneration = cms.db.get("SELECT generation FROM team_members WHERE id = ?", fresh.id).generation;
    assert.ok(freshGeneration > oldRow.generation, "nouvelle génération, jamais réutilisée");
    assert.throws(() => cms.db.run("UPDATE team_members SET generation = ? WHERE id = ?", oldRow.generation, fresh.id), /immuable/);
    run(local(32));
    const failed = await change(op.data.change.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.entityExists, false);
    assert.equal(failed.entityName, "Ancien membre");
    assert.equal(cms.db.get("SELECT bio FROM team_members WHERE id = ?", fresh.id).bio, "", "le nouveau membre n'est pas modifié");
    // Historique : les versions de l'ancien membre ne sont ni listées ni restaurables sur le nouveau.
    const history = (await editor.get(`/api/history/team/${fresh.id}`)).data;
    assert.equal(history.revisions.length, 1);
    assert.ok(!history.changes.some((c) => c.id === op.data.change.id));
    const oldRevision = cms.db.get("SELECT id FROM revisions WHERE entity_type = 'team' AND generation = ?", oldRow.generation).id;
    assert.equal((await editor.post(`/api/history/team/${fresh.id}/restore/${oldRevision}`)).status, 404);
    assert.equal((await editor.get(`/api/revisions/team/${fresh.id}/${oldRevision}`)).status, 404);
  });

  test("21. historique : origine, champs modifiés, comparaison et restauration", async () => {
    const ev = await publishedEvent({ title: "Historique", price: "10 €" });
    const manual = await editor.put(`/api/events/${ev.id}`, { ...(await getEvent(ev.id)), description: "Texte saisi." });
    assert.equal(manual.status, 200);
    const op = await schedule("event", ev.id, { ...manual.data, price: "12 €" }, local(29));
    run(local(29));
    const history = (await editor.get(`/api/history/event/${ev.id}`)).data;
    const [last, previous] = history.revisions;
    assert.equal(last.origin, "schedule");
    assert.equal(last.change_id, op.data.change.id);
    assert.deepEqual(last.changes, ["price"]);
    assert.deepEqual(previous.changes, ["description"]);
    assert.equal(previous.origin, "manual");
    assert.ok(history.revisions.some((r) => r.origin === "status"), "publication tracée");
    assert.ok(history.changes.some((c) => c.id === op.data.change.id));
    const compare = (await editor.get(`/api/history/event/${ev.id}/compare?a=${previous.id}&b=current`)).data;
    assert.deepEqual(compare.rows.map((r) => [r.key, r.a, r.b]), [["price", "10 €", "12 €"]]);
    const count = history.revisions.length;
    const restored = await editor.post(`/api/history/event/${ev.id}/restore/${previous.id}`);
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal(restored.data.price, "10 €");
    const afterRestore = (await editor.get(`/api/history/event/${ev.id}`)).data.revisions;
    assert.equal(afterRestore.length, count + 1, "les versions intermédiaires sont conservées");
    assert.equal(afterRestore[0].origin, "restore");
    // Restauration générique (membre de l'équipe) : la visibilité actuelle est conservée.
    const member = (await editor.post("/api/team", { name: "Lou", role: "Com", bio: "v1", published: true })).data;
    const v2 = (await editor.put(`/api/team/${member.id}`, { ...member, bio: "v2", published: false })).data;
    const firstRev = (await editor.get(`/api/history/team/${member.id}`)).data.revisions.at(-1);
    const back = (await editor.post(`/api/history/team/${member.id}/restore/${firstRev.id}`)).data;
    assert.equal(back.bio, "v1");
    assert.equal(back.published, v2.published);
  });

  test("24. formulaire enregistré sur une version périmée : fusion champ par champ", async () => {
    const ev = await publishedEvent({ title: "Fusion", price: "10 €", description: "Avant." });
    const op = await schedule("event", ev.id, { ...ev, price: "12 €" }, local(30));
    run(local(30));
    assert.equal((await change(op.data.change.id)).status, "applied");
    // Formulaire ouvert avant l'application de la programmation : autre champ modifié → fusion.
    const merged = await editor.put(`/api/events/${ev.id}`, { ...ev, description: "Après." });
    assert.equal(merged.status, 200, JSON.stringify(merged.data));
    assert.deepEqual(merged.data.mergedFields, ["Résumé du prix"]);
    assert.equal(merged.data.price, "12 €", "la programmation n'est pas annulée par l'ancien formulaire");
    assert.equal(merged.data.description, "Après.");
    // Même champ modifié des deux côtés : refus, avec le champ en conflit.
    const clash = await admin.put(`/api/events/${ev.id}`, { ...ev, price: "11 €" });
    assert.equal(clash.status, 409);
    assert.deepEqual(clash.data.conflicts.map((c) => c.key), ["price"]);
    assert.equal((await getEvent(ev.id)).price, "12 €");
  });

  test("24 bis. droits : lecture seule pour personne ; programmer exige une session et le CSRF", async () => {
    const anonymous = cms.client();
    assert.equal((await anonymous.get("/api/schedule")).status, 401);
    const noCsrf = await cms.login("editor");
    noCsrf.csrf = "";
    assert.equal((await noCsrf.post("/api/schedule", {})).status, 403);
    assert.equal((await editor.post("/api/schedule", { entityType: "users", entityId: 1, input: {}, runAt: local(31) })).status, 404, "type non programmable");
    const ev = await publishedEvent({ title: "Champ interne" });
    const internal = await schedule("event", ev.id, { ...ev, slug: "autre-adresse-2030" }, local(31));
    assert.equal(internal.status, 422, "l'adresse ne se programme pas");
    const list = (await editor.get("/api/schedule?status=attention")).data;
    assert.ok(list.items.every((c) => ["conflict", "blocked", "failed"].includes(c.status)));
  });
});

describe("programmations : lecture puis réenregistrement sans perte (contenus réels importés)", { timeout: 120e3 }, () => {
  test("20 bis. aucune fiche importée ne change quand elle est relue puis réenregistrée", async () => {
    const cms = await startCms({ importContent: true });
    try {
      for (const [type, t] of Object.entries(TARGETS)) {
        for (const { id } of cms.db.all(`SELECT id FROM ${t.table}`)) {
          const before = t.load(cms.db, id);
          const after = cms.db.dryRun(() => {
            t.save(cms.db, id, { ...t.toInput(before), version: before.version }, {});
            return t.load(cms.db, id);
          });
          for (const key of Object.keys(t.fields)) assert.deepEqual(pick(type, after, key), pick(type, before, key), `${type} n° ${id}, ${key}`);
          if (t.lineup) assert.deepEqual(after.lineup.map((s) => [s.uid, s.label, s.startTime]), before.lineup.map((s) => [s.uid, s.label, s.startTime]));
        }
      }
    } finally {
      await cms.close();
    }
  });
});

describe("programmations et mise en ligne (copie du site)", { timeout: 300e3 }, () => {
  test("14, 22 et 23. échec de mise en ligne, nouvelle tentative, pas de doublon ; mises en ligne concurrentes ; fichiers générés", async () => {
    const siteDir = copySite();
    const cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "files" } });
    try {
      const editor = await cms.login("editor");
      const ev = (await editor.post("/api/events", eventInput({ title: "Programmée et publiée", slug: "programmee-et-publiee-2030", ticketUrl: "https://www.helloasso.com/x" }))).data;
      const pub = (await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(5) })).data.change;
      const member = (await editor.post("/api/team", { name: "Programmé·e", role: "Accueil", published: false })).data;
      const show = (await editor.post("/api/schedule", { entityType: "team", entityId: member.id, input: { ...member, published: true }, runAt: local(5, "19:00"), basis: { mode: "current", version: member.version } })).data.change;
      runDue(cms.db, { at: utc(local(5, "18:00")) });
      assert.equal((await editor.get(`/api/schedule/${pub.id}`)).data.status, "applied");

      // 22. Une seule mise en ligne à la fois, même depuis un autre processus (verrou en base).
      const db2 = openDatabase(cms.config.dbFile);
      const other = new Publisher({ config: cms.config, db: db2 });
      const running = cms.publisher.publish({ trigger: "schedule" });
      await assert.rejects(other.publish({ trigger: "cli" }), /déjà en cours/);
      await assert.rejects(cms.publisher.publish({ trigger: "manual" }), /déjà en cours/);
      // Programmation appliquée pendant la mise en ligne : pas dans son export, donc pas « en ligne ».
      while (!/Programmations incluses|ÉCHEC/.test(cms.db.get("SELECT log FROM publications ORDER BY id DESC LIMIT 1").log)) await new Promise((r) => setTimeout(r, 50));
      runDue(cms.db, { at: utc(local(5, "19:00")) });
      const first = await running;
      assert.equal(first.status, "success", first.log);
      assert.equal((await editor.get(`/api/schedule/${pub.id}`)).data.status, "published");
      assert.equal((await editor.get(`/api/schedule/${show.id}`)).data.status, "applied", "appliquée après l'export : reste à mettre en ligne");
      // 23. Contenu réellement généré.
      assert.match(fs.readFileSync(path.join(siteDir, "js/data/events.js"), "utf8"), /programmee-et-publiee-2030/);
      assert.ok(fs.existsSync(path.join(siteDir, "evenement-programmee-et-publiee-2030.html")));
      assert.doesNotMatch(fs.readFileSync(path.join(siteDir, "js/data/equipe.js"), "utf8"), /Programmé·e/);

      // 14. Échec de la mise en ligne suivante (fichier géré modifié hors du CMS) : la programmation reste
      // « appliquée », avec le motif ; nouvel essai après correction : en ligne, sans rien appliquer deux fois.
      const faqFile = path.join(siteDir, "js/data/faq.js");
      const original = fs.readFileSync(faqFile, "utf8");
      fs.appendFileSync(faqFile, "\n// modifié à la main\n");
      const failed = await other.publish({ trigger: "cli" });
      assert.equal(failed.status, "failed");
      const pendingShow = (await editor.get(`/api/schedule/${show.id}`)).data;
      assert.equal(pendingShow.status, "applied");
      assert.match(pendingShow.result, /mise en ligne a échoué/);
      fs.writeFileSync(faqFile, original);
      const revisions = cms.db.get("SELECT COUNT(*) AS n FROM revisions WHERE entity_type = 'team' AND entity_id = ?", member.id).n;
      const retry = await cms.publisher.publish({ trigger: "schedule" });
      assert.equal(retry.status, "success", retry.log);
      assert.equal((await editor.get(`/api/schedule/${show.id}`)).data.status, "published");
      assert.match(fs.readFileSync(path.join(siteDir, "js/data/equipe.js"), "utf8"), /Programmé·e/);
      assert.equal(cms.db.get("SELECT COUNT(*) AS n FROM revisions WHERE entity_type = 'team' AND entity_id = ?", member.id).n, revisions, "aucune nouvelle application");
      assert.equal(runDue(cms.db).length, 0);
      db2.close();
    } finally {
      await cms.close();
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});

describe("migration 005 sur une base existante", () => {
  test("contenus conservés, passages identifiés, soirée « Programmée » reprise à la même heure", async () => {
    const { tempDir } = await import("./helpers.mjs");
    const { listMigrations } = await import("../server/db/migrate.mjs");
    const dir = tempDir();
    const db = openDatabase(path.join(dir, "cms.sqlite"));
    try {
      // Base dans l'état de la production avant cette évolution (migrations 001 à 004).
      db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of listMigrations().filter((n) => n < "005")) {
        db.exec(fs.readFileSync(path.join(import.meta.dirname, "../server/db/migrations", name), "utf8"));
        db.run("INSERT INTO schema_migrations VALUES (?, ?)", name, new Date().toISOString());
      }
      const t = new Date().toISOString();
      const publishAt = new Date(Date.now() + 2 * 86400e3).toISOString();
      db.run("INSERT INTO artists (slug, name, match_key, created_at, updated_at) VALUES ('valk', 'Valk', 'valk', ?, ?)", t, t);
      db.run("INSERT INTO events (slug, title, status, publish_at, date, start_time, created_at, updated_at) VALUES ('legacy-2030', 'Ancienne programmée', 'scheduled', ?, '2030-05-01', '21:00', ?, ?)", publishAt, t, t);
      db.run("INSERT INTO lineup_slots (event_id, position, start_time) VALUES (1, 0, '21:00')");
      db.run("INSERT INTO lineup_slot_artists (slot_id, artist_id, position) VALUES (1, 1, 0)");
      const before = db.get("SELECT * FROM events WHERE id = 1");
      assert.deepEqual(db.migrate(), ["005_programmations.sql"]);
      const { generation, ...after } = db.get("SELECT * FROM events WHERE id = 1");
      assert.deepEqual(after, { ...before }, "la soirée n'est pas modifiée par la migration (seul le numéro de génération est ajouté)");
      assert.ok(generation);
      assert.match(db.get("SELECT uid FROM lineup_slots WHERE id = 1").uid, /^[0-9a-f]{16}$/);
      const op = db.get("SELECT * FROM scheduled_changes");
      assert.equal(op.run_at, publishAt);
      assert.equal(op.status, "pending");
      assert.equal(op.entity_generation, db.get("SELECT generation FROM events WHERE id = 1").generation);
      assert.ok(db.get("SELECT generation FROM artists WHERE id = 1").generation, "contenus existants numérotés");
      // Nouvelle ligne insérée par du SQL brut (comme une migration) : numérotée par le déclencheur.
      db.run("INSERT INTO artists (slug, name, match_key, created_at, updated_at) VALUES ('nova', 'Nova', 'nova', ?, ?)", t, t);
      assert.ok(db.get("SELECT generation FROM artists WHERE slug = 'nova'").generation > db.get("SELECT generation FROM artists WHERE id = 1").generation);
      const [result] = runDue(db, { at: publishAt });
      assert.equal(result.status, "applied", result.message);
      assert.equal(db.get("SELECT status FROM events WHERE id = 1").status, "published");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("statut de mise en ligne réel (mode push, dépôt distant temporaire)", { timeout: 300e3 }, () => {
  test("envoi refusé puis mise en ligne suivante sans nouveau changement : le commit en attente est envoyé ; libellés honnêtes", async () => {
    const { tempDir } = await import("./helpers.mjs");
    const { execFileSync } = await import("node:child_process");
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const remote = tempDir("tnd-remote-");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    const siteDir = copySite({ git: true });
    git(siteDir, "remote", "add", "origin", remote);
    git(siteDir, "push", "-q", "origin", "main");
    const cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "push" } });
    try {
      const editor = await cms.login("editor");
      const ev = (await editor.post("/api/events", eventInput({ title: "Envoi refusé", slug: "envoi-refuse-2030" }))).data;
      const op = (await editor.post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: "publish", runAt: local(3) })).data.change;
      runDue(cms.db, { at: utc(local(3)) });
      // Envoi refusé (dépôt distant injoignable) : commit gardé localement, programmation pas « envoyée ».
      git(siteDir, "remote", "set-url", "--push", "origin", path.join(remote, "introuvable"));
      const refused = await cms.publisher.publish({ trigger: "schedule" });
      assert.equal(refused.status, "failed", refused.log);
      assert.equal((await editor.get(`/api/schedule/${op.id}`)).data.status, "applied");
      // Le dépôt distant revient ; rien de nouveau à exporter : le commit en attente doit quand même partir.
      git(siteDir, "remote", "set-url", "--push", "origin", remote);
      const retry = await cms.publisher.publish({ trigger: "schedule" });
      assert.equal(retry.status, "success", retry.log);
      assert.equal(git(remote, "rev-parse", "main"), git(siteDir, "rev-parse", "HEAD"), "commit envoyé sur le dépôt distant");
      const sent = (await editor.get(`/api/schedule/${op.id}`)).data;
      assert.equal(sent.status, "published");
      assert.equal(sent.statusLabel, "Envoyée sur GitHub");
      assert.match(sent.availability, /non vérifiée/);
      assert.equal(sent.publicationCommit, git(siteDir, "rev-parse", "HEAD"));
    } finally {
      await cms.close();
      for (const d of [remote, siteDir]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("retour arrière de la migration 005", () => {
  test("sauvegarde d'avant la mise à jour restaurée : base 001-004 intacte, migration réapplicable ensuite", async () => {
    const { tempDir } = await import("./helpers.mjs");
    const { loadConfig } = await import("../server/config.mjs");
    const { listMigrations } = await import("../server/db/migrate.mjs");
    const { createBackup, restoreBackup, inspectBackup } = await import("../server/services/backup.mjs");
    const dataDir = tempDir();
    const config = loadConfig({ CMS_SKIP_ENV_FILE: "1", CMS_DATA_DIR: dataDir });
    try {
      // Base de production avant la mise à jour (001 à 004), puis sauvegarde « avant-mise-a-jour ».
      let db = openDatabase(config.dbFile);
      db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of listMigrations().filter((n) => n < "005")) {
        db.exec(fs.readFileSync(path.join(import.meta.dirname, "../server/db/migrations", name), "utf8"));
        db.run("INSERT INTO schema_migrations VALUES (?, ?)", name, new Date().toISOString());
      }
      const t = new Date().toISOString();
      db.run("INSERT INTO team_members (slug, name, role, position, created_at, updated_at) VALUES ('lou', 'Lou', 'Com', 0, ?, ?)", t, t);
      const backup = await createBackup(config, db, "avant-mise-a-jour");
      // Mise à jour (migration 005) et utilisation.
      assert.deepEqual(db.migrate(), ["005_programmations.sql"]);
      db.run("UPDATE team_members SET bio = 'saisi après la mise à jour' WHERE id = 1");
      db.close();
      // Retour arrière : restauration de la sauvegarde (avec l'ancien code, donc sans migrer).
      const { safety } = await restoreBackup(config, path.join(config.backupDir, backup.name));
      assert.ok(safety, "base migrée conservée à part");
      assert.deepEqual(inspectBackup(config.dbFile).migrations, listMigrations().filter((n) => n < "005"));
      db = openDatabase(config.dbFile);
      const columns = db.all("PRAGMA table_info(team_members)").map((c) => c.name);
      assert.ok(!columns.includes("generation"), "schéma d'avant la mise à jour");
      assert.ok(!db.get("SELECT 1 FROM sqlite_master WHERE name = 'scheduled_changes'"));
      assert.equal(db.get("SELECT bio FROM team_members WHERE id = 1").bio, "");
      // Nouvelle mise à jour plus tard : la migration se réapplique proprement.
      assert.deepEqual(db.migrate(), ["005_programmations.sql"]);
      assert.ok(db.get("SELECT generation FROM team_members WHERE id = 1").generation);
      db.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("migration 005 : rattachement de l'historique existant", () => {
  test("une version ambiguë (même identifiant, même milliseconde, horloge incohérente) n'est attribuée à aucun contenu", async () => {
    const { tempDir } = await import("./helpers.mjs");
    const { listMigrations } = await import("../server/db/migrate.mjs");
    const { entityHistory, compareRevisions, restoreVersion } = await import("../server/services/schedule.mjs");
    const { listRevisions } = await import("../server/services/audit.mjs");
    const { generationOf } = await import("../server/services/schedule-targets.mjs");
    const dir = tempDir();
    const db = openDatabase(path.join(dir, "cms.sqlite"));
    try {
      db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of listMigrations().filter((n) => n < "005")) {
        db.exec(fs.readFileSync(path.join(import.meta.dirname, "../server/db/migrations", name), "utf8"));
        db.run("INSERT INTO schema_migrations VALUES (?, ?)", name, new Date().toISOString());
      }
      const T = "2026-05-01T10:00:00.000Z";
      const later = (ms) => new Date(Date.parse(T) + ms).toISOString();
      const rev = (type, id, version, at, data) => db.run("INSERT INTO revisions (entity_type, entity_id, version, data, created_at) VALUES (?, ?, ?, ?, ?)", type, id, version, JSON.stringify(data), at);
      const member = (name, at) => db.run("INSERT INTO team_members (id, slug, name, role, bio, position, created_at, updated_at) VALUES (1, ?, ?, 'Rôle', ?, 0, ?, ?)", name.toLowerCase(), name, `bio de ${name}`, at, at);
      // Membre A (id 1) : créé, modifié, puis supprimé ; B réutilise l'identifiant 1, créé dans la même milliseconde.
      member("Ancien", later(-50));
      rev("team", 1, 1, later(-50), { id: 1, name: "Ancien", bio: "bio de Ancien", version: 1 });
      rev("team", 1, 2, T, { id: 1, name: "Ancien", bio: "dernière bio de Ancien", version: 2 });
      db.run("DELETE FROM team_members WHERE id = 1");
      member("Nouveau", T);
      rev("team", 1, 1, T, { id: 1, name: "Nouveau", bio: "bio de Nouveau", version: 1 });
      rev("team", 1, 2, later(20), { id: 1, name: "Nouveau", bio: "bio 2 de Nouveau", version: 2 });
      // Membre C (id 2), même date de création que B, identifiable sans ambiguïté : historique normal.
      db.run("INSERT INTO team_members (id, slug, name, role, position, created_at, updated_at) VALUES (2, 'c', 'Clara', 'Rôle', 1, ?, ?)", T, T);
      rev("team", 2, 1, T, { id: 2, name: "Clara", version: 1 });
      rev("team", 2, 2, later(30), { id: 2, name: "Clara", bio: "maj", version: 2 });
      // Soirée D (id 1) supprimée ; version datée APRÈS la création de E (horloge du serveur revenue en arrière) ;
      // la copie enregistrée garde la date de création de D, différente de celle de E.
      db.run("INSERT INTO events (id, slug, title, date, created_at, updated_at) VALUES (1, 'e-2030', 'Soirée E', '2030-01-01', ?, ?)", T, T);
      rev("event", 1, 1, T, { id: 1, title: "Soirée E", createdAt: T, version: 1 });
      rev("event", 1, 7, later(40), { id: 1, title: "Soirée D (supprimée)", createdAt: later(-9000), version: 7 });
      db.migrate();

      const ids = (type, id) => listRevisions(db, type, id, { generation: generationOf(db, type, id) }).map((r) => JSON.parse(db.get("SELECT data FROM revisions WHERE id = ?", r.id).data));
      // B : seule sa version datée sans ambiguïté lui est rattachée (deux versions dans la milliseconde de sa création).
      assert.deepEqual(ids("team", 1).map((d) => d.bio), ["bio 2 de Nouveau"]);
      assert.ok(!ids("team", 1).some((d) => d.name === "Ancien"), "aucune version de l'ancien membre");
      // C : historique complet conservé.
      assert.deepEqual(ids("team", 2).map((d) => d.version), [2, 1]);
      // E : la version de D (date de création différente dans la copie) n'est pas rattachée.
      assert.deepEqual(ids("event", 1).map((d) => d.title), ["Soirée E"]);
      // Les versions non rattachées sont conservées dans la base, mais ni listées, ni comparables, ni restaurables.
      const orphans = db.all("SELECT id FROM revisions WHERE generation IS NULL").map((r) => r.id);
      assert.equal(orphans.length, 4);
      assert.equal(db.get("SELECT COUNT(*) AS n FROM revisions").n, 8, "rien n'est supprimé");
      assert.ok(!entityHistory(db, "team", 1).revisions.some((r) => orphans.includes(r.id)));
      const kept = entityHistory(db, "team", 1).revisions[0].id;
      for (const orphan of orphans.filter((o) => db.get("SELECT entity_type FROM revisions WHERE id = ?", o).entity_type === "team" && db.get("SELECT entity_id FROM revisions WHERE id = ?", o).entity_id === 1)) {
        assert.throws(() => compareRevisions(db, "team", 1, orphan, "current"), /introuvable/);
        assert.throws(() => compareRevisions(db, "team", 1, kept, orphan), /introuvable/);
        assert.throws(() => restoreVersion(db, "team", 1, orphan, null), /introuvable/);
      }
      assert.equal(db.get("SELECT bio FROM team_members WHERE id = 1").bio, "bio de Nouveau", "aucune restauration d'une version étrangère");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mode push : seuls les commits du CMS sont envoyés (dépôt distant temporaire)", { timeout: 300e3 }, () => {
  const setup = async () => {
    const { tempDir } = await import("./helpers.mjs");
    const { execFileSync } = await import("node:child_process");
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const remote = tempDir("tnd-remote-");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    const siteDir = copySite({ git: true });
    git(siteDir, "remote", "add", "origin", remote);
    git(siteDir, "push", "-q", "origin", "main");
    const cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "push" } });
    const editor = await cms.login("editor");
    const newEvent = async (title, slug) => {
      const ev = (await editor.post("/api/events", eventInput({ title, slug }))).data;
      await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    };
    const cleanup = async () => {
      await cms.close();
      for (const d of [remote, siteDir]) fs.rmSync(d, { recursive: true, force: true });
    };
    return { git, remote, siteDir, cms, newEvent, cleanup };
  };

  test("commit local étranger au CMS (autre auteur, autre fichier) : rien n'est envoyé, le commit est conservé", async () => {
    const { git, remote, siteDir, cms, newEvent, cleanup } = await setup();
    try {
      const remoteBefore = git(remote, "rev-parse", "main");
      fs.appendFileSync(path.join(siteDir, "README.md"), "\nnote locale\n");
      git(siteDir, "-c", "user.email=dev@example.org", "-c", "user.name=Dev", "commit", "-q", "-am", "travail local du développeur");
      const foreign = git(siteDir, "rev-parse", "HEAD");
      await newEvent("Après commit étranger", "apres-commit-etranger-2030");
      const res = await cms.publisher.publish({ trigger: "manual" });
      assert.equal(res.status, "failed", res.log);
      assert.match(res.log, /pas du CMS/);
      assert.equal(git(remote, "rev-parse", "main"), remoteBefore, "rien n'a été envoyé");
      assert.equal(git(siteDir, "rev-parse", "HEAD"), foreign, "commit étranger conservé, aucun commit du CMS ajouté");
      assert.equal(git(siteDir, "status", "--porcelain", "--", "js/data"), "", "fichiers du site non modifiés");
    } finally {
      await cleanup();
    }
  });

  test("commit sur un fichier géré mais d'un autre auteur, et commit du CMS touchant un autre fichier : refusés", async () => {
    const { git, remote, siteDir, cms, cleanup } = await setup();
    try {
      const remoteBefore = git(remote, "rev-parse", "main");
      fs.appendFileSync(path.join(siteDir, "sitemap.xml"), "\n");
      git(siteDir, "-c", "user.email=dev@example.org", "-c", "user.name=Dev", "commit", "-q", "-am", "retouche à la main");
      let res = await cms.publisher.publish({ trigger: "manual" });
      assert.equal(res.status, "failed", res.log);
      assert.equal(git(remote, "rev-parse", "main"), remoteBefore);
      git(siteDir, "reset", "-q", "--hard", remoteBefore); // préparation du cas suivant (dépôt de test)
      fs.appendFileSync(path.join(siteDir, "README.md"), "\n");
      git(siteDir, "-c", `user.email=${cms.config.gitAuthorEmail}`, "-c", "user.name=CMS", "commit", "-q", "-am", "contenu: mise en ligne depuis le CMS");
      res = await cms.publisher.publish({ trigger: "manual" });
      assert.equal(res.status, "failed", res.log);
      assert.equal(git(remote, "rev-parse", "main"), remoteBefore, "adresse du CMS mais fichier non géré : refusé");
    } finally {
      await cleanup();
    }
  });

  test("plusieurs commits du CMS en attente (deux envois refusés) : tous envoyés à la reprise, et seulement eux", async () => {
    const { git, remote, siteDir, cms, newEvent, cleanup } = await setup();
    try {
      git(siteDir, "remote", "set-url", "--push", "origin", path.join(remote, "introuvable"));
      await newEvent("En attente 1", "en-attente-1-2030");
      assert.equal((await cms.publisher.publish({ trigger: "manual" })).status, "failed");
      await newEvent("En attente 2", "en-attente-2-2030");
      assert.equal((await cms.publisher.publish({ trigger: "manual" })).status, "failed");
      assert.equal(git(siteDir, "rev-list", "--count", "origin/main..HEAD"), "2");
      git(siteDir, "remote", "set-url", "--push", "origin", remote);
      const res = await cms.publisher.publish({ trigger: "manual" });
      assert.equal(res.status, "success", res.log);
      assert.equal(git(remote, "rev-parse", "main"), git(siteDir, "rev-parse", "HEAD"));
      assert.deepEqual(git(remote, "log", "--format=%ae", "-2", "main").split("\n"), [cms.config.gitAuthorEmail, cms.config.gitAuthorEmail]);
    } finally {
      await cleanup();
    }
  });
});
