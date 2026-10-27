/**
 * Statistiques : chiffres de GoatCounter (outil du site, sans cookie) lus par le serveur. Une donnée
 * indisponible est affichée « Indisponible » avec son motif, jamais 0 ; la comparaison n'apparaît que si
 * la période précédente était déjà comptée ; les jours antérieurs au début du comptage sont marqués
 * « pas encore compté », pas dessinés comme des jours sans visite.
 *
 * Ordre de lecture : période → chiffres clés et évolution → soirées → pages et provenance → moments des
 * visites → visiteurs (appareils, systèmes, pays…). Toutes les sections suivent la période choisie en haut
 * de page ; « Nombres / Parts » change l'affichage des classements, jamais les chiffres.
 */
import { h, replace } from "../lib/dom.js";
import { get, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, input } from "../lib/ui.js";
import { formatDate, relative } from "../lib/format.js";

const PERIODS = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["custom", "Dates…"]];
const MODES = [["count", "Nombres"], ["share", "Parts (%)"]];
const INTERACTIONS = [["Billetterie", "Billetterie"], ["Ajout à l'agenda", "Agenda"], ["Itinéraire", "Itinéraire"], ["Partage", "Partage"], ["DJ Contest", "DJ Contest"]];
const SECTIONS = [["frequentation", "Fréquentation"], ["soirees", "Soirées"], ["pages", "Pages"], ["provenance", "Provenance"], ["moments", "Moments"], ["visiteurs", "Visiteurs"]];
const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const nf = new Intl.NumberFormat("fr-FR");
const avg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const weekdayDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const plural = (n, one, many) => `${nf.format(n)} ${n > 1 ? many : one}`;
/** Part : une décimale sous 10 %, entier au-delà (« 0,3 % », « 4,5 % », « 32 % »). */
const pct = (n, base) => new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: n / base < 0.1 ? 1 : 0 }).format(n / base);
const regions = (() => { try { return new Intl.DisplayNames(["fr"], { type: "region" }); } catch { return null; } })();
const languages = (() => { try { return new Intl.DisplayNames(["fr"], { type: "language" }); } catch { return null; } })();
const SIZES = { "Phones": "Téléphones", "Large phones, small tablets": "Grands téléphones, petites tablettes", "Tablets and small laptops": "Tablettes et petits ordinateurs", "Computer monitors": "Écrans d'ordinateur", "Computer monitors larger than HD": "Écrans plus grands que la HD" };
const UNKNOWN = new Set(["", "(unknown)", "unknown"]);

/** Chiffre ou « Indisponible » (jamais un zéro inventé). */
const num = (value) => (value === null || value === undefined ? h("span", { class: "muted" }, "Indisponible") : nf.format(value));

const unavailable = (reason) => h("p", { class: "stats-unavailable" }, h("strong", {}, "Indisponible"), reason ? ` : ${reason}` : ".");

/** Variation (texte) : signe et pourcentage, « nouveau » si rien avant ; null si inconnue. */
function change(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (previous === 0) return current ? { text: "nouveau", dir: "up" } : { text: "=", dir: "flat" };
  const p = Math.round(((current - previous) / previous) * 100);
  return p === 0 ? { text: "=", dir: "flat" } : { text: `${p > 0 ? "+" : "−"}${Math.abs(p)} %`, dir: p > 0 ? "up" : "down" };
}
const deltaBadge = (c, title) => (c ? h("span", { class: `delta delta--${c.dir}`, title }, h("span", { "aria-hidden": "true" }, { up: "▲ ", down: "▼ ", flat: "" }[c.dir]), c.text) : null);

/** Variation par rapport à la période précédente : flèche et signe, pas seulement une couleur. */
function delta(current, previous, days) {
  const c = change(current, previous);
  return c ? h("p", { class: "kpi__delta" }, deltaBadge(c), ` par rapport aux ${days} jours précédents (${nf.format(previous)})`) : null;
}

