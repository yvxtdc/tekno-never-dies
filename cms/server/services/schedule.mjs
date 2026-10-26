/**
 * Programmations ciblées : une modification précise d'un contenu (champs d'une fiche, passages du
 * line-up, statut d'une soirée, affichage d'un membre…) appliquée automatiquement à une date donnée.
 *
 * Principes (détails et exemples : docs/cms/programmations.md) :
 *  - une programmation enregistre des modifications par clé ({ key, base, from, to }), jamais une copie
 *    de la fiche : à l'échéance, seules ces clés sont écrites, sur l'état le plus récent de la base ;
 *  - « from » est la valeur attendue juste avant l'exécution : la valeur vue à la préparation, ou le
 *    résultat de la programmation précédente sur la même clé (chaîne ordonnée par date puis numéro).
 *    Deux programmations successives du même champ s'enchaînent donc sans faux conflit ;
 *  - à l'exécution, pour chaque clé : valeur actuelle = from → appliquée ; = to → déjà faite (rien) ;
 *    autre valeur → conflit (modification faite entre-temps) : rien n'est écrit, une personne choisit ;
 *  - dépendances : la programmation précédente sur une même clé, la mise en ligne programmée d'un
 *    contenu encore invisible, l'ajout programmé d'un passage. Une dépendance en échec, en conflit ou
 *    annulée bloque la programmation (jamais exécutée comme si de rien n'était) ;
 *  - exécution dans une transaction unique (BEGIN IMMEDIATE) qui vérifie d'abord le statut « pending » :
 *    relancée ou lancée deux fois (deux processus), une programmation ne s'applique qu'une fois ;
 *  - la mise en ligne (publish/publisher.mjs) exporte toujours l'état complet et à jour de la base ;
 *    une programmation n'est « envoyée » qu'après une mise en ligne réussie qui l'inclut. Le CMS ne suit
 *    pas le déploiement GitHub Pages : la disponibilité sur le site public n'est jamais affirmée.
 *
 * Statuts : pending → applied → published ; ou conflict, blocked, failed (intervention), cancelled.
 */
import crypto from "node:crypto";
import { now, fromJson } from "../db/index.mjs";
import { HttpError, ValidationError, conflict, notFound, badRequest } from "../http/errors.mjs";
import { TARGETS, SLOT_FIELDS, slotOf, exists, generationOf, pick, isPublic, equal, showValue, keyLabel, slotName } from "./schedule-targets.mjs";
import * as events from "./events.mjs";
import { comparable, changedKeys, getRevision, listRevisions } from "./audit.mjs";
import { parisToUtc, utcToParis } from "./timeutil.mjs";

export const CHANGE_STATUSES = {
  pending: "Programmée",
  applied: "Appliquée, mise en ligne à faire",
  // Incluse dans une mise en ligne réussie ; ce que cela signifie dépend de CMS_PUBLISH_MODE (publishedState).
  published: "Mise en ligne envoyée",
  conflict: "Conflit",
  blocked: "Bloquée",
  failed: "Échec",
  cancelled: "Annulée"
};
/** Programmations encore « dans la chaîne » de leurs clés (pas encore appliquées ni annulées). */
const OPEN = ["pending", "conflict", "blocked", "failed"];
const DONE = ["applied", "published"];
const MAX_ATTEMPTS = 3;
const IN_OPEN = `(${OPEN.map((s) => `'${s}'`).join(", ")})`;

/* ---------- Lecture ---------- */

const parse = (row) => row && { ...row, changes: fromJson(row.changes, []), depends_on: fromJson(row.depends_on, []), details: fromJson(row.details, {}) };
const getRow = (db, id) => parse(db.get("SELECT * FROM scheduled_changes WHERE id = ?", id));
/**
 * Condition SQL « programmation du contenu actuel portant cet identifiant » : même génération. Les
 * programmations d'un contenu supprimé dont SQLite a réutilisé l'identifiant n'en font jamais partie.
 */
const sameGeneration = (type) => `entity_generation IS (SELECT generation FROM ${TARGETS[type].table} WHERE id = scheduled_changes.entity_id)`;

/** Le contenu visé existe toujours : même identifiant ET même génération (jamais réutilisée) ? */
const alive = (db, row) => row.entity_generation !== null && generationOf(db, row.entity_type, row.entity_id) === row.entity_generation;
const target = (type) => {
  if (!TARGETS[type]) throw notFound("Type de contenu non programmable.");
  return TARGETS[type];
};
/** Ordre d'exécution : date prévue, puis numéro (ordre de création). */
const isBefore = (a, b) => a.run_at < b.run_at || (a.run_at === b.run_at && a.id < b.id);

function log(db, changeId, action, message = "", userId = null) {
  db.run("INSERT INTO scheduled_change_log (change_id, action, message, user_id, created_at) VALUES (?, ?, ?, ?, ?)", changeId, action, String(message).slice(0, 2000), userId, now());
}

function setStatus(db, id, status, result, extra = {}) {
  const sets = ["status = ?", "result = ?", "updated_at = ?"];
  const params = [status, String(result || "").slice(0, 2000), now()];
  for (const [column, value] of Object.entries(extra)) {
    sets.push(`${column} = ?`);
    params.push(column === "details" ? JSON.stringify(value) : value);
  }
  db.run(`UPDATE scheduled_changes SET ${sets.join(", ")} WHERE id = ?`, ...params, id);
}

const formatParis = (iso) => {
  const { local } = utcToParis(iso);
  const [date, time] = local.split("T");
  return `${date.split("-").reverse().join("/")} à ${time.replace(":", "h")}`;
};

/** Texte lisible des modifications d'une programmation. */
function describeChanges(db, type, changes, current = null) {
  return changes.map((c) => {
    const show = (v) => (c.kind === "slot-order" ? (v ? `après « ${c[v === c.to ? "toName" : "fromName"] || "?"} »` : "en premier") : showValue(db, type, c.key, v));
    return {
      key: c.key,
      kind: c.kind,
      label: keyLabel(db, type, c),
      from: show(c.from),
      to: show(c.to),
      ...(current && c.key in current ? { current: show(current[c.key]) } : {})
    };
  });
}

/**
 * Libellé et explication d'une programmation incluse dans une mise en ligne réussie, selon le mode de
 * cette mise en ligne : le CMS ne prétend jamais que le contenu est visible sur le site public.
 */
function publishedState(pub) {
  const sha = pub?.commit_sha ? pub.commit_sha.slice(0, 7) : "";
  if (pub?.mode === "push") {
    return { label: "Envoyée sur GitHub", availability: `Commit ${sha} envoyé sur GitHub. Disponibilité sur le site public non vérifiée par le CMS : GitHub Pages déploie normalement en quelques minutes (voir l'onglet Actions du dépôt).` };
  }
  if (pub?.mode === "commit") {
    return { label: "Commitée, non envoyée", availability: `Commit local ${sha} : pas encore visible sur le site public tant qu'il n'est pas poussé sur GitHub.` };
  }
  return { label: "Fichiers générés", availability: "Fichiers du site écrits dans la copie de travail du serveur : pas visibles sur le site public tant qu'ils ne sont pas commités et poussés." };
}

