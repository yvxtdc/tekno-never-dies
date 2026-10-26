/**
 * Suivi des soirées : préparation (avant) et clôture (après), en complément des statuts (inchangés).
 *
 * Une tâche est :
 *  - « auto » : son état est déduit des données à chaque lecture (jamais de copie qui vieillirait) ;
 *  - « manual » : une personne la confirme ; seules ces confirmations sont enregistrées (event_tasks),
 *    avec la date et l'auteur, pour CETTE soirée (identifiant + génération : une soirée dupliquée ou
 *    recréée repart sans confirmation).
 * Une tâche « skippable » peut être marquée « Non concerné » (soirée gratuite, pas d'album…).
 * Échéances : relatives à la date de la soirée (heure de Paris), recalculées si la date change.
 * Aucun changement de statut automatique : passer la date fait seulement apparaître la clôture.
 */
import { getEvent, eventCheckItems, PUBLIC_STATUSES } from "./events.mjs";
import { blockingProblems } from "./event-checklist.mjs";
import { deploymentView } from "../publish/deploy-tracker.mjs";
import { parisToday } from "./timeutil.mjs";
import { notFound, badRequest, conflict } from "../http/errors.mjs";
import { now } from "../db/index.mjs";

const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * Tâches : phase (before / after), section de la fiche, échéance (jours par rapport à la date),
 * applies(ctx) : pertinente pour cette soirée ? done(ctx) : true / false (auto) ; manual : confirmation.
 */
const TASKS = [
  // ---------- Avant la soirée ----------
  { key: "infos", phase: "before", section: "essentiel", due: -30, label: "Informations principales (nom, date exacte, résumé)",
    done: ({ ev }) => Boolean(ev.title && ev.datePrecision === "day" && ev.description) },
  { key: "horaires-lieu", phase: "before", section: "horaires", due: -21, label: "Horaires et lieu (avec coordonnées pour le plan)",
    done: ({ ev }) => Boolean(ev.startTime && ev.venue && ev.venue.lat != null) },
  { key: "visuels", phase: "before", section: "visuels", due: -21, label: "Affiche et visuels (avec texte alternatif)",
    done: ({ ev }) => Boolean((ev.flyer || ev.cover) && (ev.flyer || ev.cover).alt) },
  { key: "billetterie", phase: "before", section: "billetterie", due: -21, skippable: true, label: "Tarifs et lien de billetterie",
    help: "« Non concerné » pour une soirée gratuite sans réservation.",
    applies: ({ ev }) => ev.status !== "cancelled",
    done: ({ ev }) => Boolean(ev.ticketUrl && (!ev.tickets.some((t) => !t.door) || ev.tickets.some((t) => !t.door && t.status === "available"))) },
  { key: "lineup", phase: "before", section: "lineup", due: -14, label: "Line-up saisi et cohérent (horaires, chevauchements)",
    applies: ({ ev }) => ev.status !== "cancelled",
    done: ({ ev, items }) => ev.lineup.length > 0 && !items.some((i) => i.section === "lineup" && i.level !== "ok") },
  { key: "lineup-confirme", phase: "before", section: "lineup", due: -14, manual: true, label: "Line-up confirmé avec les artistes",
    applies: ({ ev }) => ev.status !== "cancelled" },
  { key: "contest", phase: "before", section: "contest", due: -14, label: "DJ Contest : date limite et adresse",
    applies: ({ ev }) => ev.status !== "cancelled" && ev.lineup.some((s) => s.artists.some((a) => a.mystery)),
    done: ({ ev }) => Boolean(ev.contest?.deadline && ev.contest.deadline <= ev.date) },
  { key: "pratique", phase: "before", section: "pratique", due: -7, manual: true, label: "Infos pratiques relues",
    applies: ({ ev }) => ev.status !== "cancelled",
    blockedBy: ({ ev }) => (ev.practical.length ? null : "Aucune info pratique saisie.") },
  { key: "traductions", phase: "before", section: "traductions", due: -7, skippable: true, label: "Traductions allemande et anglaise",
    done: ({ items }) => !items.some((i) => i.id === "translations" && i.level !== "ok") },
  { key: "verification", phase: "before", section: "", due: -7, label: "Vérification avant publication sans erreur bloquante",
    done: ({ blocking }) => blocking.length === 0 },
  { key: "publication", phase: "before", section: "", due: -21, label: "Soirée publiée dans le CMS",
    applies: ({ ev }) => ev.status !== "cancelled",
    done: ({ ev }) => ev.status === "published",
    progress: ({ ev }) => (ev.status === "scheduled" ? "Mise en ligne programmée." : null) },
  { key: "annulation", phase: "before", section: "", due: 0, label: "Annulation affichée sur le site (statut « Annulé »)",
    applies: ({ ev }) => ev.status === "cancelled", done: ({ ev }) => ev.status === "cancelled" },
  { key: "annulation-communiquee", phase: "before", section: "", due: 0, manual: true, label: "Annulation communiquée (réseaux, billetterie, remboursements)",
    applies: ({ ev }) => ev.status === "cancelled" },
  { key: "deploiement", phase: "before", section: "", due: -21, label: "Dernières modifications en ligne sur le site public (déploiement vérifié)",
    applies: ({ ev }) => PUBLIC_STATUSES.includes(ev.status),
    done: ({ deploy }) => deploy.done, progress: ({ deploy }) => deploy.text },
  // ---------- Après la soirée ----------
  { key: "photos", phase: "after", section: "soiree", due: 14, skippable: true, label: "Photos de la soirée (section « La soirée »)",
    applies: ({ ev }) => ev.status !== "cancelled", done: ({ ev }) => ev.photos.length > 0 },
  { key: "album", phase: "after", section: "soiree", due: 21, skippable: true, label: "Album de la galerie publié et lié",
    applies: ({ ev }) => ev.status !== "cancelled", done: ({ ev }) => Boolean(ev.gallery?.published) },
  { key: "participants", phase: "after", section: "pratique", due: 14, skippable: true, label: "Nombre de participants (infos pratiques, ex. « 250 participant·es »)",
    help: "Saisi par l'équipe ; « Non concerné » si l'association ne souhaite pas le communiquer.",
    applies: ({ ev }) => ev.status !== "cancelled", done: ({ ev }) => ev.practical.some((p) => /\d[\d\s.]*\s*participant/i.test(p)) },
  { key: "contest-resultat", phase: "after", section: "lineup", due: 7, label: "Gagnant du DJ Contest au line-up (à la place de l'artiste mystère)",
    applies: ({ ev }) => ev.status !== "cancelled" && Boolean(ev.contest?.deadline || ev.lineup.some((s) => s.artists.some((a) => a.mystery))),
    done: ({ ev }) => !ev.lineup.some((s) => s.artists.some((a) => a.mystery)) },
  { key: "visuels-archive", phase: "after", section: "visuels", due: 14, manual: true, label: "Visuels de l'archive vérifiés (affiche définitive, photo de fond)",
    applies: ({ ev }) => ev.status !== "cancelled" },
  { key: "relecture-archive", phase: "after", section: "essentiel", due: 30, manual: true, label: "Archive relue : soirée clôturée" }
];

