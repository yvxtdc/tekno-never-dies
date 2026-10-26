/**
 * Statistiques : chiffres de GoatCounter (outil du site, sans cookie) lus par le serveur. Une donnée
 * indisponible est affichée « Indisponible » avec son motif, jamais 0 ; la comparaison n'apparaît que si
 * la période précédente était déjà comptée.
 */
import { h, replace } from "../lib/dom.js";
import { get, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, input, field } from "../lib/ui.js";
import { formatDate, relative } from "../lib/format.js";

const PERIODS = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["custom", "Période choisie"]];
const nf = new Intl.NumberFormat("fr-FR");

/** Chiffre ou « Indisponible » (jamais un zéro inventé). */
const num = (value) => (value === null || value === undefined ? h("span", { class: "muted" }, "Indisponible") : nf.format(value));

function evolution(current, previous) {
  if (!previous) return null;
  if (previous === 0) return current ? "nouveau" : "=";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct} %`;
}

/** Barres des visites par jour (une seule série : pas de légende) ; survol et table pour le détail. */
function dailyChart(series) {
  const W = 720, H = 180, pad = 24;
  const max = Math.max(1, ...series.map((d) => d.count));
  const gap = 2;
  const bw = Math.max(2, (W - pad) / series.length - gap);
  const caption = h("p", { class: "small muted", "aria-live": "polite", style: { minHeight: "1.4em", margin: "0 0 4px" } }, "Survolez une barre pour le détail.");
  const ns = "http://www.w3.org/2000/svg";
  const chart = document.createElementNS(ns, "svg");
  chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
  chart.setAttribute("class", "bar-chart");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `Visites des pages par jour, du ${formatDate(series[0].day)} au ${formatDate(series.at(-1).day)} ; maximum ${nf.format(max)}.`);
  const grid = document.createElementNS(ns, "line");
  Object.entries({ x1: pad, x2: W, y1: H - 16, y2: H - 16, class: "bar-chart__axis" }).forEach(([k, v]) => grid.setAttribute(k, v));
  chart.append(grid);
  const label = document.createElementNS(ns, "text");
  Object.entries({ x: 0, y: 12, class: "bar-chart__label" }).forEach(([k, v]) => label.setAttribute(k, v));
  label.textContent = nf.format(max);
  chart.append(label);
  series.forEach((d, i) => {
    const bh = d.count ? Math.max(3, ((H - 34) * d.count) / max) : 0;
    const x = pad + i * (bw + gap);
    // Zone de survol sur toute la hauteur (plus grande que la barre).
    const hit = document.createElementNS(ns, "rect");
    Object.entries({ x, y: 0, width: bw + gap, height: H - 16, class: "bar-chart__hit" }).forEach(([k, v]) => hit.setAttribute(k, v));
    const bar = document.createElementNS(ns, "rect");
    Object.entries({ x, y: H - 16 - bh, width: bw, height: bh, rx: Math.min(4, bw / 2), class: "bar-chart__bar" }).forEach(([k, v]) => bar.setAttribute(k, v));
    const show = () => { caption.textContent = `${formatDate(d.day, { weekday: true })} : ${nf.format(d.count)} visite(s) de pages`; bar.classList.add("is-active"); };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", () => bar.classList.remove("is-active"));
    chart.append(bar, hit);
  });
  const table = h("details", {}, h("summary", { class: "small", style: { cursor: "pointer" } }, "Voir les chiffres jour par jour"),
    h("div", { class: "table-wrap", style: { marginTop: "8px" } }, h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Jour"), h("th", { scope: "col" }, "Visites"))),
      h("tbody", {}, series.map((d) => h("tr", {}, h("td", {}, formatDate(d.day, { weekday: true })), h("td", {}, nf.format(d.count))))))));
  return h("div", {}, caption, h("div", { class: "bar-chart-wrap" }, chart), table);
}

const unavailable = (reason) => h("p", { class: "muted small" }, `Indisponible${reason ? ` : ${reason}` : "."}`);

export async function statsView(ctx, main) {
  document.title = "Statistiques — Administration TND";
  const state = { period: ctx.query.get("period") || "30", start: ctx.query.get("start") || "", end: ctx.query.get("end") || "", event: Number(ctx.query.get("event")) || null };
  const results = h("div", { class: "stack", "aria-live": "polite" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Période" });
  const start = input({ type: "date", value: state.start });
  const end = input({ type: "date", value: state.end });
  const custom = h("div", { class: "row", hidden: state.period !== "custom" }, field({ label: "Du", control: start }), field({ label: "Au", control: end }),
    h("button", { type: "button", class: "btn btn--sm", style: { alignSelf: "end" }, onclick: () => { state.start = start.value; state.end = end.value; load(); } }, "Afficher"));
  const renderChips = () => replace(chips, PERIODS.map(([value, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.period === value), onclick: () => {
    state.period = value;
    custom.hidden = value !== "custom";
    renderChips();
    if (value !== "custom") load();
  } }, label)));
  const load = async () => {
    history.replaceState(null, "", `/admin/stats${qs({ period: state.period, start: state.period === "custom" ? state.start : "", end: state.period === "custom" ? state.end : "", event: state.event || "" })}`);
    if (state.period === "custom" && !(state.start && state.end)) return replace(results, h("p", { class: "muted" }, "Choisissez les dates de début et de fin."));
    replace(results, loadingState("Lecture des statistiques GoatCounter…"));
    let s;
    try {
      s = await get(`/api/stats${qs({ period: state.period, start: state.start, end: state.end })}`);
    } catch (error) {
      return replace(results, errorState(error, load));
    }
    const providerLink = s.dashboardUrl ? h("a", { href: s.dashboardUrl, target: "_blank", rel: "noopener noreferrer" }, icon("external", { size: 14 }), " Tableau de bord GoatCounter") : null;
    if (!s.configured) {
      return replace(results, h("section", { class: "card" }, h("h2", {}, "Statistiques non reliées"), h("p", { style: { margin: "8px 0" } }, s.reason), h("p", { class: "small muted" }, "Les visites restent comptées par GoatCounter ; un administrateur peut relier le CMS en créant un jeton d'API en lecture (voir docs/cms/statistiques.md)."), providerLink));
    }
    const period = `du ${formatDate(s.range.from)} au ${formatDate(s.range.to)} (${s.range.days} jours)`;
    const prev = s.comparison.available ? s.comparison.previous : null;
    const tile = (label, value, before, hint) => h("div", { class: "stat" },
      h("div", { class: "stat__value" }, num(value)), h("div", { class: "stat__label" }, label),
      value !== null && before !== undefined && before !== null ? h("div", { class: "small muted" }, `${evolution(value, before)} par rapport à la période précédente (${nf.format(before)})`) : null,
      hint ? h("div", { class: "small muted" }, hint) : null);
    const selected = state.event && s.events ? s.events.find((e) => e.id === state.event) : null;
    replace(results,
      s.stale ? h("p", { class: "form-errors" }, `GoatCounter ne répond pas (${s.staleReason}) : chiffres de la dernière lecture réussie, ${relative(s.fetchedAt)}.`) : null,
      h("p", { class: "small muted" }, `Période ${period}. Source : GoatCounter (comptage sans cookie, selon ses propres règles), lu ${relative(s.fetchedAt)}. `, providerLink),
      h("div", { class: "grid grid--stats" },
        tile("visites des pages", s.totals?.pages ?? null, prev?.pages, s.errors.totals),
        tile("interactions suivies (billetterie, agenda, itinéraire, partage…)", s.totals?.interactions ?? null, prev?.interactions)),
      s.comparison.available ? null : h("p", { class: "small muted" }, s.comparison.reason),
      h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Visites des pages par jour")), s.series ? dailyChart(s.series) : unavailable(s.errors.hits),
        s.truncated ? h("p", { class: "small muted" }, "Plus de 500 pages ou interactions sur la période : seules les 500 premières sont détaillées.") : null),
      h("section", { class: "card", id: "soirees" }, h("div", { class: "card__head" }, h("h2", {}, "Soirées"), h("p", {}, "Visites de la fiche et clics mesurés sur la fiche. Une soirée sans ligne n'a eu ni visite ni clic sur la période.")),
        selected ? h("p", { class: "small" }, "Soirée demandée : ", h("strong", {}, selected.title)) : null,
        state.event && s.events && !selected ? h("p", { class: "small muted" }, "La soirée demandée n'a eu ni visite ni clic mesuré sur cette période (ou n'était pas encore publiée).") : null,
        s.events ? (s.events.length ? h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Soirée"), h("th", { scope: "col" }, "Visites"), h("th", { scope: "col" }, "Billetterie"), h("th", { scope: "col" }, "Agenda"), h("th", { scope: "col" }, "Itinéraire"), h("th", { scope: "col" }, "Partage"), h("th", { scope: "col" }, "DJ Contest"))),
          h("tbody", {}, s.events.map((e) => h("tr", { class: e.id === state.event ? "is-selected" : "" },
            h("td", { class: "title-col" }, h("a", { href: `/admin/events/${e.id}` }, e.title), e.legacyClicks ? h("div", { class: "small muted" }, `dont ${nf.format(e.legacyClicks)} clic(s) enregistré(s) sous le titre (ancien format)`) : null, e.firstPublishedAt && e.firstPublishedAt.slice(0, 10) > s.range.from ? h("div", { class: "small muted" }, `Publiée le ${formatDate(e.firstPublishedAt.slice(0, 10))} : pas de chiffres avant cette date`) : null),
            h("td", { "data-label": "Visites" }, nf.format(e.views)),
            ...["Billetterie", "Ajout à l'agenda", "Itinéraire", "Partage", "DJ Contest"].map((k) => h("td", { "data-label": k }, nf.format(e.interactions[k]))))))))
          : h("p", { class: "muted" }, "Aucune visite de fiche ni clic sur une soirée pendant cette période.")) : unavailable(s.errors.hits),
        s.unattributed?.length ? h("details", { style: { marginTop: "8px" } }, h("summary", { class: "small", style: { cursor: "pointer" } }, `${s.unattributed.length} interaction(s) non attribuée(s) à une soirée`),
          h("ul", { class: "small" }, s.unattributed.map((u) => h("li", {}, `${u.name} : ${nf.format(u.count)} (${u.reason})`)))) : null,
        h("p", { class: "small muted", style: { marginTop: "8px" } }, "Les clics ne sont comptés que depuis leur mise en place sur le site. Ils sont rattachés à la soirée par son adresse (une soirée renommée garde ses statistiques) ; les clics plus anciens, enregistrés sous le titre, ne sont rattachés que si une seule soirée porte ou a porté ce titre.")),
      h("div", { class: "grid grid--2" },
        h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Pages les plus consultées")),
          s.pages ? h("ol", { class: "rank-list" }, s.pages.slice(0, 10).map((p) => h("li", {}, h("span", {}, p.title || p.path, h("span", { class: "small muted" }, ` ${p.path}`)), h("strong", {}, nf.format(p.count))))) : unavailable(s.errors.hits)),
        h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Provenance des visites")),
          s.refs ? (s.refs.length ? h("ol", { class: "rank-list" }, s.refs.map((r) => h("li", {}, h("span", {}, r.name), h("strong", {}, nf.format(r.count))))) : h("p", { class: "muted" }, "Aucune donnée de provenance sur la période.")) : unavailable(s.errors.refs),
          s.siteInteractions?.length ? [h("h3", { style: { margin: "14px 0 6px" } }, "Autres clics suivis"), h("ol", { class: "rank-list" }, s.siteInteractions.map((r) => h("li", {}, h("span", {}, r.name), h("strong", {}, nf.format(r.count)))))] : null)));
  };
  replace(main,
    pageHead({ title: "Statistiques", subtitle: "Fréquentation du site et intérêt pour les soirées, d'après GoatCounter." }),
    h("div", { class: "toolbar" }, chips), custom,
    results);
  renderChips();
  load();
}