function serialize(db, row, { full = false } = {}) {
  const t = TARGETS[row.entity_type];
  const present = alive(db, row);
  const entityName = present ? db.get(`SELECT ${t.nameColumn} AS n FROM ${t.table} WHERE id = ?`, row.entity_id).n : row.entity_label;
  const deps = row.depends_on.map((id) => db.get("SELECT id, status, run_at, summary FROM scheduled_changes WHERE id = ?", id)).filter(Boolean);
  const item = {
    id: row.id,
    entityType: row.entity_type,
    entityTypeLabel: t.label,
    entityId: row.entity_id,
    entityName,
    entityExists: present,
    adminPath: present ? t.adminPath(row.entity_id) : null,
    summary: row.summary,
    runAt: row.run_at,
    runAtLocal: utcToParis(row.run_at).local,
    status: row.status,
    statusLabel: CHANGE_STATUSES[row.status],
    result: row.result,
    publicationMode: null,
    publicationCommit: null,
    availability: null,
    dependsOn: deps.map((d) => ({ id: d.id, status: d.status, statusLabel: CHANGE_STATUSES[d.status], runAt: d.run_at, summary: d.summary })),
    changes: describeChanges(db, row.entity_type, row.changes, row.details.current),
    conflicts: row.details.conflicts || [],
    impossible: row.details.impossible || [],
    attempts: row.attempts,
    appliedAt: row.applied_at,
    publishedAt: row.published_at,
    publicationId: row.publication_id,
    revisionId: row.revision_id,
    version: row.version,
    createdBy: row.created_by ? db.get("SELECT name FROM users WHERE id = ?", row.created_by)?.name ?? null : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.status === "published") {
    const pub = row.publication_id ? db.get("SELECT mode, commit_sha FROM publications WHERE id = ?", row.publication_id) : null;
    const state = publishedState(pub);
    Object.assign(item, { statusLabel: state.label, availability: state.availability, publicationMode: pub?.mode ?? null, publicationCommit: pub?.commit_sha ?? null });
  }
  if (full) {
    item.log = db.all(
      "SELECT l.action, l.message, l.created_at, u.name AS user_name FROM scheduled_change_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.change_id = ? ORDER BY l.id",
      row.id
    );
    item.dependents = db.all(`SELECT id, status, run_at, summary FROM scheduled_changes WHERE status IN ${IN_OPEN} AND EXISTS (SELECT 1 FROM json_each(depends_on) WHERE value = ?)`, row.id)
      .map((d) => ({ id: d.id, status: d.status, statusLabel: CHANGE_STATUSES[d.status], runAt: d.run_at, summary: d.summary }));
    item.chainBefore = chainPredecessors(db, row).map((p) => ({ id: p.id, status: p.status, statusLabel: CHANGE_STATUSES[p.status], runAt: p.run_at, summary: p.summary }));
  }
  return item;
}

export function getChange(db, id) {
  const row = getRow(db, id);
  if (!row) throw notFound("Programmation introuvable.");
  return serialize(db, row, { full: true });
}

/**
 * Liste filtrée. status : un statut, « open » (à venir ou à traiter), « attention » (conflits,
 * blocages, échecs) ou vide (tout). period : « upcoming » (à venir) ou « past ».
 */