export const TASK_KEYS = new Set(TASKS.map((t) => t.key));

/** État du déploiement des dernières modifications de la soirée (même source que la page Mise en ligne). */
function deployState(db, ev) {
  const pub = db.get("SELECT * FROM publications WHERE status = 'success' AND started_at >= ? ORDER BY id DESC LIMIT 1", ev.updatedAt);
  if (!pub) return { done: false, text: "Modifications pas encore mises en ligne." };
  const view = deploymentView(pub);
  if (["success", "superseded"].includes(view.status)) return { done: true, text: view.label, publicationId: pub.id };
  return { done: false, text: `${view.label}${view.message ? ` — ${view.message}` : ""}`, publicationId: pub.id, level: view.level };
}

/** Phase de la soirée : préparation, prête, clôture à faire, clôturée, annulée, archivée, brouillon passé. */
function phaseOf(ev, today) {
  if (ev.status === "archived") return "archived";
  const past = ev.date < today;
  if (past && !PUBLIC_STATUSES.includes(ev.status)) return "unpublished-past";
  if (ev.status === "cancelled") return "cancelled";
  return past ? "after" : "before";
}

/** Checklist d'une soirée. light : sans le contrôle des fichiers (vue d'ensemble). */
export function eventLifecycle(db, config, id, { today = parisToday() } = {}) {
  const ev = getEvent(db, id, { withChecks: false });
  const generation = db.get("SELECT generation FROM events WHERE id = ?", id).generation;
  const phase = phaseOf(ev, today);
  const manualRows = new Map(db.all(
    "SELECT t.task_key, t.state, t.note, t.updated_at, u.name AS user_name FROM event_tasks t LEFT JOIN users u ON u.id = t.user_id WHERE t.event_id = ? AND t.event_generation = ?",
    id, generation
  ).map((r) => [r.task_key, r]));
  const ctx = { ev, items: eventCheckItems(db, ev), blocking: blockingProblems(db, config, id), deploy: deployState(db, ev) };
  // Avant la date : préparation ; après : clôture seulement (la préparation n'a plus d'objet) ; annulée :
  // les tâches d'annulation ; archivée ou jamais publiée : aucune tâche.
  const phases = phase === "before" || phase === "cancelled" ? ["before"] : phase === "after" ? ["after"] : [];
  const tasks = TASKS.filter((t) => phases.includes(t.phase) && (!t.applies || t.applies(ctx))).map((t) => {
    const row = manualRows.get(t.key);
    const auto = t.manual ? null : t.done(ctx);
    const blocked = t.blockedBy?.(ctx) || null;
    let state = row?.state === "skipped" ? "skipped" : t.manual ? (row?.state === "done" && !blocked ? "done" : "todo") : auto ? "done" : "todo";
    const dueDate = addDays(ev.date, t.due);
    const progress = state === "todo" ? (blocked || t.progress?.(ctx) || null) : null;
    return {
      key: t.key, phase: t.phase, label: t.label, section: t.section, kind: t.manual ? "manual" : "auto", skippable: Boolean(t.skippable), help: t.help || null,
      state, dueDate, overdue: state === "todo" && dueDate < today, progress,
      confirmedAt: row?.updated_at ?? null, confirmedBy: row?.user_name ?? null
    };
  });
  const open = tasks.filter((t) => t.state === "todo");
  const done = tasks.length - open.length;
  const label = {
    before: open.length ? "En préparation" : "Prête", after: open.length ? "Clôture à faire" : "Clôturée", cancelled: open.length ? "Annulée, suivi à terminer" : "Annulée",
    archived: "Archivée", "unpublished-past": "Passée, jamais publiée"
  }[phase];
  return {
    event: { id: ev.id, title: ev.title, date: ev.date, status: ev.status, slug: ev.slug },
    phase, phaseLabel: label, tasks, done, total: tasks.length,
    overdue: open.filter((t) => t.overdue).length,
    next: open.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null,
    blocking: ctx.blocking.length, deploy: ctx.deploy
  };
}

