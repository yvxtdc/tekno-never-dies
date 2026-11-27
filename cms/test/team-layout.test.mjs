/**
 * Mise en page des cartes de l'équipe (team_members.layout, migration 007) : format partagé
 * (js/components/team-layout.js), reprise des anciens réglages, saisie, export / import et historique.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, copySite, tempDir } from "./helpers.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { listMigrations } from "../server/db/migrate.mjs";
import { buildSiteData } from "../server/export/site-data.mjs";
import { verifyRoundtrip } from "../server/export/import-repo.mjs";
import { showValue } from "../server/services/schedule-targets.mjs";
import { parseLayout, normalizeLayout, defaultLayout, groupWidth, layoutSummary, addObject, removeObject, moveItem, MAX_OBJECTS } from "../../js/components/team-layout.js";
import { cardComposition, compositionIssues } from "../../js/components/team-composition.js";

const MIGRATION = path.join(import.meta.dirname, "../server/db/migrations/007_equipe_mise_en_page.sql");

/** Mises en page reprises par la migration 007 : slug -> { layout, src } (photo pour laquelle elles valent). */
function migrationLayouts() {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const updates = [...sql.matchAll(/UPDATE team_members SET layout = '([^']+)'\s+WHERE slug = '([^']+)' AND layout IS NULL AND photo_media_id IN \(SELECT id FROM media WHERE storage = 'repo' AND repo_path = '([^']+)'\);/g)];
  return Object.fromEntries(updates.map(([, json, slug, src]) => [slug, { layout: JSON.parse(json), src }]));
}

/** Mise en page valide, avec un objet, pour les essais. */
const sample = () => ({
  photo: { position: "50% 35%" },
  groups: [
    { items: ["name"], x: 7, y: 7.6, align: "start", valign: "top" },
    { items: ["role", "missions"], x: 50, y: 93.6, align: "center", valign: "bottom" }
  ],
  colors: { name: "cyan", role: "violet", missions: "violet" },
  objects: [{ id: "planete", type: "planet", options: { tint: "violet" }, x: 85.123, y: 15, size: 26 }]
});

describe("format de la mise en page (team-layout.js)", () => {
  test("mise en page par défaut valide ; normalisation complète et arrondie", () => {
    assert.deepEqual(parseLayout(defaultLayout()), { layout: defaultLayout(), errors: [] });
    const { layout, errors } = parseLayout(sample());
    assert.deepEqual(errors, []);
    assert.deepEqual(layout.objects[0], {
      id: "planete", type: "planet", options: { tint: "violet" }, anchor: "card", x: 85.12, y: 15, size: 26,
      rotate: 0, flip: false, layer: "front", hideMobile: false
    });
    assert.deepEqual(parseLayout(layout).layout, layout, "une valeur normalisée ne change plus");
  });

  test("refus : éléments manquants ou répétés, réglages inconnus, valeurs hors limites", () => {
    const bad = (mutate, pattern) => {
      const raw = sample();
      mutate(raw);
      const { layout, errors } = parseLayout(raw);
      assert.equal(layout, null);
      assert.ok(errors.some((e) => pattern.test(e)), `${pattern} dans ${errors.join(" | ")}`);
    };
    bad((l) => { l.groups[1].items = ["missions"]; }, /« role » n'est placé dans aucun groupe/);
    bad((l) => { l.groups[0].items.push("role"); }, /déjà dans un autre groupe/);
    bad((l) => { l.groups[0].items = ["photo"]; }, /élément inconnu/);
    bad((l) => { l.groups = []; }, /de 1 à 3 groupes/);
    bad((l) => { l.groups[0].x = 120; }, /groupe 1, x/);
    bad((l) => { l.groups[0].align = "left"; }, /alignement/);
    bad((l) => { l.colors.name = "red"; }, /couleur \(name\)/);
    bad((l) => { l.photo.position = "center"; }, /cadrage/);
    bad((l) => { l.protect = [[0, 0, 10, 10]]; }, /réglage inconnu « protect »/);
    bad((l) => { l.objects[0].type = "licorne"; }, /type inconnu/);
    bad((l) => { l.objects[0].id = "Planète !"; }, /identifiant attendu/);
    bad((l) => { l.objects.push({ ...l.objects[0] }); }, /déjà utilisé/);
    bad((l) => { l.objects[0].options.tint = "gold"; }, /teinte/);
    bad((l) => { l.objects[0].options.couleur = "#fff"; }, /réglage inconnu « couleur »/);
    bad((l) => { l.objects[0].size = "26"; }, /taille/);
    bad((l) => { l.objects[0].mobile = { size: 20 }; }, /réglage inconnu « mobile »/);
    bad((l) => { l.objects = Array.from({ length: MAX_OBJECTS + 1 }, (_, i) => ({ id: `o${i}`, type: "bolt", x: 1, y: 1, size: 10 })); }, /au plus/);
    assert.deepEqual(parseLayout("{}").errors, ["la mise en page doit être un objet"]);
  });

  test("valeur invalide : rendu par défaut plutôt qu'une carte cassée", () => {
    assert.deepEqual(normalizeLayout({ groups: "n'importe quoi" }), defaultLayout());
    assert.deepEqual(normalizeLayout(null), defaultLayout());
  });

  test("largeur d'un groupe : jusqu'à la marge, comme l'ancien bandeau (86 % contre les marges)", () => {
    assert.equal(groupWidth({ x: 7, align: "start" }), 86);
    assert.equal(groupWidth({ x: 93, align: "end" }), 86);
    assert.equal(groupWidth({ x: 50, align: "center" }), 86);
    assert.equal(groupWidth({ x: 80, align: "center" }), 30, "largeur minimale près du bord");
  });
});

describe("reprise des anciens réglages (migration 007)", () => {
  test("la migration reprend les 9 cartes, en mises en page valides et complètes, chacune liée à sa photo", () => {
    const layouts = migrationLayouts();
    assert.deepEqual(Object.keys(layouts).sort(), ["celeste-yelena", "elena-yanniv", "estebane", "jonathan-axel", "josephine", "noah", "remi", "ricky", "yannis"]);
    for (const [slug, { layout, src }] of Object.entries(layouts)) {
      assert.deepEqual(parseLayout(layout), { layout, errors: [] }, `${slug} : valide et déjà normalisée`);
      assert.equal(src, `assets/img/equipe/${slug}.webp`, slug);
    }
    // Repère de la conversion (rendu identique à l'ancien bandeau, vérifié au navigateur lors de la reprise) :
    // nom en haut à droite, rôle et missions en bas à gauche (Noah) ; tout en bas (Yannis)
    assert.deepEqual(layouts.noah.layout.groups, [
      { items: ["name"], x: 93, y: 7.6, align: "end", valign: "top" },
      { items: ["role", "missions"], x: 7, y: 93.6, align: "start", valign: "bottom" }
    ]);
    assert.deepEqual(layouts.yannis.layout.groups.map((g) => g.items), [["name", "role", "missions"]]);
  });

  test("base de production existante : réglages repris pour la même photo seulement, versions inchangées", () => {
    const dir = tempDir();
    try {
      const db = openDatabase(path.join(dir, "cms.sqlite"));
      db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of listMigrations().filter((n) => n < "007")) {
        db.exec(fs.readFileSync(path.join(import.meta.dirname, "../server/db/migrations", name), "utf8"));
        db.run("INSERT INTO schema_migrations VALUES (?, ?)", name, new Date().toISOString());
      }
      const t = new Date().toISOString();
      const media = (uid, repoPath) => Number(db.run(
        "INSERT INTO media (uid, storage, repo_path, original_name, mime, created_at, updated_at) VALUES (?, 'repo', ?, ?, 'image/webp', ?, ?)",
        uid, repoPath, path.basename(repoPath), t, t
      ).lastInsertRowid);
      const member = (slug, mediaId, position) => db.run(
        "INSERT INTO team_members (slug, name, role, photo_media_id, position, created_at, updated_at) VALUES (?, ?, 'Rôle', ?, ?, ?, ?)",
        slug, slug, mediaId, position, t, t
      );
      member("yannis", media("a", "assets/img/equipe/yannis.webp"), 0);
      member("noah", media("b", "assets/img/equipe/noah-2027.webp"), 1); // photo changée depuis le réglage
      member("camille", media("c", "assets/img/equipe/camille.webp"), 2); // nouveau membre
      assert.deepEqual(db.migrate(), ["007_equipe_mise_en_page.sql"]);
      const row = (slug) => db.get("SELECT layout, version FROM team_members WHERE slug = ?", slug);
      assert.deepEqual(JSON.parse(row("yannis").layout), migrationLayouts().yannis.layout);
      assert.equal(row("yannis").version, 1);
      assert.equal(row("noah").layout, null);
      assert.equal(row("camille").layout, null);
      assert.throws(() => db.run("UPDATE team_members SET layout = 'pas du JSON' WHERE slug = 'camille'"), /CHECK/);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("saisie, export et historique de la mise en page (CMS)", () => {
  let cms, editor;
  before(async () => {
    cms = await startCms();
    editor = await cms.login("editor");
  });
  after(async () => { await cms.close(); });

  test("création, modification sans la mise en page (conservée), retour au défaut, refus d'une valeur invalide", async () => {
    const created = await editor.post("/api/team", { name: "Lou", role: "Com", layout: sample() });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.deepEqual(created.data.layout, parseLayout(sample()).layout);

    // Ancien formulaire (sans la clé) : mise en page gardée
    const { layout, ...withoutLayout } = created.data;
    const kept = await editor.put(`/api/team/${created.data.id}`, { ...withoutLayout, bio: "Bonjour" });
    assert.equal(kept.status, 200);
    assert.deepEqual(kept.data.layout, layout);

    const invalid = await editor.put(`/api/team/${created.data.id}`, { ...kept.data, layout: { ...layout, groups: [] } });
    assert.equal(invalid.status, 422);
    assert.match(invalid.data.fields.layout, /Mise en page invalide/);

    const reset = await editor.put(`/api/team/${created.data.id}`, { ...kept.data, layout: null });
    assert.equal(reset.status, 200);
    assert.equal(reset.data.layout, null);

    const plain = await editor.post("/api/team", { name: "Sam", role: "Bar" });
    assert.equal(plain.data.layout, null, "nouveau membre : mise en page par défaut");
  });

  test("export : clé « layout » seulement si une mise en page est réglée ; carte par défaut sinon", async () => {
    const member = (await editor.post("/api/team", { name: "Alex", role: "Son", layout: sample() })).data;
    const team = buildSiteData(cms.db).TEAM;
    const alex = team.find((m) => m.slug === member.slug);
    assert.deepEqual(alex.layout, parseLayout(sample()).layout);
    assert.ok(!("layout" in team.find((m) => m.slug === "sam")), "par défaut : clé absente");
    assert.deepEqual(cardComposition(alex), { source: "cms", ...alex.layout });
    assert.equal(cardComposition({ slug: "sam" }).source, "default");
    assert.ok(compositionIssues(team).some((issue) => issue.startsWith("sam : mise en page par défaut")));
  });

  test("historique et programmations : changement résumé lisiblement", async () => {
    const member = (await editor.post("/api/team", { name: "Noé", role: "Accueil" })).data;
    await editor.put(`/api/team/${member.id}`, { ...member, layout: sample() });
    const history = (await editor.get(`/api/history/team/${member.id}`)).data;
    assert.ok(history.revisions[0].changes.includes("layout"), JSON.stringify(history.revisions[0]));
    assert.equal(showValue(cms.db, "team", "layout", null), "par défaut");
    assert.equal(layoutSummary(sample()),
      "Nom en haut à gauche (7 %, 7.6 %) · Rôle, missions en bas au centre (50 %, 93.6 %) · Objets : planète (85.12 %, 15 %, 26 %)");
  });
});

describe("import d'un equipe.js qui contient des mises en page", { timeout: 120e3 }, () => {
  test("import puis export identiques, mise en page reprise telle quelle", async () => {
    const siteDir = copySite();
    const file = path.join(siteDir, "js/data/equipe.js");
    const { TEAM } = await import(`${new URL(`file://${file}`).href}?v=${Date.now()}`);
    TEAM[0].layout = parseLayout(sample()).layout; // mise en page différente de celle publiée
    fs.writeFileSync(file, `export const TEAM = ${JSON.stringify(TEAM, null, 2)};\n`);
    const cms = await startCms({ importContent: true, siteDir });
    try {
      assert.deepEqual(await verifyRoundtrip(cms.db, cms.config), []);
      assert.deepEqual(JSON.parse(cms.db.get("SELECT layout FROM team_members WHERE slug = ?", TEAM[0].slug).layout), TEAM[0].layout);
    } finally {
      await cms.close();
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});

describe("opérations de l'éditeur (team-layout.js)", () => {
  const base = () => parseLayout(sample()).layout;

  test("ajout d'un objet : identifiant libre, réglages par défaut du catalogue, limite respectée", () => {
    const one = addObject(base(), "sparkle");
    const added = one.objects.at(-1);
    assert.equal(added.id, "etincelle");
    assert.deepEqual(added.options, { points: 8, tint: "silver" });
    assert.deepEqual(parseLayout(one).errors, [], "mise en page toujours valide");
    const two = addObject(one, "sparkle");
    assert.equal(two.objects.at(-1).id, "etincelle-2");
    assert.equal(addObject(one, "star-pair").objects.at(-1).id, "paire-d-etoiles");
    assert.throws(() => addObject(two, "bolt"), /3 objets au plus/);
    assert.throws(() => addObject(base(), "licorne"), /inconnu/);
    assert.equal(base().objects.length, 1, "la mise en page d'origine n'est jamais modifiée");
  });

  test("retrait d'un objet", () => {
    assert.deepEqual(removeObject(base(), "planete").objects, []);
  });

  test("déplacement d'un élément : regroupement, séparation, groupes vides retirés, ordre de lecture gardé", () => {
    const joined = moveItem(base(), "name", 1);
    assert.deepEqual(joined.groups.map((g) => g.items), [["name", "role", "missions"]], "nom remis avant le rôle ; groupe vide retiré");
    const split = moveItem(joined, "missions", null, { x: 50, y: 60, align: "center", valign: "top" });
    assert.deepEqual(split.groups.map((g) => g.items), [["name", "role"], ["missions"]]);
    assert.deepEqual(split.groups[1], { items: ["missions"], x: 50, y: 60, align: "center", valign: "top" });
    for (const layout of [joined, split]) assert.deepEqual(parseLayout(layout).errors, []);
    const three = moveItem(split, "role", null);
    assert.equal(three.groups.length, 3);
    // Un élément seul dans son groupe peut repartir dans un nouveau groupe : toujours 3 au plus
    assert.equal(moveItem(three, "role", null).groups.length, 3);
    assert.throws(() => moveItem(three, "role", 7), /Groupe introuvable/);
    assert.throws(() => moveItem(base(), "photo", 0), /inconnu/);
  });
});
