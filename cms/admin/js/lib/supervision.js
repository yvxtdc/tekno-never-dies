/**
 * Éléments partagés de la supervision : niveaux (ok, info, warning, error, unknown), « Vérifier avant
 * publication », carte « Suivi de la soirée », état du déploiement. Données toujours lues dans l'API :
 * l'interface ne déduit rien elle-même.
 */
import { h, replace, append } from "./dom.js";
import { get, put } from "./api.js";
import { icon, dialog, toast, errorMessage, statusBadge, busy } from "./ui.js";
import { formatDate, relative, plural } from "./format.js";
import { can } from "./session.js";

/** Niveau -> style de badge existant et libellé. */
const LEVELS = {
  ok: ["success", "Normal"], info: ["scheduled", "En cours"], pending: ["scheduled", "En cours"], warning: ["running", "Avertissement"],
  error: ["failed", "Intervention nécessaire"], unknown: ["draft", "Inconnu"], na: ["draft", "Sans objet"], unverified: ["draft", "Non vérifiable"]
};
export const levelBadge = (level, label) => statusBadge(LEVELS[level]?.[0] || "draft", label || LEVELS[level]?.[1] || level);

/** Badge de l'état du déploiement d'une mise en ligne (vue renvoyée par l'API). */
export function deploymentBadge(d) {
  if (!d?.status) return null;
  return levelBadge(d.level, d.label);
}

/** Détail du déploiement : commit, dates, lien GitHub Actions, adresse du site. */
export function deploymentDetails(d) {
  if (!d?.status) return null;
  return h("div", { class: "small", style: { display: "grid", gap: "4px" } },
    h("div", { class: "row", style: { gap: "6px" } }, deploymentBadge(d), d.commit ? h("code", {}, d.commit.slice(0, 7)) : null),
    d.message ? h("span", { class: "muted" }, d.message) : null,
    h("span", { class: "muted" }, [d.sentAt ? `Envoyé ${relative(d.sentAt)}` : "", d.finishedAt ? `terminé ${relative(d.finishedAt)}` : "", d.checkedAt ? `vérifié ${relative(d.checkedAt)}` : ""].filter(Boolean).join(" · ")),
    h("span", { class: "row", style: { gap: "10px" } },
      d.runUrl ? h("a", { href: d.runUrl, target: "_blank", rel: "noopener noreferrer" }, icon("external", { size: 14 }), " Journal GitHub Actions") : null,
      d.siteUrl ? h("a", { href: d.siteUrl, target: "_blank", rel: "noopener noreferrer" }, icon("external", { size: 14 }), " Site publié") : null));
}

/** Va à une section de la fiche ouverte (ancre #billetterie…), en fermant le dialogue. */
const goToSection = (section, close) => {
  close?.();
  const target = section && document.getElementById(section);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
};

const GROUPS = [
  ["error", "Erreurs bloquantes", "Empêchent la publication : à corriger d'abord."],
  ["warning", "Avertissements", "À vérifier ; la publication reste possible."],
  ["unverified", "Contrôles impossibles depuis le CMS", "À vérifier à la main."],
  ["ok", "Vérifications réussies", ""],
  ["na", "Sans objet pour cette soirée", ""]
];

/** Liste groupée des contrôles d'un rapport. */
function reportBody(report, close) {
  const c = report.counts;
  return h("div", { class: "stack" },
    h("div", { class: "row", style: { gap: "8px" } },
      levelBadge(c.error ? "error" : c.warning ? "warning" : "ok", c.error ? plural(c.error, "erreur bloquante", "erreurs bloquantes") : c.warning ? "Publication possible" : "Prête à publier"),
      h("span", { class: "small muted" }, `${plural(c.ok, "vérification réussie", "vérifications réussies")}, ${plural(c.warning, "avertissement", "avertissements")}, ${plural(c.error, "erreur", "erreurs")}`)),
    ...GROUPS.map(([level, title, intro]) => {
      const items = report.items.filter((i) => i.level === level);
      if (!items.length) return null;
      const list = h("ul", { class: "checklist" }, items.map((i) => h("li", { class: level === "error" ? "is-error" : level === "ok" ? "is-ok" : "" },
        h("span", {}, h("strong", {}, i.label), i.message ? ` — ${i.message}` : "",
          i.section && document.getElementById(i.section) ? [" ", h("button", { type: "button", class: "link-btn small", onclick: () => goToSection(i.section, close) }, "Aller à la section")] : null))));
      const block = h("section", {}, h("h3", { style: { margin: "4px 0" } }, `${title} (${items.length})`), intro ? h("p", { class: "small muted" }, intro) : null, list);
      return level === "ok" || level === "na" ? h("details", {}, h("summary", { class: "small", style: { cursor: "pointer", fontWeight: 600 } }, `${title} (${items.length})`), list) : block;
    }),
    report.siteValidation ? h("p", { class: "small muted" }, `Contrôle complet du site : fait à chaque mise en ligne (dernier : ${report.siteValidation.ok ? "sans erreur" : `${report.siteValidation.errors} erreur(s)`}${report.siteValidation.warnings.length ? `, ${report.siteValidation.warnings.length} point(s) « à compléter » non bloquant(s)` : ""}, ${relative(report.siteValidation.at)}).`) : h("p", { class: "small muted" }, "Contrôle complet du site : fait à chaque mise en ligne."));
}

/**
 * « Vérifier avant publication ». Avec confirmLabel : sert de garde avant une publication ou une
 * programmation ; Promise<boolean> (false si erreur bloquante ou abandon ; avertissements : confirmation
 * explicite). Sans confirmLabel : simple consultation.
 */
