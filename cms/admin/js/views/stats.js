/**
 * Statistiques : chiffres de GoatCounter (outil du site, sans cookie) lus par le serveur. Une donnée
 * indisponible est affichée « Indisponible » avec son motif, jamais 0 ; la comparaison n'apparaît que si
 * la période précédente était déjà comptée ; les jours antérieurs au début du comptage sont marqués
 * « pas encore compté », pas dessinés comme des jours sans visite.
 *
 * Ordre de lecture : période → chiffres clés et évolution → soirées → pages → provenance et autres clics.
 * Toutes les sections suivent la période choisie en haut de page.
 */
import { h, replace } from "../lib/dom.js";
import { get, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, input } from "../lib/ui.js";
import { formatDate, relative } from "../lib/format.js";

const PERIODS = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["custom", "Dates…"]];
const INTERACTIONS = [["Billetterie", "Billetterie"], ["Ajout à l'agenda", "Agenda"], ["Itinéraire", "Itinéraire"], ["Partage", "Partage"], ["DJ Contest", "DJ Contest"]];
const SECTIONS = [["frequentation", "Fréquentation"], ["soirees", "Soirées"], ["pages", "Pages"], ["provenance", "Provenance"]];
const nf = new Intl.NumberFormat("fr-FR");
const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const weekdayDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const plural = (n, one, many) => `${nf.format(n)} ${n > 1 ? many : one}`;

/** Chiffre ou « Indisponible » (jamais un zéro inventé). */
const num = (value) => (value === null || value === undefined ? h("span", { class: "muted" }, "Indisponible") : nf.format(value));

const unavailable = (reason) => h("p", { class: "stats-unavailable" }, h("strong", {}, "Indisponible"), reason ? ` : ${reason}` : ".");

/** Variation par rapport à la période précédente : flèche et signe, pas seulement une couleur. */
function delta(current, previous, days) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  let text, dir;
  if (previous === 0) [text, dir] = current ? ["nouveau", "up"] : ["=", "flat"];
  else {
    const pct = Math.round(((current - previous) / previous) * 100);
    [text, dir] = pct === 0 ? ["=", "flat"] : [`${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`, pct > 0 ? "up" : "down"];
  }
  return h("p", { class: "kpi__delta" },
    h("span", { class: `delta delta--${dir}` }, h("span", { "aria-hidden": "true" }, { up: "▲ ", down: "▼ ", flat: "" }[dir]), text),
    ` par rapport aux ${days} jours précédents (${nf.format(previous)})`);
}

