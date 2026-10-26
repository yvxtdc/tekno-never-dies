/**
 * Statistiques de visite : lecture de GoatCounter (outil déjà utilisé par le site, sans cookie) par son
 * API, côté serveur uniquement. Le jeton (CMS_GOATCOUNTER_TOKEN, lecture des statistiques) n'est jamais
 * envoyé au navigateur. Aucun deuxième système de comptage : le site compte déjà les pages vues et les
 * interactions (« événements » GoatCounter : Billetterie · <soirée>, Itinéraire · …, js/partials.js et
 * js/pages/*.js).
 *
 * Honnêteté des chiffres :
 *  - une section dont la récupération échoue vaut null (« indisponible ») avec le motif, jamais 0 ;
 *  - dans une réponse réussie, une page ou une interaction absente vaut réellement 0 ;
 *  - comparaison avec la période précédente seulement si GoatCounter comptait déjà au début de celle-ci ;
 *  - interaction attribuée à une soirée par son adresse (format actuel « Catégorie · <adresse> »), ou, pour
 *    l'ancien format « Catégorie · <titre> », seulement si ce titre désigne une seule soirée.
 * Cache de 10 minutes (et dernière réponse réussie gardée en cas de panne), 4 appels par seconde au plus.
 */
import { runtime, cleanMessage } from "../runtime.mjs";
import { SITE } from "../../../js/data/site.js";
import { parisToUtc, parisToday } from "./timeutil.mjs";
import { badRequest } from "../http/errors.mjs";

const TTL = 10 * 60e3;
const MAX_PAGES = 5;
const cache = new Map();
const firstDay = { at: 0, value: null };

/** Catégories d'interactions rattachées à une soirée (nom GoatCounter « Catégorie · Titre de la soirée »). */
export const EVENT_INTERACTIONS = { "Billetterie": "Billetterie", "Ajouter à l'agenda": "Ajout à l'agenda", "Itinéraire": "Itinéraire", "Partager": "Partage", "DJ Contest": "DJ Contest" };

export function statsSettings(config) {
  const base = (config.goatcounterUrl || (SITE.goatcounter ? new URL(SITE.goatcounter).origin : "")).replace(/\/+$/, "");
  return { base, configured: Boolean(base && config.goatcounterToken), dashboardUrl: base || null };
}

