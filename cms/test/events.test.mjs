import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startCms, eventInput } from "./helpers.mjs";
import { eventChecks } from "../server/services/events.mjs";
import { buildSiteData } from "../server/export/site-data.mjs";
import { frenchRange, parseFrenchRange, nightMinutes } from "../server/services/timeutil.mjs";

describe("horaires de nuit", () => {
  test("écriture du site et lecture", () => {
    assert.equal(frenchRange("21:00", "04:00"), "21h00 – 4h00");
    assert.equal(frenchRange("16:00", "00:00"), "16h00 – 00h00");
    assert.equal(frenchRange("22:30", null), "22h30");
    assert.deepEqual(parseFrenchRange("23h30 – 1h00"), { start: "23:30", end: "01:00" });
    assert.equal(parseFrenchRange("vers minuit"), null);
    assert.equal(nightMinutes("02:30", "21:00"), 26 * 60 + 30);
    assert.equal(nightMinutes("20:30", "21:00"), 20 * 60 + 30, "ouverture des portes avant le début");
  });
});

describe("API des soirées", () => {
  let cms, admin, editor, artists, venue;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
    editor = await cms.login("editor");
    artists = {};
    for (const name of ["Mogli", "Leander", "Sven Gerber", "Dann Octa"]) {
      artists[name] = (await editor.post("/api/artists", { name, styles: "Trance", instagramUrl: `https://www.instagram.com/${name.replace(/\s/g, "").toLowerCase()}/` })).data;
    }
    venue = (await editor.post("/api/venues", { name: "Salle polyvalente", address: "81 rue du Rhin", city: "Munchhausen", postalCode: "67470", lat: 48.919, lon: 8.157 })).data;
  });
  after(() => cms.close());

  test("création : brouillon, slug dérivé du nom et de l'année, validation serveur", async () => {
    const res = await editor.post("/api/events", eventInput({ title: "ICE BOILER v3" }));
    assert.equal(res.status, 201);
    assert.equal(res.data.status, "draft");
    assert.equal(res.data.slug, "ice-boiler-v3-2030");
    const bad = await editor.post("/api/events", { title: "", date: "2030-02-31", startTime: "25:00", ticketUrl: "javascript:alert(1)", genres: "pas une liste" });
    assert.equal(bad.status, 422);
    assert.ok(bad.data.fields.title);
    assert.ok(bad.data.fields.date);
    assert.ok(bad.data.fields.startTime);
    assert.ok(bad.data.fields.ticketUrl);
    const http = await editor.post("/api/events", eventInput({ ticketUrl: "http://billetterie.example/x" }));
    assert.equal(http.status, 422, "billetterie en https uniquement");
  });

  test("line-up : artistes réutilisables, B2B, ordre, horaires et nom spécifique", async () => {
    const lineup = [
      { artistIds: [artists.Mogli.id], startTime: "21:00", endTime: "22:00" },
      { artistIds: [artists.Leander.id, artists["Sven Gerber"].id], startTime: "22:00", endTime: "23:30", style: "Hard Trance" },
      { artistIds: [artists["Dann Octa"].id], label: "DANN OCTA", startTime: "23:30", endTime: "01:00", notes: "Closing" },
      { label: "Invité surprise" }
    ];
    const res = await editor.post("/api/events", eventInput({ title: "Line-up", venueId: venue.id, lineup }));
    assert.equal(res.status, 201);
    const ev = res.data;
    assert.equal(ev.lineup.length, 4);
    assert.deepEqual(ev.lineup[1].artists.map((a) => a.name), ["Leander", "Sven Gerber"]);
    assert.equal(ev.lineup[2].label, "DANN OCTA");
    assert.equal(ev.lineup[3].artists.length, 0);
    // Réordonner : le dernier passe en premier
    const reordered = await editor.put(`/api/events/${ev.id}`, { ...ev, lineup: [ev.lineup[3], ...ev.lineup.slice(0, 3)].map((s) => ({ ...s, artistIds: s.artists.map((a) => a.id) })) });
    assert.equal(reordered.status, 200);
    assert.equal(reordered.data.lineup[0].label, "Invité surprise");
    // L'artiste apparaît dans ses soirées
    const leander = await editor.get(`/api/artists/${artists.Leander.id}`);
    assert.ok(leander.data.events.some((e) => e.id === ev.id));
  });

  test("billets : tarifs validés, caisse du soir rangée en dernier, export au format du site", async () => {
    const tickets = [
      { label: "Caisse du soir", price: "18", door: true },
      { label: "Early", price: "10", status: "soldout", note: "Les 50 premières places" },
      { label: "Regular", price: "12,50", until: "2030-03-01" },
      { label: "", price: "", note: "" }
    ];
    const res = await editor.post("/api/events", eventInput({ title: "Billets", ticketUrl: "https://www.helloasso.com/x", tickets }));
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(res.data.tickets.map((t) => [t.label, t.price, t.status, Boolean(t.door)]), [["Early", 10, "soldout", false], ["Regular", 12.5, "available", false], ["Caisse du soir", 18, "available", true]]);
    await editor.post(`/api/events/${res.data.id}/status`, { action: "publish" });
    const exported = buildSiteData(cms.db).events.find((e) => e.slug === res.data.slug);
    assert.deepEqual(exported.tickets, [
      { label: "Early", price: 10, note: "Les 50 premières places", status: "soldout" },
      { label: "Regular", price: 12.5, until: "2030-03-01" },
      { label: "Caisse du soir", price: 18, door: true }
    ]);
    const coherent = eventChecks(null, { ...res.data, price: "10 à 12,50 € en prévente, 18 € sur place", date: "2999-01-01" });
    assert.ok(!coherent.warnings.some((w) => w.includes("Résumé du prix")), "résumé cohérent : pas d'avertissement");
    const wrong = eventChecks(null, { ...res.data, price: "15 € en prévente", date: "2999-01-01" });
    assert.ok(wrong.warnings.some((w) => w.includes("15 €")), "montant absent des tarifs signalé");
    const bad = await editor.post("/api/events", eventInput({ tickets: [{ label: "Early", price: "dix" }, { label: "", price: "5" }, { label: "A", price: "5", door: true }, { label: "B", price: "6", door: true }] }));
    assert.equal(bad.status, 422);
    assert.ok(bad.data.fields["tickets.0.price"]);
    assert.ok(bad.data.fields["tickets.1.label"]);
    assert.ok(bad.data.fields.tickets, "une seule caisse du soir");
  });

  test("DJ Contest : artiste mystère sans Instagram, place signalée et informations exportées", async () => {
    const mystery = (await editor.post("/api/artists", { name: "DJ Contest", styles: "Artiste mystère", mystery: true, instagramUrl: "https://www.instagram.com/tnd6tem/" })).data;
    assert.equal(mystery.mystery, true);
    const res = await editor.post("/api/events", eventInput({
      title: "Contest", lineup: [{ artistIds: [mystery.id], startTime: "21:00", endTime: "22:00" }, { artistIds: [artists.Mogli.id] }],
      contest: { email: "sets@example.org", deadline: "2030-03-01", text: "" }
    }));
    assert.equal(res.status, 201, JSON.stringify(res.data));
    await editor.post(`/api/events/${res.data.id}/status`, { action: "publish" });
    const data = buildSiteData(cms.db);
    const ev = data.events.find((e) => e.slug === res.data.slug);
    assert.equal(ev.lineup[0].contest, true);
    assert.equal(ev.lineup[1].contest, undefined);
    assert.deepEqual(ev.contest, { email: "sets@example.org", deadline: "2030-03-01" });
    assert.equal(data.ARTISTS["DJ Contest"], undefined, "pas de lien Instagram pour l'artiste mystère");
    const late = await editor.post("/api/events", eventInput({ contest: { email: "pas-une-adresse", deadline: "2030-02-31" } }));
    assert.equal(late.status, 422);
    assert.ok(late.data.fields["contest.email"]);
    assert.ok(late.data.fields["contest.deadline"]);
  });

  test("line-up invalide : artiste inexistant, doublon, passage vide", async () => {
    const res = await editor.post("/api/events", eventInput({ lineup: [{ artistIds: [999999] }, { artistIds: [artists.Mogli.id, artists.Mogli.id] }, {}] }));
    assert.equal(res.status, 422);
    const keys = Object.keys(res.data.fields);
    assert.ok(keys.includes("lineup.0.artistIds"));
    assert.ok(keys.includes("lineup.1.artistIds"));
    assert.ok(keys.includes("lineup.2.artistIds"));
  });

  test("contrôles : chevauchement, horaire hors soirée, ordre, billetterie manquante", () => {
    const slot = (name, startTime, endTime) => ({ label: name, artists: [], startTime, endTime });
    const checks = eventChecks(null, {
      title: "x", date: "2099-01-01", startTime: "21:00", endTime: "04:00", lineup: [slot("A", "22:00", "23:30"), slot("B", "23:00", "00:30"), slot("C", "03:30", "05:00"), slot("D", "21:00", "22:00")],
      photos: [], venue: null, flyer: null, cover: null, ticketUrl: ""
    });
    const text = checks.warnings.join("\n");
    assert.match(text, /se chevauchent/);
    assert.match(text, /en dehors de la soirée/);
    assert.match(text, /ne suit pas les horaires/);
    assert.match(text, /sans lien de billetterie/);
    assert.match(text, /Lieu non renseigné/);
    assert.equal(checks.errors.length, 0);
  });

  test("verrou optimiste : une version périmée est refusée (409)", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "Concurrence" }))).data;
    const first = await editor.put(`/api/events/${ev.id}`, { ...ev, title: "Modifiée par A" });
    assert.equal(first.status, 200);
    const second = await admin.put(`/api/events/${ev.id}`, { ...ev, title: "Modifiée par B" });
    assert.equal(second.status, 409);
    assert.equal(second.data.stale, true);
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.title, "Modifiée par A");
  });

  test("statuts : programmer, publier, annuler, dépublier, archiver, restaurer", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "Statuts" }))).data;
    const past = await editor.post(`/api/events/${ev.id}/status`, { action: "schedule", publishAt: "2001-01-01T10:00:00Z" });
    assert.equal(past.status, 422, "programmation dans le passé refusée");
    const scheduled = await editor.post(`/api/events/${ev.id}/status`, { action: "schedule", publishAt: new Date(Date.now() + 86400e3).toISOString() });
    assert.equal(scheduled.data.status, "scheduled");
    const published = await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    assert.equal(published.data.status, "published");
    assert.ok(published.data.firstPublishedAt);
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "restore" })).status, 409, "transition impossible");
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "cancel" })).data.status, "cancelled");
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "unpublish" })).data.status, "draft");
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "archive" })).data.status, "archived");
    assert.equal((await editor.post(`/api/events/${ev.id}/status`, { action: "restore" })).data.status, "draft");
    const log = cms.db.all("SELECT action FROM audit_log WHERE entity_type = 'event' AND entity_id = ?", ev.id).map((r) => r.action);
    assert.ok(log.includes("event.publish") && log.includes("event.cancel") && log.includes("event.archive"));
  });

  test("publication programmée : publiée par le planificateur à l'échéance", async () => {
    const { publishDue } = await import("../server/services/events.mjs");
    const ev = (await editor.post("/api/events", eventInput({ title: "Programmée" }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "schedule", publishAt: new Date(Date.now() + 3600e3).toISOString() });
    assert.equal(publishDue(cms.db).length, 0);
    cms.db.run("UPDATE events SET publish_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), ev.id);
    const due = publishDue(cms.db);
    assert.deepEqual(due.map((e) => e.id), [ev.id]);
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.status, "published");
  });

  test("renommage d'une soirée déjà publiée : l'ancienne adresse est conservée", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "Ancien nom", slug: "ancien-nom-2030" }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const current = (await editor.get(`/api/events/${ev.id}`)).data;
    const renamed = await editor.put(`/api/events/${ev.id}`, { ...current, title: "Nouveau nom", slug: "nouveau-nom-2030" });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.data.redirects, ["ancien-nom-2030"]);
    // Une autre soirée ne peut pas prendre l'ancienne adresse
    const clash = await editor.post("/api/events", eventInput({ slug: "ancien-nom-2030" }));
    assert.equal(clash.status, 422);
    assert.match(clash.data.fields.slug, /ancienne adresse/);
  });

  test("suppression : réservée aux administrateurs, jamais une soirée en ligne", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "À supprimer" }))).data;
    assert.equal((await editor.delete(`/api/events/${ev.id}`)).status, 403);
    await admin.post(`/api/events/${ev.id}/status`, { action: "publish" });
    assert.equal((await admin.delete(`/api/events/${ev.id}`)).status, 409);
    await admin.post(`/api/events/${ev.id}/status`, { action: "archive" });
    assert.equal((await admin.delete(`/api/events/${ev.id}`)).status, 200);
    assert.equal((await admin.get(`/api/events/${ev.id}`)).status, 404);
  });

  test("duplication : copie en brouillon avec line-up, nouvelle adresse", async () => {
    const src = (await editor.post("/api/events", eventInput({ title: "Édition 1", lineup: [{ artistIds: [artists.Mogli.id], startTime: "21:00", endTime: "22:00" }] }))).data;
    await editor.post(`/api/events/${src.id}/status`, { action: "publish" });
    const copy = await editor.post(`/api/events/${src.id}/duplicate`, {});
    assert.equal(copy.status, 201);
    assert.equal(copy.data.status, "draft");
    assert.notEqual(copy.data.slug, src.slug);
    assert.equal(copy.data.title, "Édition 1 (copie)");
    assert.equal(copy.data.lineup[0].artists[0].name, "Mogli");
  });

  test("historique : chaque enregistrement crée une version restaurable", async () => {
    const ev = (await editor.post("/api/events", eventInput({ title: "Version 1", description: "Texte 1" }))).data;
    const v2 = (await editor.put(`/api/events/${ev.id}`, { ...ev, title: "Version 2", description: "Texte 2" })).data;
    const revisions = (await editor.get(`/api/revisions/event/${ev.id}`)).data;
    assert.equal(revisions.length, 2);
    const first = revisions.at(-1);
    const restored = await editor.post(`/api/events/${ev.id}/revisions/${first.id}/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.data.title, "Version 1");
    assert.equal(restored.data.slug, v2.slug, "l'adresse actuelle est conservée");
  });

  test("liste : recherche (y compris par artiste), filtre de statut, tri, pagination", async () => {
    const byArtist = await editor.get(`/api/events?q=${encodeURIComponent("Sven")}`);
    assert.ok(byArtist.data.items.some((e) => e.title === "Line-up"));
    const drafts = await editor.get("/api/events?status=draft&pageSize=2&page=1&sort=title");
    assert.equal(drafts.data.items.length, 2);
    assert.ok(drafts.data.total >= 3);
    assert.ok(drafts.data.items.every((e) => e.status === "draft"));
    assert.ok(drafts.data.items[0].title.localeCompare(drafts.data.items[1].title, "fr") <= 0);
    const injection = await editor.get(`/api/events?q=${encodeURIComponent("%' OR 1=1 --")}`);
    assert.equal(injection.status, 200);
    assert.equal(injection.data.total, 0);
  });
});

describe("API des artistes et des lieux", () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(() => cms.close());

  test("doublons d'artistes : même nom refusé, noms proches signalés", async () => {
    assert.equal((await editor.post("/api/artists", { name: "Dann Octa" })).status, 201);
    const dup = await editor.post("/api/artists", { name: "DANN-OCTA" });
    assert.equal(dup.status, 409);
    assert.ok(dup.data.duplicateId);
    const similar = await editor.get(`/api/artists/similar?name=${encodeURIComponent("Dan Octa")}`);
    assert.deepEqual(similar.data.map((a) => a.name), ["Dann Octa"]);
    const badLink = await editor.post("/api/artists", { name: "Nouveau", instagramUrl: "https://evil.example/x" });
    assert.equal(badLink.status, 422);
  });

  test("artiste utilisé dans un line-up : suppression refusée, archivage possible, fusion des doublons", async () => {
    const a = (await editor.post("/api/artists", { name: "Valk" })).data;
    const b = (await editor.post("/api/artists", { name: "Valk Officiel", styles: "Bouncy", instagramUrl: "https://www.instagram.com/valk/" })).data;
    const ev = (await editor.post("/api/events", eventInput({ lineup: [{ artistIds: [a.id] }] }))).data;
    const refused = await admin.delete(`/api/artists/${a.id}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.usage.length, 1);
    assert.equal((await editor.post(`/api/artists/${a.id}/merge`, { targetId: b.id })).status, 403, "fusion réservée aux administrateurs");
    const merged = await admin.post(`/api/artists/${a.id}/merge`, { targetId: b.id });
    assert.equal(merged.status, 200);
    const after = (await editor.get(`/api/events/${ev.id}`)).data;
    assert.equal(after.lineup[0].artists[0].id, b.id);
    assert.equal((await editor.get(`/api/artists/${a.id}`)).status, 404);
  });

  test("renommer un artiste met à jour ses soirées", async () => {
    const a = (await editor.post("/api/artists", { name: "Rayy3k" })).data;
    const ev = (await editor.post("/api/events", eventInput({ lineup: [{ artistIds: [a.id] }] }))).data;
    await editor.put(`/api/artists/${a.id}`, { ...a, name: "RAYY 3K" });
    assert.equal((await editor.get(`/api/events/${ev.id}`)).data.lineup[0].artists[0].name, "RAYY 3K");
  });

  test("lieux : validation, doublon signalé, suppression refusée s'il est utilisé", async () => {
    const bad = await editor.post("/api/venues", { name: "Salle", lat: 95, postalCode: "123" });
    assert.equal(bad.status, 422);
    assert.ok(bad.data.fields.lat && bad.data.fields.postalCode);
    const v = (await editor.post("/api/venues", { name: "Salle des fêtes", city: "Munchhausen" })).data;
    assert.equal(v.place, "Salle des fêtes, Munchhausen");
    assert.equal((await editor.post("/api/venues", { name: "salle des fêtes", city: "MUNCHHAUSEN" })).status, 409);
    await editor.post("/api/events", eventInput({ venueId: v.id }));
    const refused = await admin.delete(`/api/venues/${v.id}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.usage.length, 1);
    const archived = await editor.put(`/api/venues/${v.id}`, { ...v, archived: true });
    assert.equal(archived.data.archived, true);
  });
});
