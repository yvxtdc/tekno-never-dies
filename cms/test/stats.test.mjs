/**
 * Statistiques (services/stats.mjs) : API GoatCounter simulée (jamais appelée réellement).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startCms, eventInput } from "./helpers.mjs";
import { runtime } from "../server/runtime.mjs";
import { clearStatsCache, resolvePeriod, attribute } from "../server/services/stats.mjs";
import { parisToday } from "../server/services/timeutil.mjs";

const TOKEN = "gc-jeton-de-test-secret";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = runtime.fetch;

describe("statistiques GoatCounter", { timeout: 60e3 }, () => {
  let cms, editor, plain, calls, api, ev;
  before(async () => {
    cms = await startCms({ env: { CMS_GOATCOUNTER_TOKEN: TOKEN, CMS_GOATCOUNTER_URL: "https://asso.goatcounter.example" } });
    plain = await startCms(); // sans jeton
    editor = await cms.login("editor");
    ev = (await editor.post("/api/events", eventInput({ title: "ICE BOILER v9", slug: "ice-boiler-v9-2030" }))).data;
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    // Deux soirées au même titre : leurs interactions ne peuvent pas être attribuées.
    for (const slug of ["doublon-2029", "doublon-2030"]) {
      const d = (await editor.post("/api/events", eventInput({ title: "Doublon", slug }))).data;
      await editor.post(`/api/events/${d.id}/status`, { action: "publish" });
    }
    runtime.fetch = async (url, init) => {
      const u = new URL(String(url));
      calls.push({ path: u.pathname, params: u.searchParams, auth: init?.headers?.Authorization });
      return api(u);
    };
  });
  after(async () => {
    runtime.fetch = realFetch;
    await cms.close();
    await plain.close();
  });
  beforeEach(() => {
    calls = [];
    clearStatsCache();
  });

  const today = parisToday();
  const day = (offset) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400e3).toISOString().slice(0, 10);
  /** GoatCounter simulé : comptage depuis 200 jours ; pages, interactions et sources. */
  const working = (u, { firstDay = day(-200), more = false } = {}) => {
    const p = u.pathname.replace("/api/v0/", "");
    if (p === "stats/total") {
      const start = u.searchParams.get("start");
      if (start < `${day(-365)}`) return json(200, { total: 5000, total_events: 400, stats: [{ day: firstDay, daily: 3 }, { day: day(-1), daily: 10 }] });
      return json(200, { total: 120, total_events: 20, stats: [] });
    }
    if (p === "stats/hits") {
      const excluded = u.searchParams.getAll("exclude_paths");
      if (excluded.length) return json(200, { hits: [{ path_id: 3, path: "/evenement-ice-boiler-v9-2030.html", event: false, count: 999, stats: [{ day: day(0), daily: 999 }] }], more: false });
      return json(200, {
        more,
        hits: [
          { path_id: 1, path: "/", title: "Accueil", event: false, count: 60, stats: [{ day: day(-1), daily: 40 }, { day: day(0), daily: 20 }] },
          // Soirées créées aujourd'hui dans ce CMS de test : chiffres datés d'aujourd'hui (les jours antérieurs à
          // leur création ne leur seraient pas attribués).
          { path_id: 3, path: "/evenement-ice-boiler-v9-2030.html", title: "ICE BOILER v9", event: false, count: 40, stats: [{ day: day(0), daily: 40 }] },
          { path_id: 7, path: "Billetterie · ICE BOILER v9", event: true, count: 9, stats: [{ day: day(0), daily: 9 }] },
          { path_id: 8, path: "Ajouter à l'agenda · ICE BOILER v9", event: true, count: 4, stats: [{ day: day(0), daily: 4 }] },
          { path_id: 9, path: "Billetterie · Doublon", event: true, count: 5, stats: [] },
          { path_id: 10, path: "Instagram · @tnd6tem", event: true, count: 2, stats: [] }
        ]
      });
    }
    if (p === "stats/toprefs") return json(200, { stats: [{ name: "instagram.com", count: 30 }, { name: "", count: 12 }], more: false });
    return json(404, {});
  };

  test("sans jeton : explication et lien vers GoatCounter, aucun appel, aucun chiffre", async () => {
    const admin = await plain.login("admin");
    const res = (await admin.get("/api/stats")).data;
    assert.equal(res.configured, false);
    assert.match(res.reason, /CMS_GOATCOUNTER_TOKEN/);
    assert.equal(res.dashboardUrl, "https://teknoneverdies.goatcounter.com");
    assert.equal(res.totals, undefined);
    assert.equal(calls.length, 0);
  });

  test("données réelles (simulées) : totaux, série, pages, soirées, interactions, sources, comparaison", async () => {
    api = (u) => working(u);
    const res = (await editor.get("/api/stats?period=7")).data;
    assert.equal(res.configured, true);
    assert.deepEqual(res.totals, { pages: 100, interactions: 20 });
    assert.equal(res.series.length, 7);
    assert.equal(res.series.at(-1).count, 60, "aujourd'hui : 20 (accueil) + 40 (fiche)");
    assert.equal(res.series.find((d) => d.day === day(-3)).count, 0, "jour sans visite : vraiment 0");
    assert.equal(res.pages[0].path, "/");
    const mine = res.events.find((e) => e.id === ev.id);
    assert.equal(mine.views, 40);
    assert.deepEqual(mine.interactions, { "Billetterie": 9, "Ajout à l'agenda": 4, "Itinéraire": 0, "Partage": 0, "DJ Contest": 0 });
    assert.deepEqual(res.unattributed.map((u) => [u.name, u.reason]), [["Billetterie · Doublon", "ancien format par titre, titre porté par 2 soirées"]]);
    assert.equal(mine.legacyClicks, 13, "clics de l'ancien format (titre unique) comptés et signalés");
    assert.deepEqual(res.siteInteractions, [{ name: "Instagram", count: 2 }]);
    assert.equal(res.refs[1].name, "(accès direct ou inconnu)");
    assert.equal(res.comparison.available, true);
    assert.deepEqual(res.comparison.range, { from: day(-13), to: day(-7) });
    assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
    // Jeton jamais renvoyé au navigateur.
    assert.doesNotMatch(JSON.stringify(res), new RegExp(TOKEN));
  });

  test("soirée renommée dans le CMS : les clics enregistrés sous son ancien titre lui restent attribués", async () => {
    const r = (await editor.post("/api/events", eventInput({ title: "Titre d'origine", slug: "titre-origine-2030" }))).data;
    await editor.post(`/api/events/${r.id}/status`, { action: "publish" });
    const cur = (await editor.get(`/api/events/${r.id}`)).data;
    await editor.put(`/api/events/${r.id}`, { ...cur, title: "Titre définitif", slug: "titre-definitif-2030" });
    api = (u) => (u.pathname.endsWith("stats/hits") ? json(200, { more: false, hits: [
      { path_id: 51, path: "Billetterie · Titre d'origine", event: true, count: 6, stats: [{ day: day(0), daily: 6 }] },
      { path_id: 52, path: "Billetterie · titre-origine-2030", event: true, count: 2, stats: [{ day: day(0), daily: 2 }] },
      { path_id: 53, path: "Billetterie · titre-definitif-2030", event: true, count: 1, stats: [{ day: day(0), daily: 1 }] }
    ] }) : working(u));
    const res = (await editor.get("/api/stats?period=7")).data;
    const renamed = res.events.find((e) => e.id === r.id);
    assert.equal(renamed.title, "Titre définitif");
    assert.equal(renamed.interactions.Billetterie, 9, "ancien titre, ancienne adresse et nouvelle adresse");
    assert.equal(renamed.legacyClicks, 6);
    assert.equal(res.unattributed.length, 0);
  });

  test("adresse et titre d'une soirée supprimée, repris ensuite : rien d'avant la reprise n'est attribué", async () => {
    const admin = await cms.login("admin");
    // Soirée supprimée (brouillon) ; ses clics et visites restent dans GoatCounter.
    const old = (await admin.post("/api/events", eventInput({ title: "Soirée effacée", slug: "soiree-effacee-2030" }))).data;
    assert.equal((await admin.delete(`/api/events/${old.id}`)).status, 200);
    // Une soirée existante reprend l'adresse libérée ; une nouvelle soirée reprend le titre.
    const taker = (await editor.post("/api/events", eventInput({ title: "Preneuse", slug: "preneuse-2030" }))).data;
    cms.db.run("UPDATE event_names SET since = ? WHERE event_id = ?", new Date(Date.now() - 30 * 86400e3).toISOString(), taker.id); // existante depuis 30 jours
    const cur = (await editor.get(`/api/events/${taker.id}`)).data;
    assert.equal((await editor.put(`/api/events/${taker.id}`, { ...cur, slug: "soiree-effacee-2030" })).status, 200);
    const sameTitle = (await editor.post("/api/events", eventInput({ title: "Soirée effacée", slug: "autre-soiree-2031" }))).data;
    api = (u) => (u.pathname.endsWith("stats/hits") ? json(200, { more: false, hits: [
      { path_id: 61, path: "/evenement-soiree-effacee-2030.html", event: false, count: 25, stats: [{ day: day(-5), daily: 20 }, { day: day(0), daily: 5 }] },
      { path_id: 62, path: "Billetterie · Soirée effacée", event: true, count: 7, stats: [{ day: day(-5), daily: 7 }] }
    ] }) : working(u));
    const res = (await editor.get("/api/stats?period=7")).data;
    assert.equal(res.events.find((e) => e.id === taker.id)?.views, 5, "seulement depuis la reprise de l'adresse");
    assert.ok(!res.events.some((e) => e.id === sameTitle.id), "aucun clic antérieur à la nouvelle soirée de même titre");
    assert.deepEqual(res.unattributed.map((u) => u.count).sort((a, b) => a - b), [7, 20]);
  });

  test("périodes : 7, 30, 90 jours, personnalisée, invalide", async () => {
    assert.equal(resolvePeriod({ period: "90" }, "2026-10-26").from, "2026-07-29");
    assert.deepEqual(resolvePeriod({ period: "custom", start: "2026-01-01", end: "2026-01-31" }, "2026-10-26").previous, { from: "2025-12-01", to: "2025-12-31" });
    assert.equal((await editor.get("/api/stats?period=custom&start=2026-02-01&end=2026-01-01")).status, 400);
    assert.equal((await editor.get("/api/stats?period=custom&start=2020-01-01&end=2026-01-01")).status, 400);
  });

  test("pas d'historique : comparaison refusée si le comptage n'existait pas au début de la période précédente", async () => {
    api = (u) => working(u, { firstDay: day(-10) });
    const res = (await editor.get("/api/stats?period=30")).data;
    assert.equal(res.comparison.available, false);
    assert.match(res.comparison.reason, /ne comptait pas encore/);
    assert.ok(res.totals, "les chiffres de la période restent affichés");
  });

  test("métrique indisponible ≠ métrique nulle : une section en échec vaut null avec son motif", async () => {
    api = (u) => (u.pathname.endsWith("stats/hits") ? json(500, {}) : working(u));
    const res = (await editor.get("/api/stats?period=7")).data;
    assert.equal(res.pages, null);
    assert.equal(res.events, null);
    assert.equal(res.series, null);
    assert.match(res.errors.hits, /réponse 500/);
    assert.deepEqual(res.totals, { pages: 100, interactions: 20 }, "les totaux restent disponibles");
    // Métrique réellement nulle : 0, pas null.
    api = (u) => (u.pathname.endsWith("stats/total") && u.searchParams.get("start") >= day(-30) ? json(200, { total: 7, total_events: 0, stats: [] }) : working(u));
    clearStatsCache();
    assert.deepEqual((await editor.get("/api/stats?period=7")).data.totals, { pages: 7, interactions: 0 });
  });

  test("panne de GoatCounter : rien d'inventé ; dernière réponse complète signalée comme ancienne", async () => {
    api = () => { throw new Error("ECONNREFUSED"); };
    let res = (await editor.get("/api/stats?period=7")).data;
    assert.equal(res.totals, null);
    assert.match(res.errors.totals, /injoignable/);
    assert.equal(res.comparison.available, false);
    // Une réponse complète, puis (cache expiré) une panne : l'ancienne réponse, signalée, plutôt que des zéros.
    api = (u) => working(u);
    await editor.get("/api/stats?period=30");
    api = () => json(429, {});
    const count = calls.length;
    res = (await editor.get("/api/stats?period=30")).data;
    assert.equal(calls.length, count, "cache de 10 minutes : pas de nouvel appel");
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60e3;
    try {
      res = (await editor.get("/api/stats?period=30")).data;
    } finally {
      Date.now = realNow;
    }
    assert.ok(calls.length > count, "cache expiré : GoatCounter interrogé");
    assert.equal(res.stale, true);
    assert.match(res.staleReason, /Limite d'appels/);
    assert.deepEqual(res.totals, { pages: 100, interactions: 20 });
  });

  test("jeton refusé : message explicite", async () => {
    api = () => json(401, {});
    const res = (await editor.get("/api/stats?period=7")).data;
    assert.match(res.errors.totals, /Jeton GoatCounter refusé/);
  });

  test("interactions comptées une seule fois, même renvoyées deux fois par la pagination", () => {
    const hits = [
      { path_id: 3, path: "/evenement-x-2030.html", event: false, count: 10 },
      { path_id: 4, path: "/evenement-ancien-nom.html", event: false, count: 5 },
      { path_id: 7, path: "Billetterie · X", event: true, count: 2 }
    ];
    const { events } = attribute(hits, [{ id: 1, title: "X", slug: "x-2030", redirects: ["ancien-nom"] }]);
    assert.equal(events[0].views, 15, "ancienne adresse rattachée à la soirée");
    assert.equal(events[0].interactions.Billetterie, 2);
  });

  test("pagination de /stats/hits : une même page n'est jamais additionnée deux fois", async () => {
    api = (u) => working(u, { more: true });
    const res = (await editor.get("/api/stats?period=7")).data;
    assert.equal(res.events.find((e) => e.id === ev.id).views, 40, "la ligne renvoyée en double (path_id 3) est ignorée");
    assert.ok(calls.some((c) => c.params.getAll("exclude_paths").length === 6), "les pages déjà reçues sont exclues de la page suivante");
  });
});