class StatsError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function gc(config, path, params = {}) {
  const { base } = statsSettings(config);
  // Limite de GoatCounter : 4 appels par seconde (horloge monotone, insensible aux changements d'heure).
  const wait = lastCall + 260 - performance.now();
  if (wait > 0) await sleep(wait);
  lastCall = performance.now();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  let res;
  try {
    res = await runtime.fetch(`${base}/api/v0/${path}?${qs}`, { headers: { Authorization: `Bearer ${config.goatcounterToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(10e3) });
  } catch (error) {
    throw new StatsError(error.name === "TimeoutError" ? "GoatCounter ne répond pas." : "GoatCounter est injoignable.");
  }
  if (res.status === 401 || res.status === 403) throw new StatsError("Jeton GoatCounter refusé (absent, révoqué ou sans la permission de lecture des statistiques).");
  if (res.status === 429) throw new StatsError("Limite d'appels de GoatCounter atteinte : réessayez dans un instant.");
  if (!res.ok) throw new StatsError(`GoatCounter : réponse ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new StatsError("GoatCounter : réponse illisible.");
  }
}

const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
/** Début de journée à Paris, en UTC (heure ronde, comme l'attend GoatCounter). */
const parisMidnight = (date) => parisToUtc(`${date}T00:00`).iso.replace(".000Z", "Z");

/** Période : 7, 30 ou 90 derniers jours (aujourd'hui inclus), ou du … au … (366 jours au plus). */
export function resolvePeriod({ period = "30", start, end } = {}, today = parisToday()) {
  let from, to;
  if (period === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "") || start > end) throw badRequest("Période invalide : indiquez une date de début et une date de fin.");
    if (daysBetween(start, end) > 365) throw badRequest("Période trop longue (366 jours au plus).");
    from = start;
    to = end > today ? today : end;
  } else {
    const n = { 7: 7, 30: 30, 90: 90 }[period] || 30;
    to = today;
    from = addDays(today, -(n - 1));
  }
  const days = daysBetween(from, to) + 1;
  return { period, from, to, days, previous: { from: addDays(from, -days), to: addDays(from, -1) } };
}

/** Toutes les lignes de /stats/hits de la période (pages et interactions), paginées par exclusion. */
async function allHits(config, from, to) {
  const hits = new Map();
  let more = true;
  for (let page = 0; more && page < MAX_PAGES; page++) {
    const data = await gc(config, "stats/hits", { start: parisMidnight(from), end: parisMidnight(addDays(to, 1)), limit: 100, daily: true, exclude_paths: [...hits.keys()] });
    if (!Array.isArray(data?.hits)) throw new StatsError("GoatCounter : réponse inattendue.");
    // Une même page ne peut pas compter deux fois, même si GoatCounter la renvoyait sur deux pages de résultats.
    for (const h of data.hits) if (!hits.has(h.path_id)) hits.set(h.path_id, h);
    more = Boolean(data.more);
  }
  return { hits: [...hits.values()], truncated: more };
}

async function totals(config, from, to) {
  const data = await gc(config, "stats/total", { start: parisMidnight(from), end: parisMidnight(addDays(to, 1)) });
  if (typeof data?.total !== "number") throw new StatsError("GoatCounter : réponse inattendue.");
  return { pages: data.total - (data.total_events || 0), interactions: data.total_events || 0 };
}

/** Premier jour compté par GoatCounter (sur 3 ans) : en deçà, une période n'est pas comparable. */
async function countingSince(config) {
  if (config.statsSince) return config.statsSince;
  if (firstDay.value && Date.now() - firstDay.at < 86400e3) return firstDay.value;
  const today = parisToday();
  const data = await gc(config, "stats/total", { start: parisMidnight(addDays(today, -3 * 365)), end: parisMidnight(addDays(today, 1)) });
  const first = (data?.stats || []).filter((d) => (d.daily || 0) > 0).map((d) => d.day).sort()[0] || null;
  Object.assign(firstDay, { at: Date.now(), value: first });
  return first;
}

const settle = async (fn) => {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error: error instanceof StatsError ? error.message : `Erreur inattendue : ${cleanMessage(error)}` };
  }
};

/**
 * Rattachement aux soirées, sans jamais deviner :
 *  - pages /evenement-<adresse>.html et clics « Catégorie · <adresse> » (format actuel, js/pages/helpers.js) :
 *    par l'adresse, actuelle ou ancienne (event_redirects) ; une adresse n'appartient qu'à une soirée ;
 *  - clics « Catégorie · <titre> » (format d'avant) : seulement si une seule soirée porte ou a porté ce
 *    titre (titres de son historique compris) ;
 *  - depuis quand : une adresse ou un titre ne compte pour une soirée qu'à partir du jour où ELLE l'a pris
 *    (création, ou renommage d'après son historique) ; les jours antérieurs (adresse ou titre d'une soirée
 *    supprimée, repris ensuite) restent listés « non attribués ». Sans date (soirée et adresse antérieures à
 *    l'import initial), tout l'historique lui revient.
 * events : [{ id, title, slug, redirects, pastTitles, since: { "slug:<adresse>": date, "title:<titre>": date } }].
 */
