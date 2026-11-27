/**
 * Indicateur « Mise en ligne » de l'interface : GET /api/publications/status (publishStatus,
 * publish/publisher.mjs) et contenus concernés en mots (publisher.pending().sections).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startCms } from "./helpers.mjs";

describe("état de la mise en ligne (indicateur du menu)", { timeout: 120e3 }, () => {
  let cms, editor;
  const status = async () => (await editor.get("/api/publications/status")).data;
  const publication = (status, extra = {}) => {
    const t = new Date().toISOString();
    const cols = { status, trigger: "manual", mode: "push", started_at: t, finished_at: t, summary: "essai", ...extra };
    cms.db.run(`INSERT INTO publications (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`, ...Object.values(cols));
  };

  before(async () => {
    cms = await startCms({ importContent: true });
    editor = await cms.login("editor");
  });
  after(async () => { await cms.close(); });

  test("réservé aux personnes connectées", async () => {
    assert.equal((await cms.client().get("/api/publications/status")).status, 401);
  });

  test("site à jour juste après l'import : aucune pastille", async () => {
    const s = await status();
    assert.equal(s.state, "ok", JSON.stringify(s));
    assert.equal(s.label, "");
    assert.deepEqual(s.sections, []);
  });

  test("modification enregistrée : « À publier », avec le contenu concerné en mots", async () => {
    const member = (await editor.get("/api/team")).data[0];
    assert.equal((await editor.put(`/api/team/${member.id}`, { ...member, bio: `${member.bio} (modifiée)` })).status, 200);
    const s = await status();
    assert.equal(s.state, "pending");
    assert.equal(s.label, "À publier");
    assert.ok(s.sections.includes("Équipe"), JSON.stringify(s.sections));
    assert.match(s.detail, /Équipe/);
    // Même liste sur la page Mise en ligne
    assert.deepEqual((await editor.get("/api/publications/pending")).data.sections, s.sections);
  });

  test("priorités : mise en ligne échouée, déploiement échoué, en cours, bloquée", async () => {
    publication("failed");
    assert.equal((await status()).state, "failed");

    publication("success", { deploy_status: "failure", commit_sha: "abc" });
    const failed = await status();
    assert.equal(failed.state, "deploy-failed");
    assert.match(failed.detail, /déploiement échoué/);

    // Envoi réussi en cours de déploiement : moins important que des modifications en attente
    publication("success", { deploy_status: "in_progress", commit_sha: "def" });
    assert.equal((await status()).state, "pending");

    cms.publisher.running = true;
    try {
      assert.equal((await status()).state, "running");
    } finally {
      cms.publisher.running = false;
    }

    const hashes = cms.publisher.getSetting("export.hashes", null);
    cms.publisher.setSetting("export.hashes", { "js/data/faq.js": "empreinte-differente" });
    try {
      const blocked = await status();
      assert.equal(blocked.state, "blocked");
      assert.deepEqual(blocked.drift, ["js/data/faq.js"]);
    } finally {
      if (hashes) cms.publisher.setSetting("export.hashes", hashes);
      else cms.db.run("DELETE FROM settings WHERE key = 'export.hashes'");
    }
  });

  test("plus rien en attente, envoi pas encore confirmé par GitHub : « Envoi… »", async () => {
    const member = (await editor.get("/api/team")).data[0];
    await editor.put(`/api/team/${member.id}`, { ...member, bio: member.bio.replace(" (modifiée)", "") });
    const s = await status();
    assert.equal(s.state, "deploying", JSON.stringify(s));
    assert.equal(s.label, "Envoi…");
  });

  test("« à jour » seulement si GitHub a confirmé le déploiement, jamais pour un état inconnu", async () => {
    publication("success", { deploy_status: "unknown", commit_sha: "ghi" });
    const unknown = await status();
    assert.equal(unknown.state, "ok");
    assert.doesNotMatch(unknown.detail, /à jour/, unknown.detail);
    assert.match(unknown.detail, /inconnu/);
    publication("success", { mode: "files", deploy_status: "not_sent" });
    assert.doesNotMatch((await status()).detail, /à jour/);
    publication("success", { deploy_status: "success", commit_sha: "jkl" });
    const confirmed = await status();
    assert.equal(confirmed.state, "ok");
    assert.match(confirmed.detail, /le site public est à jour/);
  });
});
