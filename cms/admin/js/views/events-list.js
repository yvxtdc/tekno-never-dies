/** Liste des soirées : recherche (titre, lieu, artiste), statut, période, tri, pagination. */
import { h, replace, debounce } from "../lib/dom.js";
import { get, qs } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { icon, pageHead, loadingState, errorState, emptyState, statusBadge, pagination, select } from "../lib/ui.js";
import { formatDate, relative } from "../lib/format.js";

const STATUS_FILTERS = [["active", "Toutes"], ["draft", "Brouillons"], ["scheduled", "Programmées"], ["published", "Publiées"], ["cancelled", "Annulées"], ["archived", "Archivées"]];

export async function eventsListView(ctx, main) {
  document.title = "Soirées — Administration TND";
  const state = {
    q: ctx.query.get("q") || "",
    status: ctx.query.get("status") || "active",
    period: ctx.query.get("period") || "",
    sort: ctx.query.get("sort") || "date_desc",
    page: Number(ctx.query.get("page")) || 1
  };
  const results = h("div", { "aria-live": "polite" });
  const syncUrl = () => history.replaceState(null, "", `/admin/events${qs({ ...state, status: state.status === "active" ? "" : state.status, sort: state.sort === "date_desc" ? "" : state.sort, page: state.page > 1 ? state.page : "" })}`);

  const load = async () => {
    syncUrl();
    replace(results, loadingState());
    try {
      const data = await get(`/api/events${qs({ ...state, pageSize: 20 })}`);
      if (!data.items.length) {
        return replace(results, emptyState(state.q || state.status !== "active" || state.period ? "Aucune soirée ne correspond" : "Aucune soirée pour l'instant",
          state.q ? "Essayez un autre mot (titre, lieu ou artiste)." : null,
          h("a", { class: "btn btn--primary", href: "/admin/events/new" }, icon("plus"), "Créer une soirée")));
      }
      replace(results,
        h("div", { class: "table-wrap" },
          h("table", { class: "table table--stack" },
            h("caption", { class: "sr-only" }, "Soirées"),
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Soirée"), h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Lieu"), h("th", { scope: "col" }, "Line-up"), h("th", { scope: "col" }, "Statut"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
            h("tbody", {}, data.items.map((ev) => h("tr", {},
              h("td", { class: "title-col" }, h("div", { class: "title-cell" },
                ev.thumbUrl ? h("img", { class: "thumb thumb--tall", src: ev.thumbUrl, alt: "", loading: "lazy" }) : h("span", { class: "thumb thumb--tall", "aria-hidden": "true" }),
                h("div", {}, h("a", { href: `/admin/events/${ev.id}` }, ev.title), h("div", { class: "small muted" }, `Modifiée ${relative(ev.updatedAt)}`)))),
              h("td", { "data-label": "Date" }, h("span", { class: "nowrap" }, formatDate(ev.date, { month: "short" })), ev.upcoming ? h("div", {}, h("span", { class: "pill" }, "À venir")) : null),
              h("td", { "data-label": "Lieu" }, ev.venue || h("span", { class: "muted" }, "—")),
              h("td", { "data-label": "Line-up" }, ev.lineupCount ? `${ev.lineupCount} passage${ev.lineupCount > 1 ? "s" : ""}` : h("span", { class: "muted" }, "vide")),
              h("td", {}, statusBadge(ev.status, ev.statusLabel), ev.status === "scheduled" && ev.publishAt ? h("div", { class: "small muted" }, `le ${new Date(ev.publishAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}`) : null),
              h("td", {}, h("div", { class: "actions", style: { justifyContent: "flex-end" } },
                h("a", { class: "btn btn--sm", href: `/admin/events/${ev.id}` }, "Modifier"),
                h("a", { class: "btn btn--sm btn--icon btn--ghost", href: `/preview/event-${ev.id}/evenement-${ev.slug}.html`, target: "_blank", rel: "noopener", "aria-label": `Aperçu de ${ev.title} (nouvel onglet)`, title: "Aperçu" }, icon("eye"))))))))),
        pagination({ page: data.page, pageSize: data.pageSize, total: data.total, onChange: (p) => { state.page = p; load(); } }));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };

  const search = h("input", { class: "input", type: "search", value: state.q, placeholder: "Rechercher une soirée, un lieu, un artiste…", "aria-label": "Rechercher une soirée", oninput: debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300) });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filtrer par statut" }, STATUS_FILTERS.map(([value, label]) =>
    h("button", { type: "button", class: "chip", "aria-pressed": String(state.status === value), onclick: (e) => {
      state.status = value;
      state.page = 1;
      e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      e.currentTarget.setAttribute("aria-pressed", "true");
      load();
    } }, label)));
  const period = select([["", "Toutes les dates"], ["upcoming", "À venir"], ["past", "Passées"]], { value: state.period, "aria-label": "Période", onchange: (e) => { state.period = e.target.value; state.page = 1; load(); } });
  const sort = select([["date_desc", "Date (récentes d'abord)"], ["date_asc", "Date (anciennes d'abord)"], ["updated", "Dernière modification"], ["title", "Nom (A → Z)"]], { value: state.sort, "aria-label": "Trier", onchange: (e) => { state.sort = e.target.value; load(); } });

  replace(main,
    pageHead({ title: "Soirées", subtitle: "Créez, préparez et publiez les soirées de l'association.", actions: [h("button", { type: "button", class: "btn btn--primary", onclick: () => navigate("/admin/events/new") }, icon("plus"), "Nouvelle soirée")] }),
    h("div", { class: "toolbar" }, h("div", { class: "search" }, icon("search"), search), period, sort),
    h("div", { class: "toolbar" }, chips),
    results);
  load();
}