/** Pas « rond » (1, 2, 5 × 10ⁿ) pour 3 ou 4 graduations. */
function niceStep(max) {
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

/**
 * Histogramme accessible : graduations, étiquettes sous l'axe, lecture exacte au survol, au toucher ou au
 * clavier (flèches). items : [{ value (null = non compté), axis (étiquette courte ou ""), describe() }].
 * uncounted : nombre de colonnes de tête non comptées (zone hachurée).
 */
function barChart(items, { label, idle, uncounted = 0, short = false, minorEvery = 2 }) {
  const n = items.length;
  const values = items.map((d) => d.value).filter((v) => v !== null);
  const max = Math.max(0, ...values);
  const step = max ? niceStep(max) : 1;
  const top = max ? Math.ceil(max / step) * step : 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const readout = h("p", { class: "trend__readout", "aria-live": "polite" });
  const showIdle = () => replace(readout, idle());
  const bars = items.map((d) => h("div", { class: `trend__col${d.value === null ? " is-uncounted" : ""}` },
    d.value ? h("div", { class: "trend__bar", style: { height: `max(2px, ${(d.value / top) * 100}%)` } }) : null));
  const plot = h("div", { class: `trend__plot${n > 45 ? " trend__plot--dense" : ""}`, tabindex: "0", role: "group", "aria-label": `${label} Flèches gauche et droite pour lire chaque valeur.` },
    ticks.map((t) => h("div", { class: "trend__grid", style: { bottom: `${(t / top) * 100}%` } })),
    uncounted ? h("div", { class: "trend__uncounted", style: { width: `${(uncounted / n) * 100}%` } }, uncounted / n > 0.18 ? h("span", {}, "Pas encore compté") : null) : null,
    h("div", { class: "trend__bars" }, bars));
  let active = -1;
  const select = (i) => {
    if (active >= 0) bars[active].classList.remove("is-active");
    active = i;
    if (i < 0) return showIdle();
    bars[i].classList.add("is-active");
    replace(readout, items[i].describe());
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
  // Étiquettes : celles fournies ; sur mobile, une sur `minorEvery` disparaît (en partant de la dernière).
  const labels = items.map((d, i) => [d, i]).filter(([d]) => d.axis);
  const xAxis = h("div", { class: "trend__x", "aria-hidden": "true" }, labels.map(([d, i], k) => h("span", {
    class: (labels.length - 1 - k) % minorEvery ? "is-minor" : "",
    style: { left: `${((i + 0.5) / n) * 100}%` }
  }, d.axis)));
  const yAxis = h("div", { class: "trend__y", "aria-hidden": "true" }, ticks.map((t) => h("span", { style: { bottom: `${(t / top) * 100}%` } }, nf.format(t))));
  showIdle();
  return h("div", {}, readout, h("div", { class: `trend__chart${short ? " trend__chart--short" : ""}` }, yAxis, plot, xAxis));
}

/** Évolution jour par jour ; jours avant `since` (début du comptage GoatCounter) grisés « pas encore compté ». */
function trend(series, { since, today }) {
  const n = series.length;
  const counted = (d) => !since || d.day >= since;
  const peak = series.filter(counted).reduce((best, d) => (d.count > (best?.count ?? -1) ? d : best), null);
  const every = n <= 8 ? 1 : Math.ceil(n / 7);
  const items = series.map((d, i) => ({
    value: counted(d) ? d.count : null,
    axis: (n - 1 - i) % every === 0 ? (n <= 8 ? weekdayDay.format(utc(d.day)) : dayMonth.format(utc(d.day))) : "",
    describe: () => {
      const when = `${formatDate(d.day, { weekday: true })}${d.day === today ? " (journée en cours)" : ""}`;
      return counted(d) ? [h("strong", {}, when), ` · ${plural(d.count, "visite", "visites")} de pages`] : [h("strong", {}, when), " · pas encore compté par GoatCounter"];
    }
  }));
  const chart = barChart(items, {
    label: `Visites de pages par jour, du ${formatDate(series[0].day)} au ${formatDate(series.at(-1).day)} ; le détail est aussi dans la table « Voir les chiffres jour par jour ».`,
    uncounted: since ? series.filter((d) => d.day < since).length : 0,
    idle: () => (peak && peak.count
      ? [h("span", { class: "muted" }, "Jour le plus fréquenté : "), h("strong", {}, formatDate(peak.day, { weekday: true })), ` · ${plural(peak.count, "visite", "visites")}`]
      : h("span", { class: "muted" }, "Aucune visite de page comptée sur la période."))
  });
  const table = h("details", { class: "stats-more" }, h("summary", {}, "Voir les chiffres jour par jour"),
    h("div", { class: "table-wrap" }, h("table", { class: "table table--compact" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Jour"), h("th", { scope: "col", class: "num" }, "Visites de pages"))),
      h("tbody", {}, [...series].reverse().map((d) => h("tr", {}, h("td", {}, formatDate(d.day, { weekday: true })), h("td", { class: "num" }, counted(d) ? nf.format(d.count) : h("span", { class: "muted" }, "pas encore compté"))))))));
  return h("figure", { class: "trend" }, chart, table);
}

/**
 * Classement : libellé, sous-libellé, valeur alignée (nombre ou part selon `mode`, l'autre en petit) et
 * barre proportionnelle à la première ligne. base : total de référence des parts (null : pas de part).
 * item.extra : élément affiché sous la ligne (provenance d'une page…).
 */
function rankList(items, { mode, base, limit = 10, more = "Afficher les {n} suivantes" }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const share = mode === "share" && base;
  const row = (item, i) => h("li", { class: "rank" },
    h("span", { class: "rank__pos", "aria-hidden": "true" }, String(i + 1)),
    h("span", { class: "rank__text" }, h("span", { class: `rank__label${item.dim ? " muted" : ""}` }, item.label, item.tags?.map((t) => h("span", { class: "pill pill--soft" }, t))),
      item.sub || item.action ? h("span", { class: "rank__subline" }, item.sub ? h("span", { class: "rank__sub" }, item.sub) : null, item.action || null) : null),
    h("span", { class: "rank__count" },
      h("span", {}, share ? pct(item.count, base) : nf.format(item.count)),
      base ? h("span", { class: "rank__alt" }, share ? nf.format(item.count) : pct(item.count, base)) : null,
      item.badge || null),
    h("span", { class: "rank__bar", "aria-hidden": "true" }, h("span", { style: { width: `${(item.count / max) * 100}%` } })));
  const list = h("ol", { class: "ranks" }, items.slice(0, limit).map(row));
  if (items.length <= limit) return list;
  const button = h("button", { type: "button", class: "link-btn small", onclick: () => { list.append(...items.slice(limit).map((it, k) => row(it, limit + k))); button.parentElement.remove(); } }, more.replace("{n}", items.length - limit));
  return h("div", {}, list, h("p", { class: "ranks__more" }, button));
}

/** Titre de page sans le suffixe commun du site (« — Tekno Never Dies »), qui n'apporte rien au classement. */
const pageTitle = (title) => title.replace(/\s+[—–-]\s+Tekno Never Dies\s*$/, "").trim();

/** Provenance : tags « interne » (navigation dans le site) et « direct ». */
const refRow = (r) => ({ label: r.name, count: r.count, dim: r.direct, tags: r.internal ? ["depuis le site"] : null });

/**
 * Provenance d'une page, chargée à la demande (bouton « Provenance ») et affichée sous la ligne.
 * container : élément où afficher ; ctx : { period, mode }.
 */
function pageRefsToggle(pathId, label, ctx) {
  let panel = null;
  const button = h("button", { type: "button", class: "btn btn--sm btn--ghost stats-drill", "aria-expanded": "false", title: `D'où viennent les visiteurs de ${label} ?` }, icon("down", { size: 14 }), "Provenance");
  button.addEventListener("click", async () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    if (!open) return panel?.remove();
    panel = h("div", { class: "stats-drill__panel" }, h("p", { class: "small muted" }, "Lecture de GoatCounter…"));
    ctx.attach(button, panel);
    try {
      const r = await get(`/api/stats/page-refs${qs({ path: pathId, ...ctx.period() })}`);
      const sum = r.refs?.reduce((n, x) => n + x.count, 0) || 0;
      replace(panel,
        h("p", { class: "stats-drill__title" }, `Provenance des visites de ${label}`),
        r.stale ? h("p", { class: "small muted" }, `Dernière lecture réussie (${r.staleReason}).`) : null,
        r.refs ? (r.refs.length ? rankList(r.refs.map(refRow), { mode: ctx.mode(), base: r.more ? null : sum, limit: 8, more: "Afficher les {n} suivantes" }) : h("p", { class: "small muted" }, "Aucune provenance enregistrée sur la période."))
          : unavailable(r.errors?.refs));
    } catch (error) {
      replace(panel, unavailable(error.message));
    }
  });
  return button;
}

/** Tableau des soirées, triable par colonne ; sur mobile, une fiche par soirée. */
function eventsTable(events, { selected, from, drill }) {
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
    replace(tbody, rows.map((e) => {
      const tr = h("tr", { class: e.id === selected ? "is-selected" : "", id: `soiree-${e.id}` },
        h("th", { scope: "row", class: "stats-events__name" },
          h("a", { href: `/admin/events/${e.id}` }, e.title),
          h("span", { class: "stats-events__meta" }, [e.date ? formatDate(e.date, { month: "short" }) : null, `/${e.slug}`].filter(Boolean).join(" · ")),
          e.legacyClicks ? h("span", { class: "stats-events__note" }, `dont ${plural(e.legacyClicks, "clic enregistré", "clics enregistrés")} sous le titre (ancien format)`) : null,
          e.firstPublishedAt && e.firstPublishedAt.slice(0, 10) > from ? h("span", { class: "stats-events__note" }, `Publiée le ${formatDate(e.firstPublishedAt.slice(0, 10))} : pas de chiffres avant`) : null,
          e.pathId ? drill(e.pathId, `la fiche « ${e.title} »`, (button, panel) => {
            // Ligne de détail sous la soirée (toute la largeur du tableau).
            const detail = h("tr", { class: "stats-events__detail" }, h("td", { colspan: String(columns.length + 1) }, panel));
            tr.after(detail);
            const observer = new MutationObserver(() => { if (!panel.isConnected || button.getAttribute("aria-expanded") !== "true") { detail.remove(); observer.disconnect(); } });
            observer.observe(button, { attributes: true });
          }) : null),
        cell(e.views, "Visites", h("span", { class: "minibar", "aria-hidden": "true" }, h("span", { style: { width: `${(e.views / maxViews) * 100}%` } }))),
        ...INTERACTIONS.map(([key, short]) => cell(e.interactions[key], short)));
      return tr;
    }));
  };
  render();
  return h("div", { class: "table-wrap stats-events" }, h("table", { class: "table" },
    h("caption", { class: "sr-only" }, "Visites et clics par soirée ; les en-têtes de colonne permettent de trier."),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Soirée"), heads)), tbody));
}

/** Moments des visites : heures de la journée et jours de la semaine (moyenne par jour compté). */
function moments(rhythm, hitsError) {
  if (!rhythm) return [unavailable(hitsError)];
  const hoursTotal = rhythm.hours ? rhythm.hours.reduce((a, b) => a + b, 0) : 0;
  const hourName = (i) => `${i} h – ${(i + 1) % 24} h`;
  const peakHour = rhythm.hours ? rhythm.hours.indexOf(Math.max(...rhythm.hours)) : -1;
  const hours = rhythm.hours ? barChart(rhythm.hours.map((v, i) => ({
    value: v, axis: i % 3 === 0 ? `${i} h` : "",
    describe: () => [h("strong", {}, hourName(i)), ` · ${plural(v, "visite", "visites")}${hoursTotal ? ` (${pct(v, hoursTotal)})` : ""}`]
  })), {
    label: "Visites de pages selon l'heure de la journée, sur toute la période.", short: true,
    idle: () => (hoursTotal ? [h("span", { class: "muted" }, "Heure la plus fréquentée : "), h("strong", {}, hourName(peakHour)), ` · ${pct(rhythm.hours[peakHour], hoursTotal)} des visites`] : h("span", { class: "muted" }, "Aucune visite sur la période."))
  }) : unavailable("GoatCounter n'a pas fourni le détail par heure.");
  const counted = rhythm.weekdays.filter((w) => w.days);
  const mean = (w) => (w.days ? w.total / w.days : null);
  const best = counted.length ? rhythm.weekdays.reduce((b, w, i) => (mean(w) !== null && (b < 0 || mean(w) > mean(rhythm.weekdays[b])) ? i : b), -1) : -1;
  const days = counted.length ? barChart(rhythm.weekdays.map((w, i) => ({
    value: w.days ? Math.round(mean(w) * 10) / 10 : null, axis: WEEKDAYS[i].slice(0, 3),
    describe: () => [h("strong", {}, WEEKDAYS[i]), w.days ? ` · ${avg.format(mean(w))} visites en moyenne (${plural(w.days, `${WEEKDAYS[i]} compté`, `${WEEKDAYS[i]}s comptés`)})` : " · aucun jour complet compté sur la période"]
  })), {
    label: "Moyenne des visites de pages par jour de la semaine.", short: true, minorEvery: 1,
    idle: () => [h("span", { class: "muted" }, "Jour le plus fréquenté en moyenne : "), h("strong", {}, WEEKDAYS[best]), ` · ${avg.format(mean(rhythm.weekdays[best]))} visites`]
  }) : h("p", { class: "small muted" }, "Aucun jour complet compté sur la période.");
  return [h("div", { class: "stats-duo" },
    h("div", {}, h("h3", {}, "Heures de visite"), hours),
    h("div", {}, h("h3", {}, "Jours de la semaine"), days)),
  h("p", { class: "small muted stats-note" }, "Heures selon le fuseau horaire réglé dans le compte GoatCounter (Europe/Paris attendu). Moyennes par jour de la semaine sur les jours complets comptés : la journée en cours et les jours d'avant le comptage sont exclus.")];
}

/** Libellés en français des dimensions GoatCounter (noms d'origine si inconnus). */
function audienceRow(dim, item) {
  const unknown = UNKNOWN.has(item.name.trim().toLowerCase()) || UNKNOWN.has(item.name.trim());
  let label = unknown ? "(inconnu)" : item.name;
  if (!unknown && dim === "sizes") label = SIZES[item.name] || item.name;
  if (!unknown && dim === "locations" && /^[A-Z]{2}$/.test(item.id) && regions) label = regions.of(item.id) || item.name;
  if (!unknown && dim === "languages" && languages && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(item.id || item.name)) {
    try { label = languages.of(item.id || item.name) || item.name; } catch { /* nom d'origine */ }
  }
  return { label, count: item.count, dim: unknown };
}

const AUDIENCE = [
  ["sizes", "Appareils", "Selon la largeur d'écran."],
  ["systems", "Systèmes", "Utile pour l'agenda : iOS et Android l'ouvrent différemment."],
  ["browsers", "Navigateurs", null],
  ["locations", "Pays", null],
  ["languages", "Langues", "Langue du navigateur."],
  ["campaigns", "Campagnes", "Liens marqués utm_campaign."]
];

function audienceBlocks(a, mode) {
  return AUDIENCE.map(([dim, title, hint]) => {
    let d = a.dims?.[dim];
    let body;
    if (!d) body = unavailable(a.errors?.[dim]);
    else {
      // Lignes à 0 renvoyées par GoatCounter : sans intérêt dans un classement.
      d = { ...d, items: d.items.filter((i) => i.count > 0) };
      const known = d.items.filter((i) => !UNKNOWN.has(i.name.trim()));
      const sum = d.items.reduce((n, i) => n + i.count, 0);
      if (dim === "languages" && !known.length) body = h("p", { class: "small muted" }, "Aucune langue connue sur la période : la collecte des langues est sans doute désactivée dans les réglages de GoatCounter.");
      else if (dim === "campaigns" && !d.items.length) body = h("p", { class: "small muted" }, "Aucune campagne sur la période. Ajoutez par exemple ?utm_campaign=ice-boiler-v2 aux liens partagés (Instagram, affiches, QR codes) pour mesurer ce qu'ils apportent.");
      else if (!d.items.length) body = h("p", { class: "small muted" }, "Aucune donnée sur la période.");
      else body = rankList([...d.items].sort((x, y) => y.count - x.count).map((i) => audienceRow(dim, i)), { mode, base: d.more ? null : sum, limit: 6, more: "Afficher les {n} suivants" });
    }
    return h("div", { class: "stats-block" }, h("h3", {}, title), hint ? h("p", { class: "small muted stats-block__hint" }, hint) : null, body);
  });
}

const section = (id, title, intro, ...body) => h("section", { class: "card stats-section", id, "aria-labelledby": `${id}-title` },
  h("div", { class: "stats-section__head" }, h("h2", { id: `${id}-title` }, title), intro ? h("p", {}, intro) : null), ...body);

const MODE_KEY = "tnd.stats.mode";
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === "share" ? "share" : "count"; } catch { return "count"; } };

export async function statsView(ctx, main) {
  document.title = "Statistiques — Administration TND";
  const state = { period: ctx.query.get("period") || "30", start: ctx.query.get("start") || "", end: ctx.query.get("end") || "", event: Number(ctx.query.get("event")) || null, mode: readMode() };
  const results = h("div", { class: "stats-results", "aria-live": "polite" });
  const chips = h("div", { class: "chips", role: "group", "aria-labelledby": "stats-period-label" });
  const modeChips = h("div", { class: "chips", role: "group", "aria-labelledby": "stats-mode-label" });
  const start = input({ type: "date", value: state.start });
  const end = input({ type: "date", value: state.end });
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
  let audience = null;
  const periodQuery = () => ({ period: state.period, start: state.period === "custom" ? state.start : "", end: state.period === "custom" ? state.end : "" });
  const renderChips = () => {
    replace(chips, PERIODS.map(([value, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.period === value), onclick: () => {
      state.period = value;
      custom.hidden = value !== "custom";
      renderChips();
      if (value !== "custom") return load();
      // Dates proposées : celles de la période affichée.
      if (!start.value && last?.range) start.value = last.range.from;
      if (!end.value && last?.range) end.value = last.range.to;
      start.focus();
    } }, label)));
    replace(modeChips, MODES.map(([value, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.mode === value), onclick: () => {
      if (state.mode === value) return;
      state.mode = value;
      try { localStorage.setItem(MODE_KEY, value); } catch { /* préférence non retenue */ }
      renderChips();
      if (last) render(last, { keepScroll: true });
    } }, label)));
  };

  const loadAudience = async (range) => {
    const key = `${range.from}/${range.to}`;
    audience = { key, loading: true };
    let a;
    try {
      a = await get(`/api/stats/audience${qs(periodQuery())}`);
    } catch (error) {
      a = { errors: Object.fromEntries(AUDIENCE.map(([dim]) => [dim, error.message])) };
    }
    if (audience.key !== key) return;
    audience = { key, data: a };
    const slot = document.getElementById("visiteurs-body");
    if (slot) replace(slot, audienceBlocks(a, state.mode));
  };

  const load = async () => {
    history.replaceState(null, "", `/admin/stats${qs({ ...periodQuery(), event: state.event || "" })}${location.hash}`);
    if (state.period === "custom" && !(state.start && state.end)) return;
    if (last) {
      results.classList.add("is-loading");
      results.setAttribute("aria-busy", "true");
      replace(meta, h("span", { class: "muted small" }, "Lecture de GoatCounter…"));
    } else replace(results, loadingState("Lecture des statistiques GoatCounter…"));
    let s;
    try {
      s = await get(`/api/stats${qs(periodQuery())}`);
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

  const render = (s, { keepScroll = false } = {}) => {
    const scroll = window.scrollY;
    const providerLink = s.dashboardUrl ? h("a", { class: "btn btn--sm btn--ghost", href: s.dashboardUrl, target: "_blank", rel: "noopener noreferrer" }, icon("external", { size: 14 }), "GoatCounter") : null;
    replace(meta, s.fetchedAt ? h("span", { class: "small muted" }, `Lu ${relative(s.fetchedAt)}`) : null, providerLink);
    if (!s.configured) {
      return replace(results, h("section", { class: "card" }, h("h2", {}, "Statistiques non reliées"), h("p", { style: { margin: "8px 0" } }, s.reason), h("p", { class: "small muted" }, "Les visites restent comptées par GoatCounter ; un administrateur peut relier le CMS en créant un jeton d'API en lecture (voir docs/cms/statistiques.md).")));
    }
    const { range } = s;
    const mode = state.mode;
    const prev = s.comparison.available ? s.comparison.previous : null;
    const today = parisToday();
    // Début du comptage dans la période : les jours d'avant ne sont pas des jours « à zéro ».
    const since = s.countingSince && s.countingSince > range.from ? s.countingSince : null;
    const selected = state.event && s.events ? s.events.find((e) => e.id === state.event) : null;
    const pagesTotal = s.totals?.pages ?? null;
    const drillCtx = (attach) => ({ period: periodQuery, mode: () => state.mode, attach });
    const drill = (pathId, label, attach) => pageRefsToggle(pathId, label, drillCtx(attach));

    const kpis = h("div", { class: "kpis" },
      h("div", { class: "kpi kpi--main" }, h("p", { class: "kpi__label" }, "Visites de pages"), h("p", { class: "kpi__value" }, num(pagesTotal)),
        prev ? delta(pagesTotal, prev.pages, range.days) : null),
      h("div", { class: "kpi" }, h("p", { class: "kpi__label" }, "Clics suivis"), h("p", { class: "kpi__value" }, num(s.totals?.interactions ?? null)),
        prev ? delta(s.totals?.interactions ?? null, prev.interactions, range.days) : null,
        h("p", { class: "kpi__hint" }, "Billetterie, agenda, itinéraire, partage, réseaux…")));

    const unattributedTotal = (s.unattributed || []).reduce((sum, u) => sum + u.count, 0);
    const pageItems = (s.pages || []).map((p) => {
      const title = pageTitle(p.title || "");
      const c = s.pagesComparison?.available ? change(p.count, p.previous) : null;
      const item = { label: title || p.path, sub: title ? p.path : null, count: p.count, tags: p.eventId ? ["Soirée"] : null,
        badge: c ? deltaBadge(c, p.previous ? `${nf.format(p.previous)} visites sur les ${range.days} jours précédents` : "Aucune visite sur la période précédente") : null };
      if (p.pathId) {
        item.action = drill(p.pathId, `« ${title || p.path} »`, (button, panel) => {
          const li = button.closest("li");
          li.append(panel);
        });
      }
      return item;
    });
    const refsBase = s.refs && !s.refsMore ? s.refs.reduce((n, r) => n + r.count, 0) : null;
    const audienceSlot = h("div", { class: "stats-grid3", id: "visiteurs-body" });
    if (audience?.key === `${range.from}/${range.to}` && audience.data) replace(audienceSlot, audienceBlocks(audience.data, mode));
    else replace(audienceSlot, h("p", { class: "small muted" }, "Lecture de GoatCounter…"));

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
        s.events ? (s.events.length ? eventsTable(s.events, { selected: state.event, from: range.from, drill }) : h("p", { class: "muted" }, "Aucune visite de fiche ni clic sur une soirée pendant cette période."))
          : unavailable(s.errors.hits),
        s.unattributed?.length ? h("details", { class: "stats-more" }, h("summary", {}, `${plural(unattributedTotal, "clic ou visite non attribué", "clics ou visites non attribués")} à une soirée`),
          h("ul", { class: "unattributed" }, s.unattributed.map((u) => h("li", {}, h("span", { class: "unattributed__name" }, u.name), h("span", { class: "unattributed__count" }, nf.format(u.count)), h("span", { class: "unattributed__reason" }, u.reason))))) : null,
        h("details", { class: "stats-more" }, h("summary", {}, "Comment les chiffres sont rattachés aux soirées"),
          h("p", { class: "small muted" }, "Les clics ne sont comptés que depuis leur mise en place sur le site. Ils sont rattachés à la soirée par son adresse : une soirée renommée garde ses statistiques. Les clics plus anciens, enregistrés sous le titre, ne sont rattachés que si une seule soirée porte ou a porté ce titre ; sinon ils restent « non attribués », jamais répartis au hasard. « Provenance » indique d'où viennent les visiteurs de la fiche (adresse la plus vue)."))),

      h("div", { class: "stats-pair" },
        section("pages", "Pages les plus consultées", `Visites par page${mode === "share" ? " ; part du total des visites de pages" : ""}${s.pagesComparison?.available ? ", et évolution par rapport à la période précédente" : ""}.`,
          s.pagesComparison && !s.pagesComparison.available && s.pagesComparison.reason ? h("p", { class: "small muted" }, `Évolution par page indisponible : ${s.pagesComparison.reason}`) : null,
          s.pages ? (pageItems.length ? rankList(pageItems, { mode, base: pagesTotal }) : h("p", { class: "muted" }, "Aucune page vue sur la période.")) : unavailable(s.errors.hits)),
        h("div", { class: "stats-side" },
          section("provenance", "Provenance des visites", "Sites d'où arrivent les visiteurs (référents). « depuis le site » : navigation d'une page à l'autre du site.",
            s.refs ? (s.refs.length ? rankList(s.refs.map(refRow), { mode, base: refsBase }) : h("p", { class: "muted" }, "Aucune donnée de provenance sur la période.")) : unavailable(s.errors.refs)),
          s.siteInteractions?.length ? section("autres-clics", "Autres clics suivis", "Clics hors soirées (équipe, réseaux, contact…) ; parts calculées sur l'ensemble des clics suivis.",
            rankList(s.siteInteractions.map((r) => ({ label: r.name, count: r.count })), { mode, base: s.totals?.interactions || null })) : null)),

      section("moments", "Moments des visites", "Quand le site est consulté : utile pour choisir l'heure et le jour d'une publication.", ...moments(s.rhythm, s.errors.hits)),

      section("visiteurs", "Visiteurs", "Caractéristiques des visites telles que GoatCounter les mesure (sans cookie ni donnée personnelle).", audienceSlot));

    if (keepScroll) window.scrollTo(0, scroll);
    else if (selected) requestAnimationFrame(() => document.getElementById(`soiree-${selected.id}`)?.scrollIntoView({ block: "center" }));
    else if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }));
    if (audience?.key !== `${range.from}/${range.to}`) loadAudience(range);
  };

  replace(main,
    pageHead({ title: "Statistiques", subtitle: "Fréquentation du site et intérêt pour les soirées, d'après GoatCounter (comptage sans cookie)." }),
    h("div", { class: "stats-toolbar" },
      h("div", { class: "stats-toolbar__period" }, h("span", { id: "stats-period-label", class: "stats-toolbar__label" }, "Période"), chips),
      h("div", { class: "stats-toolbar__period" }, h("span", { id: "stats-mode-label", class: "stats-toolbar__label" }, "Afficher"), modeChips),
      meta, custom),
    results);
  renderChips();
  load();
}
