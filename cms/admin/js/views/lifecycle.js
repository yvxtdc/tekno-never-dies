/**
 * Suivi des soirées : préparation (avant) et clôture (après), pour prioriser ce qui reste à faire.
 * Liste filtrable ; chaque ligne mène à la fiche, à la section qui demande une action.
 */
import { h, replace } from "../lib/dom.js";
import { get, qs } from "../lib/api.js";
import { pageHead, loadingState, errorState, emptyState, statusBadge } from "../lib/ui.js";
import { formatDate, plural } from "../lib/format.js";
import { levelBadge } from "../lib/supervision.js";

const FILTERS = [["", "Toutes"], ["preparation", "En préparation"], ["late", "Tâches en retard"], ["errors", "Erreurs bloquantes"], ["closing", "Clôture à faire"], ["done", "Prêtes ou clôturées"]];

export async function lifecycleView(ctx, main) {
  document.title = "Suivi des soirées — Administration TND";
  const state = { filter: ctx.query.get("filter") || "" };
  const results = h("div", { "aria-live": "polite", style: { minWidth: 0 } });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filtrer" });
  const load = async () => {
    history.replaceState(null, "", `/admin/suivi${qs({ filter: state.filter })}`);
    replace(results, loadingState());
    try {
      const data = await get(`/api/lifecycle${qs({ filter: state.filter })}`);
      replace(chips, FILTERS.map(([value, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.filter === value), onclick: () => { state.filter = value; load(); } },
        label, value && data.counts[value] ? ` (${data.counts[value]})` : "")));
      if (!data.items.length) return replace(results, emptyState("Rien à afficher", state.filter ? "Aucune soirée dans cette catégorie." : "Aucune soirée à venir ou récente."));
      replace(results, h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
        h("caption", { class: "sr-only" }, "Soirées et tâches"),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Soirée"), h("th", { scope: "col" }, "Avancement"), h("th", { scope: "col" }, "Prochaine tâche"), h("th", { scope: "col" }, "Site public"))),
        h("tbody", {}, data.items.map((l) => h("tr", {},
          h("td", { class: "title-col" }, h("a", { href: `/admin/events/${l.event.id}#suivi` }, l.event.title), h("div", { class: "small muted" }, formatDate(l.event.date, { weekday: true }))),
          h("td", { "data-label": "Avancement" }, levelBadge(l.done === l.total ? "ok" : l.overdue || l.blocking ? "warning" : "info", l.phaseLabel),
            h("div", { class: "small muted" }, [`${l.done}/${l.total}`, l.overdue ? plural(l.overdue, "en retard", "en retard") : "", l.blocking ? plural(l.blocking, "erreur bloquante", "erreurs bloquantes") : ""].filter(Boolean).join(" · "))),
          h("td", { "data-label": "Prochaine tâche" }, l.next ? [h("a", { href: `/admin/events/${l.event.id}${l.next.section ? `#${l.next.section}` : "#suivi"}` }, l.next.label), h("div", { class: ["small", l.next.overdue ? "" : "muted"], style: l.next.overdue ? { color: "var(--amber)" } : {} }, `${l.next.overdue ? "En retard · " : ""}avant le ${formatDate(l.next.dueDate, { month: "short" })}`)] : h("span", { class: "muted" }, "—")),
          h("td", { "data-label": "Site public" }, l.deploy.done ? statusBadge("success", "À jour") : h("span", { class: "small muted" }, l.deploy.text))))))));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };
  replace(main,
    pageHead({ title: "Suivi des soirées", subtitle: "Préparation avant la soirée, clôture après : les tâches se valident d'elles-mêmes quand la fiche est complète ; seules les vérifications humaines se confirment à la main." }),
    h("div", { class: "toolbar" }, chips),
    results);
  load();
}
