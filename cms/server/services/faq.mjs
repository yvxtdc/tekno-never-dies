/** Questions fréquentes : ordre manuel, catégories, texte enrichi sûr pour les réponses. */
import { now } from "../db/index.mjs";
import { notFound, conflict, badRequest } from "../http/errors.mjs";
import { Validator } from "./validation.mjs";
import { richTextProblems, richTextToHtml } from "./richtext.mjs";
import { saveRevision } from "./audit.mjs";

export const FAQ_CATEGORIES = ["Association", "Événements", "Sécurité"];

const serialize = (r) => ({
  id: r.id,
  question: r.question,
  answer: r.answer,
  answerHtml: richTextToHtml(r.answer),
  category: r.category,
  position: r.position,
  needsValidation: Boolean(r.needs_validation),
  published: Boolean(r.published),
  version: r.version,
  updatedAt: r.updated_at
});

export const listFaq = (db) => db.all("SELECT * FROM faq_items ORDER BY position, id").map(serialize);

export function getFaq(db, id) {
  const row = db.get("SELECT * FROM faq_items WHERE id = ?", id);
  if (!row) throw notFound("Question introuvable.");
  return serialize(row);
}

function validate(input) {
  const v = new Validator(input);
  const data = {
    question: v.text("question", { required: true, max: 200, label: "La question" }),
    answer: v.text("answer", { required: true, max: 2000, multiline: true, label: "La réponse" }),
    category: v.text("category", { required: true, max: 40, label: "La catégorie" }),
    needs_validation: v.bool("needsValidation") ? 1 : 0,
    published: v.bool("published", true) ? 1 : 0
  };
  const problems = data.answer ? richTextProblems(data.answer) : [];
  if (problems.length) v.error("answer", problems.join(" "));
  v.throwIfErrors();
  return data;
}

export function createFaq(db, input, user) {
  const data = validate(input);
  const position = (db.get("SELECT MAX(position) AS p FROM faq_items").p ?? -1) + 1;
  const t = now();
  const { lastInsertRowid } = db.run(
    "INSERT INTO faq_items (question, answer, category, position, needs_validation, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    data.question, data.answer, data.category, position, data.needs_validation, data.published, t, t
  );
  const item = getFaq(db, Number(lastInsertRowid));
  saveRevision(db, "faq", item.id, 1, item, user?.id);
  return item;
}

export function updateFaq(db, id, input, user, { origin = "manual", changeId = null } = {}) {
  const current = getFaq(db, id);
  if (input.version !== undefined && Number(input.version) !== current.version) throw conflict("Cette question a été modifiée entre-temps. Rechargez la page.", { stale: true });
  const data = validate(input);
  db.run(
    "UPDATE faq_items SET question = ?, answer = ?, category = ?, needs_validation = ?, published = ?, version = version + 1, updated_at = ? WHERE id = ?",
    data.question, data.answer, data.category, data.needs_validation, data.published, now(), id
  );
  const item = getFaq(db, id);
  saveRevision(db, "faq", id, item.version, item, user?.id, { origin, changeId });
  return item;
}

export function deleteFaq(db, id) {
  const item = getFaq(db, id);
  db.run("DELETE FROM faq_items WHERE id = ?", id);
  return item;
}

/** Nouvel ordre : liste complète des identifiants. */
export function reorder(db, table, ids) {
  const existing = db.all(`SELECT id FROM ${table}`).map((r) => r.id).sort((a, b) => a - b);
  const given = [...ids].map(Number).sort((a, b) => a - b);
  if (existing.length !== given.length || existing.some((id, i) => id !== given[i])) throw badRequest("Ordre invalide : rechargez la page.");
  db.tx(() => ids.forEach((id, i) => db.run(`UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ?`, i, now(), Number(id))));
}