export function attribute(hits, events) {
  const sinceOf = (ev, kind, value) => ev.since?.[`${kind}:${value}`] ?? ev.notBefore ?? null;
  const bySlug = new Map();
  for (const ev of events) for (const s of [ev.slug, ...(ev.redirects || [])]) bySlug.set(s, ev);
  const byTitle = new Map();
  for (const ev of events) for (const title of new Set([ev.title, ...(ev.pastTitles || [])])) byTitle.set(title, [...(byTitle.get(title) || []), ev]);
  const perEvent = new Map(events.map((ev) => [ev.id, {
    id: ev.id, title: ev.title, slug: ev.slug, firstPublishedAt: ev.firstPublishedAt, views: 0, legacyClicks: 0,
    interactions: Object.fromEntries(Object.values(EVENT_INTERACTIONS).map((k) => [k, 0]))
  }]));
  const pages = [];
  const siteInteractions = new Map();
  const unattributed = [];
  /** Compte d'une ligne pour une soirée : jours antérieurs à la date où elle a pris ce nom écartés (et signalés). */
  const countFor = (h, ev, notBefore) => {
    if (!notBefore) return h.count;
    if (!Array.isArray(h.stats) || !h.stats.length) {
      if (h.count) unattributed.push({ name: h.path, count: h.count, reason: "détail par jour indisponible pour une adresse récente : rien n'est attribué" });
      return 0;
    }
    const before = h.stats.filter((s) => s.day < notBefore).reduce((n, s) => n + (s.daily || 0), 0);
    if (before) unattributed.push({ name: h.path, count: before, reason: `antérieur au ${notBefore}, date à laquelle « ${ev.title} » a pris ce nom (nom d'une ancienne soirée ?)` });
    return h.stats.filter((s) => s.day >= notBefore).reduce((n, s) => n + (s.daily || 0), 0);
  };
  for (const h of hits) {
    if (!h.event) {
      const m = String(h.path).match(/^\/evenement-([a-z0-9-]+)\.html$/);
      const ev = m ? bySlug.get(m[1]) : null;
      if (ev) perEvent.get(ev.id).views += countFor(h, ev, sinceOf(ev, "slug", m[1]));
      pages.push({ path: h.path, title: h.title || "", count: h.count, eventId: ev?.id ?? null });
      continue;
    }
    const [category, ...rest] = String(h.path).split(" · ");
    const label = EVENT_INTERACTIONS[category];
    if (!label || !rest.length) {
      siteInteractions.set(category, (siteInteractions.get(category) || 0) + h.count);
      continue;
    }
    const key = rest.join(" · ");
    const bySlugEvent = bySlug.get(key);
    const candidates = byTitle.get(key) || [];
    // Une adresse qui serait aussi le titre (ancien format) d'une AUTRE soirée : ambigu, rien n'est attribué.
    if (bySlugEvent && candidates.some((c) => c.id !== bySlugEvent.id)) {
      unattributed.push({ name: h.path, count: h.count, reason: "nom ambigu : adresse d'une soirée et titre d'une autre" });
      continue;
    }
    if (bySlugEvent) {
      perEvent.get(bySlugEvent.id).interactions[label] += countFor(h, bySlugEvent, sinceOf(bySlugEvent, "slug", key));
      continue;
    }
    if (candidates.length === 1) {
      const n = countFor(h, candidates[0], sinceOf(candidates[0], "title", key));
      perEvent.get(candidates[0].id).interactions[label] += n;
      perEvent.get(candidates[0].id).legacyClicks += n;
    } else {
      unattributed.push({ name: h.path, count: h.count, reason: candidates.length > 1 ? `ancien format par titre, titre porté par ${candidates.length} soirées` : key === "?" ? "soirée non identifiée au moment du clic" : "aucune soirée connue sous ce nom ou cette adresse" });
    }
  }
  return {
    pages: pages.sort((a, b) => b.count - a.count),
    events: [...perEvent.values()],
    siteInteractions: [...siteInteractions.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    unattributed
  };
}

/** Série quotidienne des pages vues (sans les interactions) ; jours sans visite : 0. */
function series(hits, from, days) {
  const map = new Map(Array.from({ length: days }, (_, i) => [addDays(from, i), 0]));
  for (const h of hits) if (!h.event) for (const s of h.stats || []) if (map.has(s.day)) map.set(s.day, map.get(s.day) + (s.daily || 0));
  return [...map.entries()].map(([day, count]) => ({ day, count }));
}

/**
 * Statistiques d'une période. events : soirées pour le rattachement. Réponse sans aucun secret.
 */
export async function getStats(db, config, query = {}) {
  const settings = statsSettings(config);
  const range = resolvePeriod(query);
  const base = { configured: settings.configured, dashboardUrl: settings.dashboardUrl, range, fetchedAt: null };
  if (!settings.configured) return { ...base, reason: settings.base ? "Aucun jeton d'API GoatCounter n'est configuré (CMS_GOATCOUNTER_TOKEN) : les statistiques restent consultables sur le tableau de bord GoatCounter." : "GoatCounter n'est pas configuré." };
  const key = JSON.stringify([range.from, range.to]);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  // Date de première publication connue seulement pour les soirées publiées dans le CMS après l'import
  // initial (l'import enregistre sa propre date pour les soirées déjà en ligne : elle ne dit rien).
  const importedAt = Date.parse(JSON.parse(db.get("SELECT value FROM settings WHERE key = 'import.done'")?.value || "{}").at || "") || 0;
  // Toutes les soirées (brouillons compris : une soirée repassée en brouillon garde ses statistiques).
  // Titres passés : ceux de l'historique de CETTE soirée (même génération), pour les clics de l'ancien format.
  // Noms portés par chaque soirée et date à laquelle elle les a pris (event_names, tenue par la base) :
  // un nom ne compte pour une soirée qu'à partir de cette date ; sans date, tout son historique.
  const events = db.all("SELECT id, title, slug, first_published_at FROM events").map((e) => {
    const names = db.all("SELECT kind, value, since FROM event_names WHERE event_id = ?", e.id);
    const since = Object.fromEntries(names.map((n) => [`${n.kind}:${n.value}`, n.since ? parisToday(new Date(n.since)) : null]));
    return {
      id: e.id, title: e.title, slug: e.slug,
      firstPublishedAt: e.first_published_at && Date.parse(e.first_published_at) > importedAt + 5 * 60e3 ? e.first_published_at : null,
      redirects: db.all("SELECT old_slug FROM event_redirects WHERE event_id = ?", e.id).map((r) => r.old_slug),
      pastTitles: names.filter((n) => n.kind === "title").map((n) => n.value),
      // Nom sans entrée (ne devrait pas arriver) : prudence, rien avant aujourd'hui.
      since: new Proxy(since, { get: (o, k) => (k in o ? o[k] : parisToday()) })
    };
  });
  const current = await settle(() => totals(config, range.from, range.to));
  const hits = await settle(() => allHits(config, range.from, range.to));
  const refs = await settle(async () => {
    const data = await gc(config, "stats/toprefs", { start: parisMidnight(range.from), end: parisMidnight(addDays(range.to, 1)), limit: 10 });
    if (!Array.isArray(data?.stats)) throw new StatsError("GoatCounter : réponse inattendue.");
    return data.stats.map((s) => ({ name: s.name || "(accès direct ou inconnu)", count: s.count }));
  });
  const since = await settle(() => countingSince(config));
  let comparison = { available: false, reason: "" };
  if (since.error) comparison.reason = `Début du comptage inconnu : ${since.error}`;
  else if (!since.value || since.value > range.previous.from) comparison.reason = `Pas de comparaison : GoatCounter ne comptait pas encore au début de la période précédente (${range.previous.from}).`;
  else {
    const previous = await settle(() => totals(config, range.previous.from, range.previous.to));
    comparison = previous.error ? { available: false, reason: previous.error } : { available: true, previous: previous.value, range: range.previous };
  }
  const attributed = hits.value ? attribute(hits.value.hits, events) : null;
  const data = {
    ...base,
    fetchedAt: new Date().toISOString(),
    countingSince: since.value ?? null,
    totals: current.value ?? null,
    series: hits.value ? series(hits.value.hits, range.from, range.days) : null,
    pages: attributed ? attributed.pages.slice(0, 15) : null,
    events: attributed ? attributed.events.filter((e) => e.views || Object.values(e.interactions).some(Boolean)).sort((a, b) => b.views - a.views) : null,
    siteInteractions: attributed?.siteInteractions ?? null,
    unattributed: attributed?.unattributed ?? null,
    truncated: Boolean(hits.value?.truncated),
    refs: refs.value ?? null,
    comparison,
    errors: Object.fromEntries(Object.entries({ totals: current.error, hits: hits.error, refs: refs.error }).filter(([, v]) => v))
  };
  const failed = Object.keys(data.errors).length;
  if (!failed) cache.set(key, { at: Date.now(), data });
  // Panne : dernière réponse complète de cette période, signalée comme telle (jamais des zéros).
  if (failed && cached) return { ...cached.data, stale: true, staleReason: Object.values(data.errors)[0] };
  return data;
}

/** Vide le cache (tests). */
export function clearStatsCache() {
  cache.clear();
  Object.assign(firstDay, { at: 0, value: null });
}
