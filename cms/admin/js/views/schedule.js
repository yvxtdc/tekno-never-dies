/**
 * Programmations : toutes les modifications prévues à une date (contenu, opération, échéance, état,
 * dépendances, conflits), avec filtres et actions ; aperçu du site tel qu'il sera à une date donnée.
 */
import { h, replace } from "../lib/dom.js";
import { get, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, pagination, select, input, field } from "../lib/ui.js";
import { relative } from "../lib/format.js";
import { changeBadge, changeDialog, formatLocal, previewAtUrl, defaultRunAt } from "../lib/schedule.js";

const FILTERS = [
  ["pending", "À venir"], ["attention", "À traiter"], ["applied", "Appliquées, mise en ligne à faire"], ["published", "Envoyées"], ["cancelled", "Annulées"], ["", "Toutes"]
];
const TYPES = [["", "Tous les contenus"], ["event", "Soirées"], ["artist", "Artistes"], ["venue", "Lieux"], ["team", "Équipe"], ["faq", "FAQ"]];

export async function scheduleView(ctx, main) {
  document.title = "Programmations — Administration TND";
  // Adresse : ?status=… (absent : « À venir », « all » : toutes).
  const initial = ctx.query.get("status");
  const state = { status: initial === null ? "pending" : initial === "all" ? "" : initial, type: ctx.query.get("type") || "", page: 1 };
  const results = h("div", { "aria-live": "polite", style: { minWidth: 0 } });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filtrer par état" });
  const renderChips = (counts = {}) => {
    const n = (key) => (key === "attention" ? (counts.conflict || 0) + (counts.blocked || 0) + (counts.failed || 0) : counts[key] || 0);
    replace(chips, FILTERS.map(([value, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.status === value), onclick: () => { state.status = value; state.page = 1; load(); } },
      label, value && n(value) ? ` (${n(value)})` : "")));
  };
  const load = async () => {
    history.replaceState(null, "", `/admin/schedule${qs({ status: state.status === "pending" ? "" : state.status || "all", type: state.type })}`);
    replace(results, loadingState());
    try {
      const data = await get(`/api/schedule${qs({ status: state.status, type: state.type, page: state.page, pageSize: 50 })}`);
      renderChips(data.counts);
      if (!data.items.length) {
        return replace(results, emptyState("Aucune programmation", state.status === "pending" ? "Programmez une modification depuis une fiche (soirée, artiste, lieu, équipe, FAQ) : bouton « Programmer… »." : "Rien dans cette catégorie."));
      }
      replace(results,
        h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
          h("caption", { class: "sr-only" }, "Programmations"),
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Échéance"), h("th", { scope: "col" }, "Contenu"), h("th", { scope: "col" }, "Opération"), h("th", { scope: "col" }, "État"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
          h("tbody", {}, data.items.map((c) => h("tr", {},
            h("td", { "data-label": "Échéance", style: { minWidth: "130px" } }, h("strong", {}, formatLocal(c.runAtLocal)), h("div", { class: "small muted" }, `${relative(c.runAt)} · n° ${c.id}`)),
            h("td", { class: "title-col" }, h("div", { class: "small muted" }, c.entityTypeLabel), c.adminPath ? h("a", { href: c.adminPath }, c.entityName) : h("span", {}, `${c.entityName} (supprimé)`)),
            h("td", { "data-label": "Opération" }, c.summary,
              c.dependsOn.length ? h("div", { class: "small muted" }, `Après n° ${c.dependsOn.map((d) => d.id).join(", n° ")}`) : null),
            h("td", { "data-label": "État" }, changeBadge(c), c.result && c.status !== "pending" ? h("div", { class: "small muted", style: { maxWidth: "320px" } }, c.result) : null,
              c.status === "pending" && c.result ? h("div", { class: "small", style: { color: "var(--amber)" } }, c.result) : null),
            h("td", {}, h("button", { type: "button", class: "btn btn--sm", onclick: () => changeDialog(c.id, { onChanged: load }) }, c.status === "conflict" ? "Résoudre" : "Détails"))))))),
        pagination({ page: data.page, pageSize: data.pageSize, total: data.total, onChange: (p) => { state.page = p; load(); } }));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };
  const at = input({ type: "datetime-local", value: defaultRunAt(), step: 60 });
  const openPreview = h("a", { class: "btn btn--sm", target: "_blank", rel: "noopener", href: previewAtUrl(at.value) }, icon("eye"), "Voir le site à cette date");
  at.addEventListener("input", () => { openPreview.href = previewAtUrl(at.value) || "#"; });
  replace(main,
    pageHead({ title: "Programmations", subtitle: "Modifications prévues à une date : chacune ne change que les éléments visés, sur la version la plus récente du contenu, puis le site est mis en ligne automatiquement." }),
    h("div", { class: "split" },
      h("div", { class: "stack", style: { minWidth: 0 } },
        h("div", { class: "toolbar" }, chips, select(TYPES, { value: state.type, "aria-label": "Type de contenu", onchange: (e) => { state.type = e.target.value; state.page = 1; load(); } })),
        results),
      // Pas de colonne latérale « collante » : sur mobile, la liste reste avant l'aide.
      h("div", { class: "stack" },
        h("section", { class: "card" }, h("h2", {}, "Aperçu à une date"),
          h("p", { class: "small muted", style: { margin: "6px 0 10px" } }, "Le site tel qu'il sera, avec toutes les programmations prévues d'ici là. Rien n'est modifié ni exécuté."),
          field({ label: "Date et heure (heure de Paris)", control: at }),
          h("div", { class: "actions", style: { marginTop: "10px" } }, openPreview)),
        h("section", { class: "card" }, h("h2", {}, "États"),
          h("dl", { class: "small", style: { display: "grid", gap: "6px", margin: "10px 0 0" } },
            ...[
              ["Programmée", "en attente de son heure (ou d'une programmation dont elle dépend)."],
              ["Appliquée", "faite dans le CMS ; visible après la mise en ligne automatique qui suit."],
              ["Envoyée sur GitHub", "incluse dans une mise en ligne réussie et poussée. Le CMS ne vérifie pas le déploiement : GitHub Pages publie normalement en quelques minutes (onglet Actions du dépôt)."],
              ["Commitée / Fichiers générés", "mise en ligne réussie dans un mode qui n'envoie pas sur GitHub (développement) : rien n'est visible sur le site public."],
              ["Conflit", "un élément visé a été modifié entre-temps : rien n'est écrasé, choisissez la valeur à garder."],
              ["Bloquée", "une programmation dont elle dépend a échoué, est en conflit ou a été annulée."],
              ["Échec", "contenu supprimé ou devenu invalide : rien n'a été modifié."]
            ].flatMap(([term, text]) => [h("dt", { style: { fontWeight: 700 } }, term), h("dd", { class: "muted", style: { margin: "0 0 4px" } }, text)]))))));
  load();
}