/** Confirmation manuelle (done), « non concerné » (skipped) ou annulation (null) d'une tâche. */
export function setTask(db, id, key, state, user, note = "") {
  const task = TASKS.find((t) => t.key === key);
  if (!task) throw notFound("Tâche inconnue.");
  const row = db.get("SELECT generation FROM events WHERE id = ?", id);
  if (!row) throw notFound("Événement introuvable.");
  if (state !== null && !["done", "skipped"].includes(state)) throw badRequest("État de tâche invalide.");
  // Une tâche déduite des données ne se coche pas à la main : seule « non concerné » est possible.
  if (state === "done" && !task.manual) throw conflict("Cette tâche se valide d'elle-même quand les informations sont renseignées.");
  if (state === "skipped" && !task.skippable) throw conflict("Cette tâche ne peut pas être marquée « non concerné ».");
  if (state === null) db.run("DELETE FROM event_tasks WHERE event_id = ? AND event_generation = ? AND task_key = ?", id, row.generation, key);
  else {
    db.run(
      `INSERT INTO event_tasks (event_id, event_generation, task_key, state, note, user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id, event_generation, task_key) DO UPDATE SET state = excluded.state, note = excluded.note, user_id = excluded.user_id, updated_at = excluded.updated_at`,
      id, row.generation, key, state, String(note).slice(0, 300), user?.id ?? null, now()
    );
  }
}

/**
 * Vue d'ensemble : soirées non archivées à venir ou passées depuis moins de 120 jours.
 * filter : preparation, late (tâches en retard), errors (erreurs bloquantes), closing (clôture à faire),
 * done (prêtes ou clôturées) ; vide : toutes.
 */
export function lifecycleOverview(db, config, { filter = "", today = parisToday() } = {}) {
  const rows = db.all("SELECT id FROM events WHERE status <> 'archived' AND date >= ? ORDER BY date ASC", addDays(today, -120));
  const all = rows.map((r) => eventLifecycle(db, config, r.id, { today })).filter((l) => l.phase !== "unpublished-past");
  const matches = {
    preparation: (l) => l.phase === "before" && l.done < l.total,
    late: (l) => l.overdue > 0,
    errors: (l) => l.blocking > 0 && l.phase === "before",
    closing: (l) => l.phase === "after" && l.done < l.total,
    done: (l) => l.done === l.total
  };
  const counts = Object.fromEntries(Object.entries(matches).map(([k, fn]) => [k, all.filter(fn).length]));
  const items = (matches[filter] ? all.filter(matches[filter]) : all).map(({ tasks, ...rest }) => rest);
  return { items, counts, today };
}
