import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startCms } from "./helpers.mjs";
import { MISSION_CATALOG, MISSION_ICONS, MISSION_RULES, DEFAULT_MISSION_ICON, missionIcon } from "../../js/components/mission-icons.js";

describe("catalogue des badges de missions (Équipe)", () => {
  let cms;
  before(async () => { cms = await startCms(); });
  after(async () => { await cms.close(); });

  test("le module du catalogue est servi à l'administration, et lui seul", async () => {
    const client = cms.client();
    const ok = await client.get("/admin/shared/mission-icons.js");
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type"), /javascript/);
    assert.match(String(ok.data), /export const MISSION_CATALOG/);
    // Liste blanche : aucun autre fichier du site par cette route
    for (const path of ["/admin/shared/team.js", "/admin/shared/../js/data/equipe.js", "/admin/shared/%2e%2e/cms/.env", "/admin/shared/style.css", "/admin/shared/helpers.js"]) {
      assert.equal((await client.get(path)).status, 404, path);
    }
  });

  test("éditeur de mise en page de l'équipe : rendu d'une carte du site servi, et lui seul", async () => {
    const client = cms.client();
    // team-card.js et les modules qu'il importe (chemins relatifs résolus sous /admin/shared/), styles du bandeau
    for (const [file, type] of [["team-card.js", /javascript/], ["team-layout.js", /javascript/], ["team-composition.js", /javascript/], ["chrome.js", /javascript/], ["team.css", /text\/css/]]) {
      const res = await client.get(`/admin/shared/${file}`);
      assert.equal(res.status, 200, file);
      assert.match(res.headers.get("content-type"), type, file);
    }
    const imports = String((await client.get("/admin/shared/team-card.js")).data).matchAll(/from '\.\/([\w-]+\.js)'/g);
    for (const [, file] of imports) assert.equal((await client.get(`/admin/shared/${file}`)).status, 200, `import ${file}`);
    // Images des objets détourés : seulement le dossier decor, en webp
    assert.equal((await client.get("/admin/site/img/decor/thorn.webp")).status, 200);
    for (const path of ["/admin/site/img/equipe/yannis.webp", "/admin/site/img/decor/../equipe/yannis.webp", "/admin/site/img/decor/thorn.png"]) {
      assert.equal((await client.get(path)).status, 404, path);
    }
  });

  test("chaque mission du catalogue a un pictogramme existant, un libellé unique et valide", () => {
    const labels = MISSION_CATALOG.flatMap(({ missions }) => missions.map(([label]) => label));
    assert.ok(labels.length >= 100, "catalogue large");
    assert.equal(new Set(labels.map((l) => l.toLowerCase())).size, labels.length, "pas de doublon");
    for (const { missions } of MISSION_CATALOG) {
      for (const [label, icon] of missions) {
        assert.ok(MISSION_ICONS[icon], `pictogramme « ${icon} » de « ${label} »`);
        assert.ok(label.length <= 40, `« ${label} » : 40 caractères maximum (services/team.mjs)`);
        assert.equal(missionIcon(label), icon, `« ${label} » reçoit son pictogramme`);
      }
    }
    for (const [, icon] of MISSION_RULES) assert.ok(MISSION_ICONS[icon], `règle vers « ${icon} »`);
    assert.ok(MISSION_ICONS[DEFAULT_MISSION_ICON]);
  });

  test("les missions déjà en ligne gardent leur pictogramme", () => {
    const expected = {
      "Organisation générale": "clipboard", "Supervision": "eye", "Gestion & coordination": "network",
      "Gestion & installation": "speaker", "Réglages & tests": "sliders", "Entretien du matériel": "wrench",
      "Montage/installation": "hammer", "Polyvalent": "puzzle", "Gestion des stocks": "crate",
      "Organisation du bar": "cocktail", "Réseaux sociaux": "phone", "Création de contenus": "camera",
      "Stratégie & image": "target", "Montage & démontage": "hammer", "Bons commerciaux": "tag",
      "Entrée & billetterie": "ticket", "Graffitis": "spray", "Créations visuelles": "palette", "Événementiel": "calendar"
    };
    for (const [mission, icon] of Object.entries(expected)) assert.equal(missionIcon(mission), icon, mission);
  });

  test("une mission écrite librement reçoit un pictogramme d'après ses mots", () => {
    assert.equal(missionIcon("Gestion des lumières"), "spotlight");
    assert.equal(missionIcon("Livraison des fûts"), "truck");
    assert.equal(missionIcon("Mission inconnue"), DEFAULT_MISSION_ICON);
  });
});