export function listChanges(db, { status = "", type = "", entityId = null, period = "", page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (status === "open") where.push("status IN ('pending', 'conflict', 'blocked', 'failed', 'applied')");
  else if (status === "attention") where.push("status IN ('conflict', 'blocked', 'failed')");
  else if (CHANGE_STATUSES[status]) { where.push("status = ?"); params.push(status); }
  if (TARGETS[type]) { where.push("entity_type = ?"); params.push(type); }
  if (entityId) {
    where.push("entity_id = ?");
    params.push(Number(entityId));
    if (TARGETS[type]) where.push(sameGeneration(type));
  }
  if (period === "upcoming") { where.push("run_at >= ?"); params.push(now()); }
  if (period === "past") { where.push("run_at < ?"); params.push(now()); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = ["published", "cancelled"].includes(status) || period === "past" ? "run_at DESC, id DESC" : "run_at ASC, id ASC";
  const total = db.get(`SELECT COUNT(*) AS n FROM scheduled_changes ${clause}`, ...params).n;
  const items = db.all(`SELECT * FROM scheduled_changes ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize)
    .map((r) => serialize(db, parse(r)));
  const counts = Object.fromEntries(db.all("SELECT status, COUNT(*) AS n FROM scheduled_changes GROUP BY status").map((r) => [r.status, r.n]));
  return { items, total, page, pageSize, counts };
}

/* ---------- Chaînes par clé ---------- */

/** Programmations ouvertes d'un contenu qui visent la clé, dans l'ordre d'exécution. */
function keyChain(db, type, id, key, excludeId = null) {
  return db.all(`SELECT * FROM scheduled_changes WHERE entity_type = ? AND entity_id = ? AND ${sameGeneration(type)} AND status IN ${IN_OPEN} ORDER BY run_at, id`, type, id)
    .map(parse)
    .filter((r) => r.id !== excludeId && r.changes.some((c) => c.key === key));
}

/** Programmations ouvertes juste avant et juste après une position { run_at, id } sur une clé. */
function neighbours(db, type, id, key, pos, excludeId = null) {
  const chain = keyChain(db, type, id, key, excludeId ?? pos.id);
  const pred = chain.filter((r) => isBefore(r, pos)).at(-1) || null;
  const succ = chain.find((r) => isBefore(pos, r)) || null;
  const change = (r) => r?.changes.find((c) => c.key === key);
  return { pred, succ, predChange: change(pred), succChange: change(succ) };
}

function setChangeFrom(db, row, key, from) {
  const changes = row.changes.map((c) => (c.key === key ? { ...c, from } : c));
  db.run("UPDATE scheduled_changes SET changes = ? WHERE id = ?", JSON.stringify(changes), row.id);
  row.changes = changes;
}

/** Nouvelle programmation : la suivante sur chaque clé partira de la valeur qu'elle programme. */
function insertIntoChain(db, row) {
  for (const c of row.changes) {
    const { succ } = neighbours(db, row.entity_type, row.entity_id, c.key, row);
    if (succ) setChangeFrom(db, succ, c.key, c.to);
  }
}

/** Programmation retirée de la chaîne (annulée, déplacée, remplacée) : la suivante reprend sa valeur de départ. */
function removeFromChain(db, row) {
  for (const c of row.changes) {
    const { succ } = neighbours(db, row.entity_type, row.entity_id, c.key, row);
    if (succ) setChangeFrom(db, succ, c.key, c.from);
  }
}

/** Programmation déplacée : elle part du résultat de la précédente à sa nouvelle place. */
function moveIntoChain(db, row) {
  for (const c of row.changes) {
    const { succ, predChange, succChange } = neighbours(db, row.entity_type, row.entity_id, c.key, row);
    const from = predChange ? predChange.to : succChange ? succChange.from : c.from;
    setChangeFrom(db, row, c.key, from);
    if (succ) setChangeFrom(db, succ, c.key, c.to);
  }
}

/** Programmations ouvertes qui précèdent celle-ci sur au moins une de ses clés. */
function chainPredecessors(db, row) {
  const preds = new Map();
  for (const c of row.changes) {
    const { pred } = neighbours(db, row.entity_type, row.entity_id, c.key, row);
    if (pred) preds.set(pred.id, pred);
  }
  return [...preds.values()];
}

/** Empreinte de l'état d'un contenu et de ses programmations ouvertes (formulaire préparé périmé ?). */
function stamp(db, type, id) {
  const version = db.get(`SELECT version FROM ${TARGETS[type].table} WHERE id = ?`, id)?.version;
  const open = db.all(`SELECT id, version, run_at, status FROM scheduled_changes WHERE entity_type = ? AND entity_id = ? AND ${sameGeneration(type)} AND status IN ${IN_OPEN} ORDER BY id`, type, id);
  return crypto.createHash("sha256").update(JSON.stringify([version, open])).digest("hex").slice(0, 16);
}

/* ---------- Préparation : différences entre deux états d'une fiche ---------- */

function diffEntities(db, type, before, after) {
  const t = TARGETS[type];
  const changes = [];
  for (const key of Object.keys(t.fields)) {
    const base = pick(type, before, key);
    const to = pick(type, after, key);
    if (!equal(base, to)) changes.push({ key, kind: "field", base, to });
  }
  if (!t.lineup) return changes;
  const B = before.lineup.map(slotOf);
  const A = after.lineup.map(slotOf);
  const inB = new Map(B.map((s) => [s.uid, s]));
  const inA = new Map(A.map((s) => [s.uid, s]));
  const name = (s) => slotName(db, s);
  const strip = ({ uid, ...rest }) => rest;
  A.forEach((s, i) => {
    if (!inB.has(s.uid)) changes.push({ key: `slot:${s.uid}`, kind: "slot-add", slot: s.uid, slotName: name(s), base: null, to: strip(s), after: i ? A[i - 1].uid : null });
  });
  for (const s of B) if (!inA.has(s.uid)) changes.push({ key: `slot:${s.uid}`, kind: "slot-remove", slot: s.uid, slotName: name(s), base: strip(s), to: null });
  for (const s of A) {
    const old = inB.get(s.uid);
    if (!old) continue;
    for (const field of Object.keys(SLOT_FIELDS)) {
      if (!equal(old[field], s[field])) changes.push({ key: `slot:${s.uid}:${field}`, kind: "slot-field", slot: s.uid, field, slotName: name(s), base: old[field], to: s[field] });
    }
  }
  // Ordre : seuls les passages dont la place relative (parmi ceux conservés) a changé sont déplacés.
  const keptB = B.filter((s) => inA.has(s.uid)).map((s) => s.uid);
  const keptA = A.filter((s) => inB.has(s.uid)).map((s) => s.uid);
  const prevIn = (list, uid) => list[list.indexOf(uid) - 1] ?? null;
  for (const uid of keptA) {
    if (prevIn(keptA, uid) === prevIn(keptB, uid)) continue;
    const base = prevIn(B.map((s) => s.uid), uid);
    const to = prevIn(A.map((s) => s.uid), uid);
    const nameOf = (u) => (u ? name(inA.get(u) || inB.get(u)) : null);
    changes.push({ key: `order:${uid}`, kind: "slot-order", slot: uid, slotName: name(inA.get(uid)), base, to, fromName: nameOf(base), toName: nameOf(to) });
  }
  return changes;
}

/** Valeur actuelle (base réelle) d'une clé, ou celle qu'apportera l'ajout programmé d'un passage. */
function realValue(db, type, real, change) {
  if (change.kind === "field") return pick(type, real, change.key);
  if (change.kind === "status") return real.status;
  const slot = real.lineup.map(slotOf).find((s) => s.uid === change.slot);
  if (change.kind === "slot-add" || change.kind === "slot-remove") return slot ? (({ uid, ...rest }) => rest)(slot) : null;
  if (change.kind === "slot-field") {
    if (slot) return slot[change.field];
    const adder = keyChain(db, type, real.id, `slot:${change.slot}`).find((r) => r.changes.some((c) => c.key === `slot:${change.slot}` && c.kind === "slot-add"));
    return adder ? adder.changes.find((c) => c.key === `slot:${change.slot}`).to[change.field] : null;
  }
  return null;
}

/** Dépendances : publication programmée d'un contenu invisible, passage ajouté par une autre programmation. */
function computeDeps(db, type, id, changes, pos, real) {
  const t = TARGETS[type];
  const deps = new Set();
  if (t.publicKey && !isPublic(type, real) && !changes.some((c) => c.key === t.publicKey)) {
    const { pred, predChange } = neighbours(db, type, id, t.publicKey, pos);
    if (pred && t.isPublicValue(predChange.to)) deps.add(pred.id);
  }
  for (const c of changes) {
    if (!c.slot || c.kind === "slot-add" || real.lineup.some((s) => s.uid === c.slot)) continue;
    const adder = keyChain(db, type, id, `slot:${c.slot}`, pos.id).find((r) => r.changes.some((x) => x.key === `slot:${c.slot}` && x.kind === "slot-add"));
    if (adder) deps.add(adder.id);
  }
  return [...deps];
}

/** Date saisie (heure de Paris « AAAA-MM-JJTHH:MM », ou ISO) -> ISO UTC dans le futur. */
export function parseRunAt(value, { allowPast = false } = {}) {
  let iso, ambiguous = false;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ""))) {
    const r = parisToUtc(value);
    if (r.error) throw new ValidationError({ runAt: r.error });
    ({ iso, ambiguous } = r);
  } else {
    const t = Date.parse(value);
    if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}T/.test(String(value))) throw new ValidationError({ runAt: "Indiquez la date et l'heure." });
    iso = new Date(t).toISOString();
  }
  if (!allowPast && Date.parse(iso) <= Date.now() + 30e3) throw new ValidationError({ runAt: "La date doit être dans le futur." });
  return { iso, ambiguous };
}

/**
 * Calcule les modifications programmées : différences entre l'état de référence (actuel, ou prévu à la
 * date choisie) et la fiche envoyée par le formulaire, validées comme un enregistrement.
 * basis : { mode: "current", version } ou { mode: "predicted", version, stamp } (formulaire préparé).
 */
export function prepareChanges(db, { type, id, input, runAt, basis = {}, replaceId = null }) {
  const t = target(type);
  if (!exists(db, type, id)) throw notFound(`${t.label} introuvable.`);
  const real = t.load(db, id);
  const predicted = basis.mode === "predicted";
  if (Number(basis.version) !== real.version || (predicted && basis.stamp !== stamp(db, type, id))) {
    throw conflict("Ce contenu ou ses programmations ont changé depuis l'ouverture du formulaire. Rechargez-le pour repartir de la dernière version.", { stale: true });
  }
  const { before, after } = db.dryRun(() => {
    if (predicted) simulate(db, runAt, { excludeId: replaceId });
    const state = t.load(db, id);
    t.save(db, id, { ...input, version: state.version }, { origin: "schedule" });
    return { before: state, after: t.load(db, id) };
  });
  const changes = diffEntities(db, type, before, after);
  const internal = changes.filter((c) => c.kind === "field" && !t.fields[c.key].schedulable);
  if (internal.length) {
    throw new ValidationError(Object.fromEntries(internal.map((c) => [c.key, `${t.fields[c.key].label} : à enregistrer directement (ne se programme pas).`])), "Certains champs ne peuvent pas être programmés.");
  }
  if (!changes.length) throw new ValidationError({}, "Aucune différence avec l'état prévu à cette date : rien à programmer.");

  const pos = { run_at: runAt, id: replaceId ?? Number.MAX_SAFE_INTEGER };
  const stale = [];
  const warnings = [];
  for (const c of changes) {
    c.from = c.base;
    if (c.kind === "slot-order") continue;
    const { predChange, succ } = neighbours(db, type, id, c.key, pos, replaceId);
    const expected = predChange ? predChange.to : realValue(db, type, real, c);
    if (!equal(c.base, expected)) stale.push({ ...c, expected });
    if (succ) warnings.push(`La programmation n° ${succ.id} du ${formatParis(succ.run_at)} modifie aussi « ${keyLabel(db, type, c)} » après celle-ci : c'est sa valeur qui restera ensuite.`);
  }
  if (stale.length) {
    throw conflict(
      "Ces éléments font déjà l'objet d'une modification programmée avant cette date : préparez la modification à partir de l'état prévu (bouton « Préparer l'état prévu »).",
      { scheduleConflicts: stale.map((c) => ({ key: c.key, label: keyLabel(db, type, c), base: showValue(db, type, c.key, c.base), expected: showValue(db, type, c.key, c.expected) })) }
    );
  }
  const dependsOn = computeDeps(db, type, id, changes, pos, real);
  if (t.publicKey && !isPublic(type, real) && !changes.some((c) => c.key === t.publicKey) && !dependsOn.length) {
    warnings.push(`« ${t.name(real)} » n'est pas visible sur le site : cette modification n'y apparaîtra qu'une fois le contenu publié.`);
  }
  return { changes, dependsOn, warnings, real, summary: summarize(db, type, changes) };
}

function summarize(db, type, changes) {
  const labels = [...new Set(changes.map((c) => (c.kind.startsWith("slot") ? "Line-up" : keyLabel(db, type, c))))];
  const text = labels.join(", ");
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/**
 * Crée (ou remplace le contenu de, avec replaceId) une programmation depuis un formulaire.
 * preview: true : calcule seulement ce qui serait programmé (rien n'est enregistré).
 */
export function createChange(db, { type, id, input, runAt: runAtInput, basis, replaceId = null, preview = false, user = null }) {
  const { iso: runAt, ambiguous } = parseRunAt(runAtInput);
  return db.tx(() => {
    let old = null;
    if (replaceId) {
      old = getRow(db, replaceId);
      if (!old || old.entity_type !== type || old.entity_id !== Number(id)) throw notFound("Programmation introuvable.");
      if (!OPEN.includes(old.status)) throw conflict("Cette programmation a déjà été exécutée ou annulée : elle ne peut plus être modifiée.");
    }
    const prepared = prepareChanges(db, { type, id: Number(id), input, runAt, basis, replaceId });
    if (ambiguous) prepared.warnings.push("Heure en double (passage à l'heure d'hiver) : la première, à l'heure d'été (UTC+2), est retenue.");
    const described = describeChanges(db, type, prepared.changes);
    if (preview) return { preview: true, runAt, runAtLocal: utcToParis(runAt).local, summary: prepared.summary, changes: described, dependsOn: prepared.dependsOn, warnings: prepared.warnings };
    const t = now();
    let changeId;
    if (old) {
      removeFromChain(db, old);
      db.run(
        "UPDATE scheduled_changes SET changes = ?, summary = ?, run_at = ?, depends_on = ?, status = 'pending', result = '', details = '{}', base_version = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(prepared.changes), prepared.summary, runAt, JSON.stringify(prepared.dependsOn), prepared.real.version, user?.id ?? null, t, old.id
      );
      changeId = old.id;
      log(db, changeId, "edited", `Contenu modifié : ${prepared.summary} (${formatParis(runAt)}).`, user?.id);
    } else {
      changeId = Number(db.run(
        `INSERT INTO scheduled_changes (entity_type, entity_id, entity_generation, entity_label, summary, changes, run_at, depends_on, base_version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        type, Number(id), generationOf(db, type, Number(id)), TARGETS[type].name(prepared.real), prepared.summary, JSON.stringify(prepared.changes), runAt, JSON.stringify(prepared.dependsOn),
        prepared.real.version, user?.id ?? null, user?.id ?? null, t, t
      ).lastInsertRowid);
      log(db, changeId, "created", `${prepared.summary} — prévue le ${formatParis(runAt)}.`, user?.id);
    }
    insertIntoChain(db, getRow(db, changeId));
    refreshDependents(db, type, Number(id));
    reviveBlocked(db);
    return { change: getChange(db, changeId), warnings: prepared.warnings };
  });
}

/** Action de statut d'une soirée -> statut visé. */
const STATUS_TARGET = { publish: "published", cancel: "cancelled", unpublish: "draft", archive: "archived" };

/**
 * Programme un changement de statut d'une soirée (mise en ligne, annulation, retrait, archivage).
 * Une soirée en brouillon passe « Programmée » (invisible) jusqu'à sa mise en ligne.
 */
export function scheduleStatus(db, { id, action, runAt: runAtInput, user = null }) {
  const to = STATUS_TARGET[action];
  if (!to) throw badRequest("Action inconnue.");
  const { iso: runAt, ambiguous } = parseRunAt(runAtInput);
  return db.tx(() => {
    const real = events.getEvent(db, id, { withChecks: false });
    const pos = { run_at: runAt, id: Number.MAX_SAFE_INTEGER };
    // Déjà une mise en ligne programmée : on la déplace plutôt que d'en ajouter une seconde.
    const planned = keyChain(db, "event", real.id, "status").find((r) => r.status === "pending" && r.changes.find((c) => c.key === "status").to === "published");
    if (action === "publish" && real.status === "scheduled" && planned) return reschedule(db, planned.id, { runAt: runAtInput, version: planned.version, user });
    const { pred, predChange } = neighbours(db, "event", real.id, "status", pos);
    let base = predChange ? predChange.to : real.status;
    if (base === to) throw new ValidationError({ runAt: `La soirée sera déjà « ${events.STATUSES[to]} » à cette date.` });
    if (action === "publish") {
      const checks = events.eventChecks(db, real);
      if (checks.errors.length) throw new ValidationError({ status: checks.errors.join(" ") }, "Corrigez d'abord les erreurs signalées avant de programmer la mise en ligne.");
      if (base === "draft" && !pred) {
        events.changeStatus(db, real.id, "schedule", { publishAt: runAt }, user, { origin: "schedule" });
        base = "scheduled";
      }
    }
    if (!events.TRANSITIONS[action].from.includes(base)) {
      throw new ValidationError({ runAt: `Impossible : la soirée sera « ${events.STATUSES[base]} » à cette date.` });
    }
    const changes = [{ key: "status", kind: "status", base, from: base, to }];
    const summary = { publish: "Mise en ligne", cancel: "Annulation de la soirée", unpublish: "Retrait du site (brouillon)", archive: "Archivage (retrait du site)" }[action];
    const t = now();
    const changeId = Number(db.run(
      `INSERT INTO scheduled_changes (entity_type, entity_id, entity_generation, entity_label, summary, changes, run_at, depends_on, base_version, created_by, updated_by, created_at, updated_at)
       VALUES ('event', ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
      real.id, generationOf(db, "event", real.id), real.title, summary, JSON.stringify(changes), runAt, real.version, user?.id ?? null, user?.id ?? null, t, t
    ).lastInsertRowid);
    log(db, changeId, "created", `${summary} — prévue le ${formatParis(runAt)}.`, user?.id);
    insertIntoChain(db, getRow(db, changeId));
    syncPublishAt(db, real.id);
    refreshDependents(db, "event", real.id);
    const warnings = ambiguous ? ["Heure en double (passage à l'heure d'hiver) : la première, à l'heure d'été (UTC+2), est retenue."] : [];
    return { change: getChange(db, changeId), warnings };
  });
}

/** Date affichée « Sera publiée le … » d'une soirée programmée : première mise en ligne programmée ouverte. */
function syncPublishAt(db, eventId) {
  const next = db.get(
    `SELECT MIN(run_at) AS t FROM scheduled_changes WHERE entity_type = 'event' AND entity_id = ? AND ${sameGeneration("event")} AND status IN ${IN_OPEN}
       AND EXISTS (SELECT 1 FROM json_each(changes) WHERE json_extract(value, '$.key') = 'status' AND json_extract(value, '$.to') = 'published')`,
    eventId
  )?.t ?? null;
  db.run("UPDATE events SET publish_at = ? WHERE id = ? AND status = 'scheduled'", next, eventId);
}

/** Ajoute les dépendances apparues (ex. mise en ligne programmée après coup) aux programmations ouvertes du contenu. */
function refreshDependents(db, type, id) {
  const real = TARGETS[type].load(db, id);
  for (const row of db.all(`SELECT * FROM scheduled_changes WHERE entity_type = ? AND entity_id = ? AND ${sameGeneration(type)} AND status IN ${IN_OPEN}`, type, id).map(parse)) {
    const deps = [...new Set([...row.depends_on, ...computeDeps(db, type, id, row.changes, row, real)])];
    if (deps.length !== row.depends_on.length) db.run("UPDATE scheduled_changes SET depends_on = ? WHERE id = ?", JSON.stringify(deps), row.id);
  }
}

/* ---------- Modification, annulation, reprise ---------- */

/** Nouvelle date (et retour en attente d'une programmation en échec, en conflit ou bloquée). */
export function reschedule(db, id, { runAt: runAtInput, version, user = null }) {
  const { iso: runAt } = parseRunAt(runAtInput);
  return db.tx(() => {
    const row = getRow(db, id);
    if (!row) throw notFound("Programmation introuvable.");
    if (!OPEN.includes(row.status)) throw conflict("Cette programmation a déjà été exécutée ou annulée.");
    if (version !== undefined && Number(version) !== row.version) throw conflict("Cette programmation a été modifiée entre-temps. Rechargez la page.", { stale: true });
    removeFromChain(db, row);
    db.run("UPDATE scheduled_changes SET run_at = ?, status = 'pending', result = '', details = '{}', version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", runAt, user?.id ?? null, now(), id);
    const moved = getRow(db, id);
    moveIntoChain(db, moved);
    if (alive(db, moved)) {
      const real = TARGETS[moved.entity_type].load(db, moved.entity_id);
      const deps = [...new Set([...moved.depends_on, ...computeDeps(db, moved.entity_type, moved.entity_id, moved.changes, moved, real)])];
      db.run("UPDATE scheduled_changes SET depends_on = ? WHERE id = ?", JSON.stringify(deps), id);
      refreshDependents(db, moved.entity_type, moved.entity_id);
    }
    log(db, id, "rescheduled", `Nouvelle date : ${formatParis(runAt)} (avant : ${formatParis(row.run_at)}).`, user?.id);
    if (moved.entity_type === "event") syncPublishAt(db, moved.entity_id);
    reviveBlocked(db);
    return { change: getChange(db, id), warnings: [] };
  });
}

/**
 * Annule une programmation ouverte. Les programmations qui en dépendent seront bloquées (ou
 * annulées aussi avec cascade). Une soirée « Programmée » sans autre mise en ligne prévue
 * redevient un brouillon.
 */
export function cancelChange(db, id, { user = null, cascade = false, reason = "" } = {}) {
  return db.tx(() => {
    const row = getRow(db, id);
    if (!row) throw notFound("Programmation introuvable.");
    if (!OPEN.includes(row.status)) throw conflict("Cette programmation a déjà été exécutée ou annulée.");
    removeFromChain(db, row);
    setStatus(db, id, "cancelled", reason || "Annulée.");
    log(db, id, "cancelled", reason || "Annulée.", user?.id);
    if (row.entity_type === "event" && alive(db, row)) {
      syncPublishAt(db, row.entity_id);
      const ev = db.get("SELECT status, publish_at FROM events WHERE id = ?", row.entity_id);
      if (ev.status === "scheduled" && !ev.publish_at) events.changeStatus(db, row.entity_id, "unpublish", {}, user, { origin: "schedule", changeId: id });
    }
    const dependents = db.all(`SELECT id FROM scheduled_changes WHERE status IN ${IN_OPEN} AND EXISTS (SELECT 1 FROM json_each(depends_on) WHERE value = ?)`, id).map((r) => r.id);
    if (cascade) for (const dep of dependents) if (OPEN.includes(getRow(db, dep).status)) cancelChange(db, dep, { user, cascade: true, reason: `Annulée avec la programmation n° ${id} dont elle dépendait.` });
    reviveBlocked(db);
    return { change: getChange(db, id), dependents };
  });
}

/** Programmations bloquées dont plus aucune dépendance n'est en échec : de nouveau en attente. */
function reviveBlocked(db) {
  for (const row of db.all("SELECT * FROM scheduled_changes WHERE status = 'blocked'").map(parse)) {
    if (blockingReason(db, row)) continue;
    setStatus(db, row.id, "pending", "Débloquée : ses dépendances sont satisfaites.");
    log(db, row.id, "unblocked", "Débloquée : ses dépendances sont satisfaites.");
  }
}

/** Motif de blocage (dépendance en échec, en conflit, bloquée ou annulée), ou null. */
function blockingReason(db, row) {
  const explicit = row.depends_on.map((id) => getRow(db, id)).filter(Boolean);
  for (const dep of [...explicit, ...chainPredecessors(db, row)]) {
    if (["conflict", "failed", "blocked"].includes(dep.status)) return `La programmation n° ${dep.id} (${dep.summary}) dont elle dépend est « ${CHANGE_STATUSES[dep.status]} ».`;
    if (dep.status === "cancelled") return `La programmation n° ${dep.id} (${dep.summary}) dont elle dépend a été annulée.`;
  }
  return null;
}

/* ---------- Exécution ---------- */

/**
 * Prépare l'application des modifications sur la fiche actuelle : formulaire complet (valeurs actuelles
 * + valeurs programmées), conflits (valeur modifiée entre-temps) et impossibilités (passage retiré…).
 */
function plan(db, type, cur, changes, { force }) {
  const t = TARGETS[type];
  const input = t.toInput(cur);
  const slots = t.lineup ? cur.lineup.map(slotOf) : null;
  const conflicts = [];
  const impossible = [];
  const current = {};
  let statusTo = null;
  let touched = false;
  for (const c of changes) {
    if (c.kind === "field") {
      const value = pick(type, cur, c.key);
      if (equal(value, c.to)) continue;
      if (!equal(value, c.from) && !force) { conflicts.push(c.key); current[c.key] = value; continue; }
      input[c.key] = c.to;
      touched = true;
    } else if (c.kind === "status") {
      if (cur.status === c.to) continue;
      if (cur.status !== c.from && !force) { conflicts.push(c.key); current[c.key] = cur.status; continue; }
      const action = t.status.action(c.to);
      if (!action || !events.TRANSITIONS[action].from.includes(cur.status)) {
        impossible.push(`Passage de « ${events.STATUSES[cur.status]} » à « ${events.STATUSES[c.to]} » impossible.`);
        continue;
      }
      statusTo = c.to;
    } else if (c.kind === "slot-add") {
      if (slots.some((s) => s.uid === c.slot)) continue;
      const anchor = c.after ? slots.findIndex((s) => s.uid === c.after) : -1;
      slots.splice(c.after ? (anchor >= 0 ? anchor + 1 : slots.length) : 0, 0, { ...c.to, uid: c.slot });
      touched = true;
    } else if (c.kind === "slot-remove") {
      const index = slots.findIndex((s) => s.uid === c.slot);
      if (index >= 0) { slots.splice(index, 1); touched = true; }
    } else if (c.kind === "slot-field") {
      const slot = slots.find((s) => s.uid === c.slot);
      if (!slot) { impossible.push(`Le passage « ${c.slotName} » n'est plus dans le line-up.`); continue; }
      if (equal(slot[c.field], c.to)) continue;
      if (!equal(slot[c.field], c.from) && !force) { conflicts.push(c.key); current[c.key] = slot[c.field]; continue; }
      slot[c.field] = c.to;
      touched = true;
    } else if (c.kind === "slot-order") {
      const index = slots.findIndex((s) => s.uid === c.slot);
      if (index < 0) continue;
      const anchor = c.to ? slots.findIndex((s) => s.uid === c.to) : -1;
      if (c.to && anchor < 0) continue; // passage de référence retiré : place actuelle conservée
      const [slot] = slots.splice(index, 1);
      slots.splice(c.to ? slots.findIndex((s) => s.uid === c.to) + 1 : 0, 0, slot);
      touched = true;
    } else {
      // Jamais « réussie » sans rien faire : une modification inconnue est signalée.
      impossible.push(`Modification « ${c.key} » non reconnue.`);
    }
  }
  if (slots) input.lineup = slots;
  return { input, conflicts, impossible, current, statusTo, touched };
}

const errorText = (error) => {
  if (error instanceof ValidationError) return [error.message, ...Object.values(error.extra?.fields || {})].filter(Boolean).join(" ");
  return error.message;
};

/**
 * Exécute une programmation (planificateur, « Exécuter maintenant », résolution d'un conflit).
 * force : applique les valeurs programmées malgré un conflit ou une dépendance non satisfaite.
 * Renvoie { status, message } ; ne fait rien si la programmation n'est plus en attente.
 */
export function executeChange(db, id, { force = false, user = null, reason = "" } = {}) {
  try {
    return db.tx(() => {
      const row = getRow(db, id);
      if (!row) return { status: "missing", message: "Programmation introuvable." };
      if (!(row.status === "pending" || (force && OPEN.includes(row.status)))) return { status: row.status, message: "Déjà traitée.", skipped: true };
      const t = TARGETS[row.entity_type];
      const fail = (status, message, extra = {}) => {
        setStatus(db, id, status, message, extra);
        log(db, id, status, message, user?.id);
        return { status, message };
      };
      if (!alive(db, row)) return fail("failed", `${t.label} « ${row.entity_label} » n'existe plus (supprimé) : rien n'a été modifié.`);

      // Dépendances : jamais exécutée avant elles, ni comme si elles avaient réussi.
      const explicit = row.depends_on.map((d) => getRow(db, d)).filter(Boolean);
      const waiting = [...explicit, ...chainPredecessors(db, row)].find((d) => d.status === "pending");
      if (waiting && !force) {
        const message = `En attente de la programmation n° ${waiting.id} (${waiting.summary}), prévue le ${formatParis(waiting.run_at)}.`;
        if (row.result !== message) setStatus(db, id, "pending", message);
        return { status: "pending", message, waiting: true };
      }
      const blocked = blockingReason(db, row);
      if (blocked && !force) return fail("blocked", `${blocked} Rien n'a été modifié.`);

      const cur = t.load(db, row.entity_id);
      const { input, conflicts, impossible, current, statusTo, touched } = plan(db, row.entity_type, cur, row.changes, { force });
      if (impossible.length) return fail("conflict", `Impossible à appliquer : ${impossible.join(" ")} Rien n'a été modifié.`, { details: { impossible, current } });
      if (conflicts.length) {
        const labels = row.changes.filter((c) => conflicts.includes(c.key)).map((c) => `« ${keyLabel(db, row.entity_type, c)} »`);
        return fail("conflict", `Modifié entre-temps : ${labels.join(", ")}. Rien n'a été appliqué : choisissez la valeur à garder.`, { details: { conflicts, current } });
      }
      const options = { origin: "schedule", changeId: id };
      if (touched) t.save(db, row.entity_id, { ...input, version: cur.version }, options, user);
      if (statusTo) events.changeStatus(db, row.entity_id, t.status.action(statusTo), {}, user, options);
      const revision = db.get("SELECT MAX(id) AS id FROM revisions WHERE entity_type = ? AND entity_id = ? AND change_id = ?", row.entity_type, row.entity_id, id)?.id ?? null;
      const late = Date.now() - Date.parse(row.run_at);
      const message = [
        touched || statusTo ? "Appliquée." : "Déjà en place : rien à modifier.",
        force ? "Valeurs programmées imposées." : "",
        reason,
        late > 5 * 60e3 ? `Exécutée avec ${late > 86400e3 ? `${Math.round(late / 86400e3)} j` : late > 3600e3 ? `${Math.round(late / 3600e3)} h` : `${Math.round(late / 60e3)} min`} de retard (serveur arrêté ?).` : ""
      ].filter(Boolean).join(" ");
      setStatus(db, id, "applied", message, { applied_at: now(), revision_id: revision, details: {} });
      log(db, id, "applied", message, user?.id);
      if (row.entity_type === "event") syncPublishAt(db, row.entity_id);
      return { status: "applied", message };
    });
  } catch (error) {
    // Erreur de validation (contenu devenu invalide, lieu supprimé…) : échec définitif, rien n'est écrit
    // (transaction annulée). Erreur inattendue (base occupée…) : nouvel essai, au plus MAX_ATTEMPTS fois.
    const expected = error instanceof HttpError;
    return db.tx(() => {
      const row = getRow(db, id);
      if (!row || !OPEN.includes(row.status)) return { status: row?.status ?? "missing", message: errorText(error) };
      const attempts = row.attempts + 1;
      const message = expected ? `Échec : ${errorText(error)} Rien n'a été modifié.` : `Erreur inattendue : ${error.message}`;
      if (expected || attempts >= MAX_ATTEMPTS) {
        setStatus(db, id, "failed", message, { attempts });
        log(db, id, "failed", message, user?.id);
        return { status: "failed", message };
      }
      setStatus(db, id, "pending", `${message} — nouvel essai à la prochaine vérification (${attempts}/${MAX_ATTEMPTS}).`, { attempts });
      log(db, id, "retry", message, user?.id);
      return { status: "pending", message };
    });
  }
}

/** Programmations arrivées à échéance, dans l'ordre (date puis numéro). */
export function runDue(db, { at = now(), excludeId = null } = {}) {
  const due = db.all("SELECT id FROM scheduled_changes WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id", at);
  return due.filter(({ id }) => id !== excludeId).map(({ id }) => ({ id, ...executeChange(db, id) }));
}

/** État prévu : applique (dans une transaction annulée par l'appelant) les programmations jusqu'à « at ». */
export function simulate(db, at, { excludeId = null } = {}) {
  return runDue(db, { at, excludeId });
}

/**
 * Fiche telle qu'elle sera à une date (programmations prévues d'ici là appliquées), sans rien modifier :
 * sert à préparer une modification qui suit d'autres programmations.
 */
export function predictEntity(db, type, id, atInput, { excludeId = null } = {}) {
  const t = target(type);
  if (!exists(db, type, id)) throw notFound(`${t.label} introuvable.`);
  const { iso: at } = parseRunAt(atInput, { allowPast: true });
  const real = t.load(db, id);
  const basis = { mode: "predicted", version: real.version, stamp: stamp(db, type, id), at };
  const { entity, results } = db.dryRun(() => {
    const results = simulate(db, at, { excludeId });
    return { entity: t.load(db, id), results };
  });
  const mine = results.filter((r) => getRow(db, r.id)?.entity_type === type && getRow(db, r.id)?.entity_id === Number(id));
  return {
    entity,
    basis,
    atLocal: utcToParis(at).local,
    included: mine.filter((r) => r.status === "applied").map((r) => r.id),
    skipped: mine.filter((r) => r.status !== "applied").map((r) => ({ id: r.id, status: r.status, message: r.message }))
  };
}

/** Résolution d'un conflit, d'un blocage ou d'un échec : imposer les valeurs programmées, ou réessayer. */
export function resolveChange(db, id, { action, user = null }) {
  const row = getRow(db, id);
  if (!row) throw notFound("Programmation introuvable.");
  if (!OPEN.includes(row.status)) throw conflict("Cette programmation a déjà été exécutée ou annulée.");
  let result;
  if (action === "force") {
    if (row.details?.impossible?.length) throw conflict("Cette programmation ne peut pas être appliquée telle quelle : modifiez-la ou annulez-la.");
    result = executeChange(db, id, { force: true, user, reason: "Résolution : valeurs programmées imposées." });
  } else if (action === "retry") {
    db.tx(() => {
      setStatus(db, id, "pending", "Nouvel essai demandé.", { attempts: 0, details: {} });
      log(db, id, "retry", "Nouvel essai demandé.", user?.id);
    });
    result = Date.parse(row.run_at) <= Date.now() ? executeChange(db, id, { user }) : { status: "pending", message: "De nouveau en attente." };
  } else if (action === "run") {
    if (row.status !== "pending") throw conflict("Seule une programmation en attente peut être exécutée maintenant.");
    result = executeChange(db, id, { user, reason: "Exécutée à la main avant l'échéance." });
  } else throw badRequest("Action inconnue.");
  db.tx(() => reviveBlocked(db));
  return { change: getChange(db, id), result };
}

/**
 * Changement de statut d'une soirée depuis l'interface. « Publier maintenant » une soirée programmée
 * exécute sa mise en ligne programmée (la suite de ses programmations reste cohérente) ; un autre
 * changement de statut annule la mise en ligne programmée.
 */
export function eventStatusAction(db, id, action, { publishAt, runAt } = {}, user = null) {
  if (action === "schedule") {
    const { change } = scheduleStatus(db, { id, action: "publish", runAt: runAt || publishAt, user });
    return { event: events.getEvent(db, id), transition: { label: `mise en ligne programmée (n° ${change.id})` } };
  }
  const row = events.getEventRow(db, id);
  const publishOps = keyChain(db, "event", row.id, "status").filter((r) => r.changes.find((c) => c.key === "status").to === "published");
  if (action === "publish" && row.status === "scheduled" && publishOps[0]?.status === "pending") {
    const result = executeChange(db, publishOps[0].id, { user, reason: "Publiée à la main avant l'échéance." });
    if (result.status !== "applied") throw conflict(`Mise en ligne impossible : ${result.message}`);
    return { event: events.getEvent(db, id), transition: { label: "publié" } };
  }
  return db.tx(() => {
    const result = events.changeStatus(db, id, action, { publishAt }, user);
    // La mise en ligne programmée d'une soirée « Programmée » n'a plus lieu d'être.
    if (row.status === "scheduled") for (const op of publishOps) cancelChange(db, op.id, { user, reason: `Statut changé à la main (${result.transition.label}).` });
    return result;
  });
}

/** Contenu supprimé : ses programmations ouvertes échouent tout de suite (motif visible dans la liste). */
export function orphanChanges(db, type, id, user = null) {
  db.tx(() => {
    for (const row of db.all(`SELECT * FROM scheduled_changes WHERE entity_type = ? AND entity_id = ? AND status IN ${IN_OPEN}`, type, id).map(parse)) {
      if (alive(db, row)) continue;
      removeFromChain(db, row);
      const message = `${TARGETS[type].label} « ${row.entity_label} » supprimé : programmation abandonnée, rien n'a été modifié.`;
      setStatus(db, row.id, "failed", message);
      log(db, row.id, "failed", message, user?.id);
    }
    reviveBlocked(db);
  });
}

/* ---------- Mise en ligne ---------- */

/** Programmations appliquées pas encore mises en ligne. */
export const appliedIds = (db) => db.all("SELECT id FROM scheduled_changes WHERE status = 'applied' ORDER BY id").map((r) => r.id);

/**
 * Mise en ligne réussie : les programmations incluses dans son export passent « published » (envoyées,
 * commitées ou fichiers générés selon le mode, voir publishedState), jamais « visibles » sans vérification.
 */
export function markPublished(db, ids, publicationId, summary = "") {
  if (!ids.length) return;
  const state = publishedState(db.get("SELECT mode, commit_sha FROM publications WHERE id = ?", publicationId));
  db.tx(() => {
    for (const id of ids) {
      const { changes } = db.run("UPDATE scheduled_changes SET status = 'published', published_at = ?, publication_id = ?, result = ?, updated_at = ? WHERE id = ? AND status = 'applied'", now(), publicationId, state.availability, now(), id);
      if (changes) log(db, id, "published", `Mise en ligne n° ${publicationId} réussie (${state.label.toLowerCase()}). ${summary}`.trim());
    }
  });
}

/** Mise en ligne échouée : la modification reste appliquée dans le CMS, la mise en ligne sera retentée. */
export function notePublishFailure(db, ids, message) {
  if (!ids.length) return;
  db.tx(() => {
    for (const id of ids) {
      const { changes } = db.run("UPDATE scheduled_changes SET result = ?, updated_at = ? WHERE id = ? AND status = 'applied'", `Appliquée dans le CMS, mais la mise en ligne a échoué : ${message}`.slice(0, 2000), now(), id);
      if (changes) log(db, id, "publish-failed", message);
    }
  });
}

/* ---------- Enregistrement d'un formulaire sur une version périmée ---------- */

/**
 * Formulaire enregistré sur une version périmée (une programmation ou une autre personne a modifié
 * la fiche entre-temps) : fusion champ par champ avec la version de départ du formulaire.
 *  - champ modifié seulement par l'autre côté : la valeur actuelle est conservée ;
 *  - champ modifié seulement dans le formulaire : la valeur du formulaire est enregistrée ;
 *  - champ modifié des deux côtés, différemment : refus (409) avec la liste des champs en conflit.
 * Sans version de départ dans l'historique : refus habituel (409).
 */
export function mergeStale(db, type, id, input) {
  const t = target(type);
  const cur = t.load(db, id);
  if (input?.version === undefined || Number(input.version) === cur.version) return { input, merged: [] };
  const rev = db.get("SELECT data FROM revisions WHERE entity_type = ? AND entity_id = ? AND version = ? AND generation IS ? ORDER BY id DESC LIMIT 1", type, id, Number(input.version), generationOf(db, type, id));
  if (!rev) return { input, merged: [] };
  const base = JSON.parse(rev.data);
  const mine = db.dryRun(() => {
    t.save(db, id, { ...input, version: cur.version }, {});
    return t.load(db, id);
  });
  const value = (x, key) => (key === "lineup" ? comparable("lineup", x.lineup) : key === "photos" ? comparable("photos", x.photos) : x[key] ?? null);
  const next = { ...input, version: cur.version };
  const currentInput = t.toInput(cur);
  const merged = [];
  const conflicts = [];
  for (const key of [...Object.keys(t.fields), ...(t.lineup ? ["lineup"] : [])]) {
    const b = value(base, key), c = value(cur, key), u = value(mine, key);
    if (equal(c, b) || equal(u, c)) continue;
    if (equal(u, b)) {
      next[key] = currentInput[key];
      merged.push(key);
    } else conflicts.push(key);
  }
  const label = (key) => (key === "lineup" ? "Line-up" : t.fields[key].label);
  if (conflicts.length) {
    throw conflict(
      `Modifié entre-temps par une autre personne ou une programmation : ${conflicts.map((k) => `« ${label(k)} »`).join(", ")}. Rechargez la fiche pour voir la dernière version (copiez d'abord vos modifications).`,
      { stale: true, conflicts: conflicts.map((key) => ({ key, label: label(key) })) }
    );
  }
  return { input: next, merged: merged.map(label) };
}

/* ---------- Historique ---------- */

/** Versions d'une fiche, avec champs modifiés, origine et programmations du contenu. */
export function entityHistory(db, type, id) {
  const t = target(type);
  if (!exists(db, type, id)) throw notFound(`${t.label} introuvable.`);
  const generation = generationOf(db, type, id);
  const revisions = listRevisions(db, type, id, { generation }).map((r) => ({
    ...r,
    changeLabels: r.changes.map((key) => (key === "lineup" ? "Line-up" : key === "status" ? "Statut" : t.fields[key]?.label || key)),
    changeSummary: r.change_id ? db.get("SELECT summary FROM scheduled_changes WHERE id = ?", r.change_id)?.summary ?? null : null
  }));
  const changes = db.all("SELECT * FROM scheduled_changes WHERE entity_type = ? AND entity_id = ? AND entity_generation = ? ORDER BY run_at DESC, id DESC", type, id, generation)
    .map((r) => serialize(db, parse(r)));
  return { revisions, changes };
}

/** Différences entre deux versions (b : numéro de version enregistrée, ou « current »). */
export function compareRevisions(db, type, id, aId, bId) {
  const t = target(type);
  if (!exists(db, type, id)) throw notFound(`${t.label} introuvable.`);
  const generation = generationOf(db, type, id);
  const a = getRevision(db, type, id, aId, { generation });
  const b = bId === "current" ? { id: "current", data: t.load(db, id) } : getRevision(db, type, id, bId, { generation });
  if (!a || !b) throw notFound("Version introuvable.");
  const show = (data, key) => (key === "lineup" ? showValue(db, type, "lineup", data.lineup || []) : showValue(db, type, key, key === "photos" ? comparable("photos", data.photos) : data[key]));
  return {
    a: { id: a.id, version: a.version, createdAt: a.created_at },
    b: { id: b.id, version: b.version ?? b.data.version, createdAt: b.created_at ?? null },
    rows: changedKeys(a.data, b.data).map((key) => ({ key, label: key === "lineup" ? "Line-up" : key === "status" ? "Statut" : key === "publishAt" ? "Mise en ligne programmée" : t.fields[key]?.label || key, a: show(a.data, key), b: show(b.data, key) }))
  };
}

/**
 * Restaure le contenu d'une version (nouvelle version dans l'historique ; les versions intermédiaires
 * sont conservées). Le statut, la visibilité et l'adresse actuels sont conservés.
 */
export function restoreVersion(db, type, id, revisionId, user) {
  const t = target(type);
  if (!exists(db, type, id)) throw notFound(`${t.label} introuvable.`);
  const rev = getRevision(db, type, id, revisionId, { generation: generationOf(db, type, id) });
  if (!rev) throw notFound("Version introuvable.");
  return db.tx(() => {
    if (type === "event") return events.restoreRevision(db, id, rev.data, user, { origin: "restore" });
    const cur = t.load(db, id);
    const input = { ...t.toInput(rev.data), version: cur.version, slug: cur.slug };
    for (const key of ["published", "archived"]) if (key in cur) input[key] = cur[key];
    return t.save(db, id, input, { origin: "restore" }, user);
  });
}