describe("statistiques : rattachement des clics et des pages à la bonne soirée", () => {
  const ev = (id, slug, title, extra = {}) => ({ id, slug, title, redirects: [], pastTitles: [], notBefore: null, ...extra });
  const hit = (path_id, path, count, extra = {}) => ({ path_id, path, count, event: !path.startsWith("/"), stats: [], ...extra });
  const of = (res, id) => res.events.find((e) => e.id === id);

  test("format actuel : par l'adresse, quel que soit le titre ; titres identiques bien séparés", () => {
    const res = attribute([
      hit(1, "Billetterie · doublon-2029", 4), hit(2, "Billetterie · doublon-2030", 9), hit(3, "/evenement-doublon-2030.html", 50),
      hit(4, "Billetterie · Doublon", 7) // ancien format : titre porté par deux soirées
    ], [ev(1, "doublon-2029", "Doublon"), ev(2, "doublon-2030", "Doublon")]);
    assert.equal(of(res, 1).interactions.Billetterie, 4);
    assert.equal(of(res, 2).interactions.Billetterie, 9);
    assert.equal(of(res, 2).views, 50);
    assert.deepEqual(res.unattributed, [{ name: "Billetterie · Doublon", count: 7, reason: "ancien format par titre, titre porté par 2 soirées" }]);
  });

  test("soirée renommée : ancienne adresse et ancien titre (historique) restent rattachés, sans doublon", () => {
    const renamed = ev(5, "nouveau-nom-2030", "Nouveau nom", { redirects: ["ancien-nom-2030"], pastTitles: ["Ancien nom", "Nouveau nom"] });
    const res = attribute([
      hit(1, "Billetterie · Ancien nom", 3), // ancien format, ancien titre
      hit(2, "Billetterie · ancien-nom-2030", 5), // format actuel, ancienne adresse
      hit(3, "Billetterie · nouveau-nom-2030", 2),
      hit(4, "/evenement-ancien-nom-2030.html", 30), hit(5, "/evenement-nouveau-nom-2030.html", 12)
    ], [renamed, ev(6, "autre-2030", "Autre")]);
    assert.equal(of(res, 5).interactions.Billetterie, 10, "3 + 5 + 2, chaque ligne comptée une fois");
    assert.equal(of(res, 5).legacyClicks, 3);
    assert.equal(of(res, 5).views, 42);
    assert.equal(res.unattributed.length, 0);
  });

  test("adresse d'une soirée supprimée réutilisée : les jours antérieurs à la nouvelle soirée ne lui sont pas attribués", () => {
    const fresh = ev(7, "fete-2030", "Fête", { notBefore: "2030-03-10" });
    const res = attribute([
      hit(1, "Billetterie · fete-2030", 11, { stats: [{ day: "2030-03-01", daily: 8 }, { day: "2030-03-12", daily: 3 }] }),
      hit(2, "/evenement-fete-2030.html", 6, { stats: [] }) // pas de détail par jour : rien n'est attribué
    ], [fresh]);
    assert.equal(of(res, 7).interactions.Billetterie, 3);
    assert.equal(of(res, 7).views, 0);
    assert.deepEqual(res.unattributed.map((u) => [u.name, u.count]), [["Billetterie · fete-2030", 8], ["/evenement-fete-2030.html", 6]]);
  });

  test("ambiguïtés : adresse d'une soirée égale au titre d'une autre, soirée non identifiée, inconnue", () => {
    const res = attribute([hit(1, "Partager · tekno", 2), hit(2, "Itinéraire · ?", 4), hit(3, "Partager · Soirée disparue", 1)],
      [ev(1, "tekno", "Tekno Night"), ev(2, "tekno-2031", "tekno")]);
    assert.equal(of(res, 1).interactions.Partage, 0);
    assert.equal(of(res, 2).interactions.Partage, 0);
    assert.deepEqual(res.unattributed.map((u) => u.reason), ["nom ambigu : adresse d'une soirée et titre d'une autre", "soirée non identifiée au moment du clic", "aucune soirée connue sous ce nom ou cette adresse"]);
  });
});

describe("site public : nom des clics de soirée", () => {
  test("format « Catégorie · <adresse> », plus aucun clic de soirée nommé d'après le titre", async () => {
    const fs = await import("node:fs");
    const { eventTrackName } = await import("../../js/pages/helpers.js");
    assert.equal(eventTrackName("Billetterie", { slug: "ice-boiler-v2-2026", title: "ICE BOILER v2" }), "Billetterie · ice-boiler-v2-2026");
    for (const file of ["js/partials.js", "js/pages/evenement.js"]) {
      const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /track\(`(Billetterie|Itinéraire|Ajouter à l'agenda|Partager|DJ Contest) · \$\{/, file);
    }
  });
});