export async function prepublicationDialog(eventId, { confirmLabel = null, isDirty = () => false } = {}) {
  let report;
  try {
    report = await get(`/api/events/${eventId}/check`);
  } catch (error) {
    toast(errorMessage(error), "error");
    return false;
  }
  // Aucun avertissement ni erreur : pas de dialogue supplémentaire avant l'action.
  if (confirmLabel && report.counts.error === 0 && report.counts.warning === 0) return true;
  return new Promise((resolve) => {
    let result = false;
    const actions = [h("button", { type: "button", class: "btn", onclick: () => d.close() }, confirmLabel ? "Annuler" : "Fermer")];
    if (confirmLabel && report.canPublish) {
      actions.push(h("button", { type: "button", class: "btn btn--primary", onclick: () => { result = true; d.close("ok"); } }, `${confirmLabel} malgré les avertissements`));
    }
    const d = dialog({
      title: "Vérification avant publication",
      wide: true,
      body: h("div", { class: "stack" },
        isDirty() ? h("p", { class: "form-errors" }, "Modifications non enregistrées : la vérification porte sur la version enregistrée.") : null,
        confirmLabel && !report.canPublish ? h("p", { class: "form-errors" }, "Publication impossible tant que les erreurs bloquantes ne sont pas corrigées.") : null,
        reportBody(report, () => d.close())),
      actions,
      onClose: () => resolve(result)
    });
  });
}

const STATE_ICON = { done: "✓", skipped: "–", todo: "•" };

/** Carte « Suivi de la soirée » : préparation ou clôture, déduite des données + confirmations. */
export function lifecycleCard(eventId, { onCheck } = {}) {
  const body = h("div", { class: "stack" }, h("p", { class: "muted small" }, "Chargement…"));
  // « form-section » : cible des liens …/events/<id>#suivi, comme les sections du formulaire.
  const card = h("section", { class: "card form-section", id: "suivi", "aria-labelledby": "suivi-t" });
  const render = (l) => {
    card.classList.toggle("card--warn", l.overdue > 0 || l.blocking > 0);
    const setTask = (task, state) => async (e) => busy(e.currentTarget, async () => {
      try {
        render(await put(`/api/events/${eventId}/tasks/${task.key}`, { state }));
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    });
    replace(body,
      h("div", { class: "row", style: { gap: "8px" } }, levelBadge(l.done === l.total ? "ok" : l.overdue ? "warning" : "info", l.phaseLabel), l.total ? h("span", { class: "small muted" }, `${l.done} / ${l.total} tâches`) : null),
      l.total ? h("div", { class: "progress", role: "progressbar", "aria-label": "Avancement", "aria-valuemin": "0", "aria-valuemax": String(l.total), "aria-valuenow": String(l.done) }, h("span", { style: { width: `${Math.round((l.done / l.total) * 100)}%` } })) : h("p", { class: "small muted" }, l.phase === "archived" ? "Soirée archivée : aucun suivi." : "Aucune tâche pour cette soirée."),
      l.total ? h("ul", { class: "tasklist" }, l.tasks.map((t) => h("li", { class: [`is-${t.state}`, t.overdue && "is-late"] },
        h("span", { class: "tasklist__mark", "aria-hidden": "true" }, STATE_ICON[t.state]),
        h("span", { class: "tasklist__body" },
          h("span", {}, t.label, h("span", { class: "sr-only" }, ` (${{ done: "fait", skipped: "non concerné", todo: "à faire" }[t.state]})`)),
          h("span", { class: "small muted" }, [
            t.state === "todo" ? `${t.overdue ? "En retard · " : ""}avant le ${formatDate(t.dueDate, { month: "short" })}` : t.state === "skipped" ? "Non concerné" : t.kind === "manual" && t.confirmedAt ? `Confirmé ${t.confirmedBy ? `par ${t.confirmedBy} ` : ""}${relative(t.confirmedAt)}` : "Fait (d'après la fiche)",
            t.progress, t.help && t.state === "todo" ? t.help : null
          ].filter(Boolean).join(" · ")),
          h("span", { class: "row", style: { gap: "8px" } },
            t.section && t.state === "todo" ? h("button", { type: "button", class: "link-btn small", onclick: () => goToSection(t.section) }, "Compléter") : null,
            t.key === "verification" && t.state === "todo" && onCheck ? h("button", { type: "button", class: "link-btn small", onclick: onCheck }, "Vérifier") : null,
            can("content.write") && t.kind === "manual" && t.state === "todo" ? h("button", { type: "button", class: "link-btn small", onclick: setTask(t, "done") }, "Marquer fait") : null,
            can("content.write") && t.skippable && t.state === "todo" ? h("button", { type: "button", class: "link-btn small", onclick: setTask(t, "skipped") }, "Non concerné") : null,
            can("content.write") && ((t.kind === "manual" && t.state === "done") || t.state === "skipped") ? h("button", { type: "button", class: "link-btn small", onclick: setTask(t, null) }, "Annuler") : null))))) : null);
  };
  append(card, [h("div", { class: "card__head" }, h("h2", { id: "suivi-t" }, "Suivi de la soirée"), h("p", {}, "Ce qui reste à faire, déduit de la fiche ; les confirmations sont nominatives.")), body,
    h("p", { class: "small", style: { marginTop: "8px" } }, h("a", { href: "/admin/suivi" }, "Toutes les soirées →"))]);
  get(`/api/events/${eventId}/lifecycle`).then(render).catch((error) => replace(body, h("p", { class: "error-text" }, errorMessage(error))));
  card.reload = () => get(`/api/events/${eventId}/lifecycle`).then(render).catch(() => {});
  return card;
}
