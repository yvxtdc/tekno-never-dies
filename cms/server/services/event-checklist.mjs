/**
 * « Vérifier avant publication » d'une soirée : contrôles des données (events.eventCheckItems), complétés
 * par ce qui demande les fichiers : images réellement présentes (sinon la mise en ligne échouerait) et
 * rendu de la fiche publique avec le modèle du site (tools/lib/event-page.mjs, comme l'aperçu).
 *
 * Niveaux : error (bloque la publication immédiate, la programmation et son exécution), warning (à
 * vérifier), ok, na (sans objet ici), unverified (impossible à vérifier depuis le CMS, ex. un site de
 * billetterie externe). Le contrôle complet du site (tools/validate.mjs) reste fait une seule fois, à la
 * mise en ligne ; son dernier résultat est rappelé (siteValidation).
 */
import fs from "node:fs";
import path from "node:path";
import { eventCheckItems, getEvent, PUBLIC_STATUSES } from "./events.mjs";
import { sourceFile, VARIANTS } from "./media.mjs";
import { buildSiteData } from "../export/site-data.mjs";
import { renderEventPage } from "../../../tools/lib/event-page.mjs";
import { parisToday } from "./timeutil.mjs";
import { fromJson } from "../db/index.mjs";

/** Le fichier d'une image est-il disponible (original, ou variante déjà calculée) ? */
function mediaAvailable(config, media) {
  let src;
  try {
    src = sourceFile(config, media);
  } catch {
    return false;
  }
  if (fs.existsSync(src)) return true;
  if (media.storage === "repo") return false; // image du dépôt servie telle quelle
  return Object.keys(VARIANTS).some((v) => fs.existsSync(path.join(config.mediaDir, "cache", `${media.uid}-v${media.version}-${v}.${VARIANTS[v].ext}`)));
}

/** Images utilisées par la fiche publique d'une soirée : affiche, fond, photos, photos des artistes. */
function eventMedia(db, ev) {
  const list = [];
  const push = (id, section, label) => {
    const media = id ? db.get("SELECT * FROM media WHERE id = ?", id) : null;
    if (media) list.push({ media, section, label });
  };
  push(ev.flyerMediaId, "visuels", "Affiche");
  push(ev.coverMediaId, "visuels", "Photo de fond");
  ev.photos.forEach((p, i) => push(p.mediaId, "soiree", `Photo « La soirée » ${i + 1}`));
  for (const slot of ev.lineup) for (const a of slot.artists) push(a.photo?.id, "lineup", `Photo de ${a.name}`);
  return list;
}

/** Problèmes de fichiers (bloquants : la mise en ligne copie ces images). */
function fileItems(db, config, ev) {
  if (!config) return [];
  const missing = eventMedia(db, ev).filter(({ media }) => !mediaAvailable(config, media));
  if (!missing.length) return [{ id: "files", section: "visuels", label: "Fichiers des images", level: "ok", message: "" }];
  return missing.map(({ media, section, label }, i) => ({
    id: `file-${i}`, section, label: "Fichiers des images", level: "error",
    message: `${label} : fichier « ${media.original_name || media.repo_path} » introuvable sur le serveur ; la mise en ligne échouerait. Choisissez une autre image ou réimportez-la.`
  }));
}

/**
 * Erreurs bloquantes d'une soirée (données et fichiers) : utilisées avant une publication immédiate,
 * à la programmation et à l'exécution d'une programmation (le contenu a pu changer entre-temps).
 */
export function blockingProblems(db, config, id) {
  const ev = getEvent(db, id, { withChecks: false });
  return [...eventCheckItems(db, ev), ...fileItems(db, config, ev)].filter((i) => i.level === "error").map((i) => i.message);
}

/** Rendu de la fiche publique avec le modèle du site (comme l'aperçu) : erreur si impossible. */
function renderItem(db, config, ev) {
  if (!config) return null;
  try {
    const data = buildSiteData(db, { mode: "preview", includeEventIds: [ev.id] });
    const exported = data.events.find((e) => e.slug === ev.slug);
    const template = fs.readFileSync(path.join(config.siteDir, "evenement.html"), "utf8");
    const html = renderEventPage(template, exported, {});
    const ok = /<title>[^<]+<\/title>/.test(html) && html.includes('"@type"');
    return { id: "render", section: "essentiel", label: "Fiche publique et aperçus de partage", level: ok ? "ok" : "error", message: ok ? "La fiche, son titre et ses données structurées sont générés." : "La fiche publique est générée sans titre ni données structurées." };
  } catch (error) {
    return { id: "render", section: "essentiel", label: "Fiche publique et aperçus de partage", level: "error", message: `La fiche publique ne peut pas être générée : ${String(error.message).split("\n")[0].slice(0, 200)}` };
  }
}

/** Rapport complet affiché par « Vérifier avant publication ». */
export function prepublicationReport(db, config, id) {
  const ev = getEvent(db, id, { withChecks: false });
  const upcoming = ev.date >= parisToday();
  const items = [...eventCheckItems(db, ev), ...fileItems(db, config, ev)];
  const render = renderItem(db, config, ev);
  if (render) items.push(render);
  // Ce que le CMS ne peut pas vérifier lui-même : il n'appelle pas les sites externes.
  if (ev.ticketUrl && upcoming && ev.status !== "cancelled") items.push({ id: "ticket-reachable", section: "billetterie", label: "Page de billetterie", level: "unverified", message: "Le CMS ne consulte pas les sites externes : ouvrez le lien de billetterie pour vérifier qu'il mène à la bonne soirée et qu'il est ouvert." });
  if (ev.links.length) items.push({ id: "links-reachable", section: "pratique", label: "Liens complémentaires", level: "unverified", message: `${ev.links.length} lien(s) externe(s) non vérifié(s) en ligne.` });
  const counts = { error: 0, warning: 0, ok: 0, na: 0, unverified: 0 };
  for (const i of items) counts[i.level]++;
  const last = db.get("SELECT id, finished_at, validation FROM publications WHERE validation IS NOT NULL ORDER BY id DESC LIMIT 1");
  const validation = last ? fromJson(last.validation, null) : null;
  return {
    event: { id: ev.id, title: ev.title, status: ev.status, date: ev.date, upcoming, public: PUBLIC_STATUSES.includes(ev.status) },
    items,
    counts,
    canPublish: counts.error === 0,
    siteValidation: validation ? { publicationId: last.id, at: last.finished_at, ok: validation.ok, errors: validation.errors.length, warnings: validation.warnings } : null
  };
}