/** Pas « rond » (1, 2, 5 × 10ⁿ) pour 3 ou 4 graduations. */
function niceStep(max) {
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

/**
 * Évolution jour par jour (une seule série, pas de légende) : graduations, dates, lecture exacte au
 * survol, au toucher ou au clavier (flèches), table de repli. Les jours avant `since` (début du comptage
 * GoatCounter) sont grisés « pas encore compté ».
 */
function trend(series, { since, today }) {
  const n = series.length;
  const counted = (d) => !since || d.day >= since;
  const max = Math.max(0, ...series.filter(counted).map((d) => d.count));
  const step = max ? niceStep(max) : 1;
  const top = max ? Math.ceil(max / step) * step : 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const peak = series.filter(counted).reduce((best, d) => (d.count > (best?.count ?? -1) ? d : best), null);
  const uncounted = since ? series.filter((d) => d.day < since).length : 0;

  const describe = (d) => {
    const when = `${formatDate(d.day, { weekday: true })}${d.day === today ? " (journée en cours)" : ""}`;
    return counted(d) ? [h("strong", {}, when), ` · ${plural(d.count, "visite", "visites")} de pages`] : [h("strong", {}, when), " · pas encore compté par GoatCounter"];
  };
  const readout = h("p", { class: "trend__readout", "aria-live": "polite" });
  const idle = () => replace(readout, peak && peak.count
    ? [h("span", { class: "muted" }, "Jour le plus fréquenté : "), h("strong", {}, formatDate(peak.day, { weekday: true })), ` · ${plural(peak.count, "visite", "visites")}`]
    : h("span", { class: "muted" }, "Aucune visite de page comptée sur la période."));

  const bars = series.map((d) => h("div", { class: `trend__col${counted(d) ? "" : " is-uncounted"}` },
    counted(d) && d.count ? h("div", { class: "trend__bar", style: { height: `max(2px, ${(d.count / top) * 100}%)` } }) : null));
  const plot = h("div", {
    class: `trend__plot${n > 45 ? " trend__plot--dense" : ""}`, tabindex: "0", role: "group",
    "aria-label": `Visites de pages par jour, du ${formatDate(series[0].day)} au ${formatDate(series.at(-1).day)}. Flèches gauche et droite pour lire chaque jour ; le détail est aussi dans la table « Voir les chiffres jour par jour ».`
  },
  ticks.map((t) => h("div", { class: "trend__grid", style: { bottom: `${(t / top) * 100}%` } })),
  uncounted ? h("div", { class: "trend__uncounted", style: { width: `${(uncounted / n) * 100}%` } }, uncounted / n > 0.18 ? h("span", {}, "Pas encore compté") : null) : null,
  h("div", { class: "trend__bars" }, bars));

  let active = -1;
  const select = (i) => {
    if (active >= 0) bars[active].classList.remove("is-active");
    active = i;
    if (i < 0) return idle();
    bars[i].classList.add("is-active");
    replace(readout, describe(series[i]));
  };
  const at = (event) => {
    const r = plot.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(((event.clientX - r.left) / r.width) * n)));
  };
  plot.addEventListener("pointermove", (e) => select(at(e)));
  plot.addEventListener("pointerdown", (e) => select(at(e)));
  plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") select(-1); });
  plot.addEventListener("blur", () => select(-1));
  plot.addEventListener("keydown", (e) => {
    const next = { ArrowLeft: Math.max(0, active - 1), ArrowRight: Math.min(n - 1, active < 0 ? n - 1 : active + 1), Home: 0, End: n - 1, Escape: -1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(e.key === "ArrowLeft" && active < 0 ? n - 1 : next);
  });

  // Dates sous l'axe : une sur `every` (environ 7 sur ordinateur) ; les intermédiaires disparaissent sur mobile.
  const every = n <= 8 ? 1 : Math.ceil(n / 7);
  const labels = series.map((d, i) => [d, i]).filter(([, i]) => (n - 1 - i) % every === 0);
  const xAxis = h("div", { class: "trend__x", "aria-hidden": "true" }, labels.map(([d, i], k) => h("span", {
    class: (labels.length - 1 - k) % 2 ? "is-minor" : "",
    style: { left: `${((i + 0.5) / n) * 100}%` }
  }, n <= 8 ? weekdayDay.format(utc(d.day)) : dayMonth.format(utc(d.day)))));
  const yAxis = h("div", { class: "trend__y", "aria-hidden": "true" }, ticks.map((t) => h("span", { style: { bottom: `${(t / top) * 100}%` } }, nf.format(t))));

  const table = h("details", { class: "stats-more" }, h("summary", {}, "Voir les chiffres jour par jour"),
    h("div", { class: "table-wrap" }, h("table", { class: "table table--compact" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Jour"), h("th", { scope: "col", class: "num" }, "Visites de pages"))),
      h("tbody", {}, [...series].reverse().map((d) => h("tr", {}, h("td", {}, formatDate(d.day, { weekday: true })), h("td", { class: "num" }, counted(d) ? nf.format(d.count) : h("span", { class: "muted" }, "pas encore compté"))))))));
  idle();
  return h("figure", { class: "trend" }, readout, h("div", { class: "trend__chart" }, yAxis, plot, xAxis), table);
}

/** Classement : libellé, sous-libellé, valeur alignée et barre proportionnelle à la première ligne. */
function rankList(items, { limit = 10, label = "Afficher" } = {}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const row = (item, i) => h("li", { class: "rank" },
    h("span", { class: "rank__pos", "aria-hidden": "true" }, String(i + 1)),
    h("span", { class: "rank__text" }, h("span", { class: `rank__label${item.dim ? " muted" : ""}` }, item.label, item.tag ? h("span", { class: "pill pill--soft" }, item.tag) : null),
      item.sub ? h("span", { class: "rank__sub" }, item.sub) : null),
    h("span", { class: "rank__count" }, nf.format(item.count)),
    h("span", { class: "rank__bar", "aria-hidden": "true" }, h("span", { style: { width: `${(item.count / max) * 100}%` } })));
  const list = h("ol", { class: "ranks" }, items.slice(0, limit).map(row));
  if (items.length <= limit) return list;
  const more = h("button", { type: "button", class: "link-btn small", onclick: () => { list.append(...items.slice(limit).map((it, k) => row(it, limit + k))); more.remove(); } }, `${label} les ${items.length - limit} suivantes`);
  return h("div", {}, list, h("p", { class: "ranks__more" }, more));
}

/** Titre de page sans le suffixe commun du site (« — Tekno Never Dies »), qui n'apporte rien au classement. */
const pageTitle = (title) => title.replace(/\s+[—–-]\s+Tekno Never Dies\s*$/, "").trim();

/** Tableau des soirées, triable par colonne ; sur mobile, une fiche par soirée. */
function eventsTable(events, { selected, from }) {
  const columns = [["views", "Visites de la fiche"], ...INTERACTIONS.map(([key, short]) => [key, short])];
  const value = (e, key) => (key === "views" ? e.views : e.interactions[key]);
  const maxViews = Math.max(1, ...events.map((e) => e.views));
  const sort = { key: "views", dir: -1 };
  const tbody = h("tbody");
  const heads = columns.map(([key, label]) => h("th", { scope: "col", class: "num" }, h("button", { type: "button", onclick: () => {
    sort.dir = sort.key === key ? -sort.dir : -1;
    sort.key = key;
    render();
  } }, label)));
  const cell = (n, label, extra = null) => h("td", { class: `num${n ? "" : " is-zero"}`, "data-label": label }, h("span", { class: "num__value" }, nf.format(n)), extra);
  const render = () => {
    heads.forEach((th, i) => th.setAttribute("aria-sort", columns[i][0] === sort.key ? (sort.dir < 0 ? "descending" : "ascending") : "none"));
    const rows = [...events].sort((a, b) => sort.dir * (value(a, sort.key) - value(b, sort.key)) || a.title.localeCompare(b.title, "fr"));
    replace(tbody, rows.map((e) => h("tr", { class: e.id === selected ? "is-selected" : "", id: `soiree-${e.id}` },
      h("th", { scope: "row", class: "stats-events__name" },
        h("a", { href: `/admin/events/${e.id}` }, e.title),
        h("span", { class: "stats-events__meta" }, [e.date ? formatDate(e.date, { month: "short" }) : null, `/${e.slug}`].filter(Boolean).join(" · ")),
        e.legacyClicks ? h("span", { class: "stats-events__note" }, `dont ${plural(e.legacyClicks, "clic enregistré", "clics enregistrés")} sous le titre (ancien format)`) : null,
        e.firstPublishedAt && e.firstPublishedAt.slice(0, 10) > from ? h("span", { class: "stats-events__note" }, `Publiée le ${formatDate(e.firstPublishedAt.slice(0, 10))} : pas de chiffres avant`) : null),
      cell(e.views, "Visites", h("span", { class: "minibar", "aria-hidden": "true" }, h("span", { style: { width: `${(e.views / maxViews) * 100}%` } }))),
      ...INTERACTIONS.map(([key, short]) => cell(e.interactions[key], short)))));
  };
  render();
  return h("div", { class: "table-wrap stats-events" }, h("table", { class: "table" },
    h("caption", { class: "sr-only" }, "Visites et clics par soirée ; les en-têtes de colonne permettent de trier."),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Soirée"), heads)), tbody));
}

const section = (id, title, intro, ...body) => h("section", { class: "card stats-section", id, "aria-labelledby": `${id}-title` },
  h("div", { class: "stats-section__head" }, h("h2", { id: `${id}-title` }, title), intro ? h("p", {}, intro) : null), ...body);

export async function statsView(ctx, main) {
  document.title = "Statistiques — Administration TND";
  const state = { period: ctx.query.get("period") || "30", start: ctx.query.get("start") || "", end: ctx.query.get("end") || "", event: Number(ctx.query.get("event")) || null };
  const results = h("div", { class: "stats-results", "aria-live": "polite" });
  const chips = h("div", { class: "chips", role: "group", "aria-labelledby": "stats-period-label" });
  const start = input({ type: "date", value: state.start, "aria-label": "Du" });
  const end = input({ type: "date", value: state.end, "aria-label": "Au" });
  const customError = h("p", { class: "small form-errors", hidden: true, role: "alert" });
  const custom = h("form", { class: "stats-custom", hidden: state.period !== "custom", onsubmit: (e) => {
    e.preventDefault();
    if (!start.value || !end.value || start.value > end.value) {
      customError.hidden = false;
      customError.textContent = "Indiquez une date de début antérieure ou égale à la date de fin.";
      return;
    }
    customError.hidden = true;
    state.start = start.value;
    state.end = end.value;
    load();
  } }, h("label", {}, h("span", {}, "Du"), start), h("label", {}, h("span", {}, "au"), end), h("button", { type: "submit", class: "btn btn--sm btn--primary" }, "Afficher"), customError);
  const meta = h("div", { class: "stats-toolbar__meta" });
  let last = null;
  const renderChips = () => replace(chips, PERIODS.map(([value, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.period === value), onclick: () => {
    state.period = value;
    custom.hidden = value !== "custom";
    renderChips();
    if (value !== "custom") return load();
    // Dates proposées : celles de la période affichée.
    if (!start.value && last?.range) start.value = last.range.from;
    if (!end.value && last?.range) end.value = last.range.to;
    start.focus();
  } }, label)));

  const load = async () => {
    history.replaceState(null, "", `/admin/stats${qs({ period: state.period, start: state.period === "custom" ? state.start : "", end: state.period === "custom" ? state.end : "", event: state.event || "" })}${location.hash}`);
    if (state.period === "custom" && !(state.start && state.end)) return;
    if (last) {
      results.classList.add("is-loading");
      results.setAttribute("aria-busy", "true");
      replace(meta, h("span", { class: "muted small" }, "Lecture de GoatCounter…"));
    } else replace(results, loadingState("Lecture des statistiques GoatCounter…"));
    let s;
    try {
      s = await get(`/api/stats${qs({ period: state.period, start: state.start, end: state.end })}`);
    } catch (error) {
      last = null;
      results.classList.remove("is-loading");
      results.removeAttribute("aria-busy");
      replace(meta);
      return replace(results, errorState(error, load));
    }
    last = s;
    results.classList.remove("is-loading");
    results.removeAttribute("aria-busy");
    render(s);
  };

  const render = (s) => {
    const providerLink = s.dashboardUrl ? h("a", { class: "btn btn--sm btn--ghost", href: s.dashboardUrl, target: "_blank", rel: "noopener noreferrer" }, icon("external", { size: 14 }), "GoatCounter") : null;
    replace(meta, s.fetchedAt ? h("span", { class: "small muted" }, `Lu ${relative(s.fetchedAt)}`) : null, providerLink);
    if (!s.configured) {
      return replace(results, h("section", { class: "card" }, h("h2", {}, "Statistiques non reliées"), h("p", { style: { margin: "8px 0" } }, s.reason), h("p", { class: "small muted" }, "Les visites restent comptées par GoatCounter ; un administrateur peut relier le CMS en créant un jeton d'API en lecture (voir docs/cms/statistiques.md).")));
    }
    const { range } = s;
    const prev = s.comparison.available ? s.comparison.previous : null;
    const today = parisToday();
    // Début du comptage dans la période : les jours d'avant ne sont pas des jours « à zéro ».
    const since = s.countingSince && s.countingSince > range.from ? s.countingSince : null;
    const selected = state.event && s.events ? s.events.find((e) => e.id === state.event) : null;
    const pagesTotal = s.totals?.pages ?? null;

    const kpis = h("div", { class: "kpis" },
      h("div", { class: "kpi kpi--main" }, h("p", { class: "kpi__label" }, "Visites de pages"), h("p", { class: "kpi__value" }, num(pagesTotal)),
        prev ? delta(pagesTotal, prev.pages, range.days) : null),
      h("div", { class: "kpi" }, h("p", { class: "kpi__label" }, "Clics suivis"), h("p", { class: "kpi__value" }, num(s.totals?.interactions ?? null)),
        prev ? delta(s.totals?.interactions ?? null, prev.interactions, range.days) : null,
        h("p", { class: "kpi__hint" }, "Billetterie, agenda, itinéraire, partage, réseaux…")));

    const unattributedTotal = (s.unattributed || []).reduce((sum, u) => sum + u.count, 0);
    const pageItems = (s.pages || []).map((p) => {
      const title = pageTitle(p.title || "");
      return { label: title || p.path, sub: title ? p.path : null, count: p.count, tag: p.eventId ? "Soirée" : null };
    });

    replace(results,
      s.stale ? h("p", { class: "form-errors" }, `GoatCounter ne répond pas (${s.staleReason}) : chiffres de la dernière lecture réussie, ${relative(s.fetchedAt)}.`) : null,
      h("nav", { class: "section-nav stats-nav", "aria-label": "Sections des statistiques" }, SECTIONS.map(([id, label]) => h("a", { href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, label))),

      section("frequentation", "Fréquentation", null,
        h("p", { class: "stats-range" }, h("strong", {}, `Du ${formatDate(range.from)} au ${formatDate(range.to)}`), ` · ${range.days} jours`,
          since ? h("span", { class: "muted" }, ` · comptage GoatCounter depuis le ${formatDate(since)}`) : null),
        kpis,
        s.errors.totals ? h("p", { class: "stats-unavailable" }, `Totaux non lus : ${s.errors.totals}`) : null,
        s.comparison.available ? null : h("p", { class: "small muted stats-note" }, s.comparison.reason),
        s.series ? trend(s.series, { since, today }) : unavailable(s.errors.hits),
        s.truncated ? h("p", { class: "small muted" }, "Plus de 500 pages ou clics différents sur la période : seuls les 500 premiers sont détaillés (les totaux restent exacts).") : null),

      section("soirees", "Soirées", "Visites de la fiche et clics mesurés sur la fiche. Une soirée absente n'a eu ni visite ni clic sur la période.",
        state.event && s.events && !selected ? h("p", { class: "small muted" }, "La soirée demandée n'a eu ni visite ni clic mesuré sur cette période (ou n'était pas encore publiée).") : null,
        s.events ? (s.events.length ? eventsTable(s.events, { selected: state.event, from: range.from }) : h("p", { class: "muted" }, "Aucune visite de fiche ni clic sur une soirée pendant cette période."))
          : unavailable(s.errors.hits),
        s.unattributed?.length ? h("details", { class: "stats-more" }, h("summary", {}, `${plural(unattributedTotal, "clic ou visite non attribué", "clics ou visites non attribués")} à une soirée`),
          h("ul", { class: "unattributed" }, s.unattributed.map((u) => h("li", {}, h("span", { class: "unattributed__name" }, u.name), h("span", { class: "unattributed__count" }, nf.format(u.count)), h("span", { class: "unattributed__reason" }, u.reason))))) : null,
        h("details", { class: "stats-more" }, h("summary", {}, "Comment les chiffres sont rattachés aux soirées"),
          h("p", { class: "small muted" }, "Les clics ne sont comptés que depuis leur mise en place sur le site. Ils sont rattachés à la soirée par son adresse : une soirée renommée garde ses statistiques. Les clics plus anciens, enregistrés sous le titre, ne sont rattachés que si une seule soirée porte ou a porté ce titre ; sinon ils restent « non attribués », jamais répartis au hasard."))),

      h("div", { class: "stats-pair" },
        section("pages", "Pages les plus consultées", "Visites par page sur la période.",
          s.pages ? (pageItems.length ? rankList(pageItems, { label: "Afficher" }) : h("p", { class: "muted" }, "Aucune page vue sur la période.")) : unavailable(s.errors.hits)),
        h("div", { class: "stats-side" },
          section("provenance", "Provenance des visites", "Sites d'où arrivent les visiteurs (référents).",
            s.refs ? (s.refs.length ? rankList(s.refs.map((r) => ({ label: r.name, count: r.count, dim: r.name.startsWith("(") }))) : h("p", { class: "muted" }, "Aucune donnée de provenance sur la période.")) : unavailable(s.errors.refs)),
          s.siteInteractions?.length ? section("autres-clics", "Autres clics suivis", "Clics hors soirées (équipe, réseaux, contact…).",
            rankList(s.siteInteractions.map((r) => ({ label: r.name, count: r.count })))) : null)));

    if (selected) requestAnimationFrame(() => document.getElementById(`soiree-${selected.id}`)?.scrollIntoView({ block: "center" }));
    else if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }));
  };

  replace(main,
    pageHead({ title: "Statistiques", subtitle: "Fréquentation du site et intérêt pour les soirées, d'après GoatCounter (comptage sans cookie)." }),
    h("div", { class: "stats-toolbar" },
      h("div", { class: "stats-toolbar__period" }, h("span", { id: "stats-period-label", class: "stats-toolbar__label" }, "Période"), chips),
      meta, custom),
    results);
  renderChips();
  load();
}
