/**
 * Programmations (modifications ciblées à une date) et historique des versions : dialogues et cartes
 * partagés par les fiches (soirées, artistes, lieux, équipe, FAQ) et la vue « Programmations ».
 * Les dates se saisissent et s'affichent à l'heure de Paris ; le serveur convertit et valide.
 */
import { h, replace, append, debounce } from "./dom.js";
import { get, post, put, qs } from "./api.js";
import { icon, toast, errorMessage, dialog, confirm, busy, statusBadge, field, input, checkbox } from "./ui.js";
import { formatDateTime, relative } from "./format.js";
import { can } from "./session.js";
import { navigate } from "./router.js";
import { utcToParis, parisToUtc } from "/admin/shared/timeutil.mjs";

/** Statut d'une programmation -> style de badge existant. */
const BADGE = { pending: "scheduled", applied: "running", published: "published", conflict: "failed", blocked: "running", failed: "failed", cancelled: "archived" };
export const changeBadge = (c) => statusBadge(BADGE[c.status] || "draft", c.statusLabel);

/** « 2026-11-12T19:00 » -> « jeu. 12 nov. 2026 à 19h00 ». */
export function formatLocal(local) {
  const r = parisToUtc(local);
  return r.iso ? formatDateTime(r.iso).replace(/(\d{2}):(\d{2})$/, "$1h$2") : local;
}

/** Demain à 18 h, heure de Paris (valeur proposée par défaut). */
export const defaultRunAt = () => `${utcToParis(Date.now() + 86400e3).local.slice(0, 10)}T18:00`;

/** Aperçu du site tel qu'il sera à une date (programmations prévues appliquées, sans rien modifier). */
export function previewAtUrl(local) {
  const r = parisToUtc(local);
  return r.iso ? `/preview/at-${Math.floor(Date.parse(r.iso) / 1000)}/` : null;
}

/** Tableau des modifications : élément, valeur de référence, (valeur actuelle), valeur programmée. */
export function changesTable(changes, { withCurrent = false } = {}) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Élément"), h("th", { scope: "col" }, "Avant"), withCurrent ? h("th", { scope: "col" }, "Actuellement") : null, h("th", { scope: "col" }, "Programmé"))),
    h("tbody", {}, changes.map((c) => h("tr", {},
      h("td", { class: "title-col" }, h("strong", {}, c.label)),
      h("td", { "data-label": "Avant" }, h("span", { class: "muted" }, c.from)),
      withCurrent ? h("td", { "data-label": "Actuellement" }, c.current !== undefined ? h("strong", { style: { color: "var(--amber)" } }, c.current) : h("span", { class: "muted" }, "=")) : null,
      h("td", { "data-label": "Programmé" }, c.to))))));
}

const errorDetails = (error) => {
  const fields = Object.values(error.fields || {});
  const conflicts = error.data?.scheduleConflicts || [];
  return h("div", { class: "form-errors", role: "alert" },
    h("strong", {}, errorMessage(error)),
    fields.length ? h("ul", {}, fields.map((m) => h("li", {}, m))) : null,
    conflicts.length ? h("ul", {}, conflicts.map((c) => h("li", {}, `${c.label} : vous partez de « ${c.base} », mais une programmation antérieure prévoit « ${c.expected} ».`))) : null);
};

/**
 * Programmer les modifications d'un formulaire. input : fiche complète telle que saisie ; basis : état
 * de départ du formulaire ({ mode: "current", version } ou état prévu renvoyé par le serveur).
 * runAtLocal : date imposée (formulaire préparé sur l'état prévu à cette date).
 * onPredict(local) : proposé si des programmations antérieures visent les mêmes éléments.
 */
export function scheduleChangesDialog({ type, id, input: data, basis, replaceId = null, runAtLocal = null, title = "Programmer ces modifications", onDone, onPredict }) {
  const when = input({ type: "datetime-local", value: runAtLocal || defaultRunAt(), required: true, disabled: Boolean(runAtLocal), step: 60 });
  const result = h("div", { class: "stack", "aria-live": "polite" });
  const ok = h("button", { type: "button", class: "btn btn--primary", disabled: true }, icon("clock"), "Programmer");
  const body = { entityType: type, entityId: id, input: data, basis, replaceId };
  let seq = 0;
  const check = async () => {
    ok.disabled = true;
    if (!when.value) return replace(result, h("p", { class: "hint" }, "Choisissez la date et l'heure."));
    const mine = ++seq;
    replace(result, h("p", { class: "muted" }, "Vérification…"));
    try {
      const p = await post("/api/schedule", { ...body, runAt: when.value, preview: true });
      if (mine !== seq) return;
      replace(result,
        h("p", {}, `Le ${formatLocal(p.runAtLocal)}, seuls ces éléments seront modifiés (le reste de la fiche, y compris ce qui changera d'ici là, est conservé) :`),
        changesTable(p.changes),
        p.dependsOn.length ? h("p", { class: "small" }, `S'exécutera après la programmation n° ${p.dependsOn.join(", n° ")} (mise en ligne du contenu ou ajout d'un passage). Si elle échoue ou est annulée, celle-ci sera bloquée.`) : null,
        p.warnings.length ? h("ul", { class: "checklist" }, p.warnings.map((w) => h("li", {}, w))) : null);
      ok.disabled = false;
    } catch (error) {
      if (mine !== seq) return;
      replace(result, errorDetails(error),
        error.data?.scheduleConflicts && onPredict ? h("div", {}, h("button", { type: "button", class: "btn btn--sm", onclick: () => { d.close(); onPredict(when.value); } }, icon("history"), "Préparer à partir de l'état prévu à cette date")) : null);
    }
  };
  when.addEventListener("input", debounce(check, 400));
  const d = dialog({
    title,
    wide: true,
    body: h("div", { class: "stack" },
      field({ label: "Date et heure d'application (heure de Paris)", control: when, hint: runAtLocal ? "Le formulaire montre l'état prévu à cette date : pour une autre date, rechargez l'état prévu." : "Rien n'est visible sur le site avant cette heure. Le serveur applique la modification même si personne n'est connecté, puis met le site en ligne." }),
      result),
    actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok]
  });
  ok.addEventListener("click", () => busy(ok, async () => {
    try {
      const res = await post("/api/schedule", { ...body, runAt: when.value });
      d.close("ok");
      toast(`Programmé pour le ${formatLocal(res.change.runAtLocal)} (n° ${res.change.id}).`, "success", { timeout: 7000 });
      onDone?.(res);
    } catch (error) {
      replace(result, errorDetails(error));
    }
  }));
  check();
}

/** Programmations ouvertes d'un type de contenu : Map identifiant -> la plus urgente (à traiter, sinon la prochaine). */
export async function scheduledCounts(type) {
  const { items } = await get(`/api/schedule${qs({ type, status: "open", pageSize: 200 })}`);
  const map = new Map();
  const rank = (c) => (["conflict", "blocked", "failed"].includes(c.status) ? 0 : c.status === "pending" ? 1 : 2);
  for (const c of items) if (!map.has(c.entityId) || rank(c) < rank(map.get(c.entityId))) map.set(c.entityId, c);
  return map;
}

/** Demande une date (heure de Paris) ; Promise<string|null>. */
export function askDate({ title, label = "Date et heure (heure de Paris)", hint, value = defaultRunAt(), confirmLabel = "Continuer" }) {
  return new Promise((resolve) => {
    const when = input({ type: "datetime-local", value, required: true, step: 60 });
    const ok = h("button", { type: "button", class: "btn btn--primary" }, confirmLabel);
    let chosen = null;
    const d = dialog({ title, body: field({ label, control: when, hint }), actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok], onClose: () => resolve(chosen) });
    ok.addEventListener("click", () => {
      if (!when.value) return when.focus();
      chosen = when.value;
      d.close("ok");
    });
    when.focus();
  });
}

/** Détail d'une programmation : modifications, dépendances, journal, actions selon son état. */
export async function changeDialog(id, { onChanged } = {}) {
  let c;
  try {
    c = await get(`/api/schedule/${id}`);
  } catch (error) {
    return toast(errorMessage(error), "error");
  }
  const open = ["pending", "conflict", "blocked", "failed"].includes(c.status);
  const editable = can("content.publish");
  const done = (message) => {
    if (message) toast(message);
    d.close("ok");
    onChanged?.();
  };
  const act = (label, fn, cls = "") => h("button", { type: "button", class: `btn btn--sm ${cls}`, onclick: (e) => busy(e.currentTarget, async () => {
    try {
      await fn();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }) }, label);
  const actions = [];
  if (editable && open) {
    actions.push(act("Changer la date", async () => {
      const local = await askDate({ title: "Nouvelle date", value: c.runAtLocal, confirmLabel: "Déplacer" });
      if (!local) return;
      await put(`/api/schedule/${c.id}`, { runAt: local, version: c.version });
      done(`Déplacée au ${formatLocal(local)}.`);
    }));
    const formBased = !c.changes.some((x) => x.key === "status");
    if (formBased && c.entityExists && ["event", "artist", "venue"].includes(c.entityType)) {
      actions.push(h("a", { class: "btn btn--sm", href: `${c.adminPath}?change=${c.id}` }, "Modifier le contenu"));
    }
    if (c.status === "pending") actions.push(act("Exécuter maintenant", async () => {
      if (!(await confirm({ title: "Exécuter maintenant ?", message: "La modification est appliquée tout de suite dans le CMS, puis mise en ligne avec la prochaine mise en ligne (automatique).", confirmLabel: "Exécuter" }))) return;
      const res = await post(`/api/schedule/${c.id}/resolve`, { action: "run" });
      done(res.result.message);
    }));
    if (c.status === "conflict" && !c.impossible.length) actions.push(act("Imposer la valeur programmée", async () => {
      if (!(await confirm({ title: "Imposer la valeur programmée ?", message: "La valeur actuelle (modifiée entre-temps) sera remplacée par la valeur programmée. L'ancienne valeur reste dans l'historique.", confirmLabel: "Imposer", danger: true }))) return;
      const res = await post(`/api/schedule/${c.id}/resolve`, { action: "force" });
      done(res.result.message);
    }, "btn--primary"));
    if (["blocked", "failed"].includes(c.status)) actions.push(act("Réessayer", async () => {
      const res = await post(`/api/schedule/${c.id}/resolve`, { action: "retry" });
      done(res.result.message);
    }, "btn--primary"));
    actions.push(act(c.status === "conflict" ? "Garder la valeur actuelle (annuler)" : "Annuler la programmation", async () => {
      const cascade = c.dependents.length ? checkbox(`Annuler aussi les ${c.dependents.length} programmation(s) qui en dépendent (sinon elles seront bloquées)`) : null;
      if (!(await confirm({ title: "Annuler la programmation ?", message: h("div", { class: "stack" }, h("p", {}, `« ${c.summary} » ne sera pas appliquée.`), cascade), confirmLabel: "Annuler la programmation", danger: true }))) return;
      await post(`/api/schedule/${c.id}/cancel`, { cascade: Boolean(cascade?.input.checked) });
      done("Programmation annulée.");
    }, "btn--danger"));
  }
  const link = (x) => h("button", { type: "button", class: "link-btn", onclick: () => { d.close(); changeDialog(x.id, { onChanged }); } }, `n° ${x.id}`);
  const body = h("div", { class: "stack" },
    h("div", { class: "row" }, changeBadge(c), h("strong", {}, formatLocal(c.runAtLocal)), h("span", { class: "muted small" }, relative(c.runAt))),
    h("p", {}, `${c.entityTypeLabel} : `, c.adminPath ? h("a", { href: c.adminPath, onclick: () => d.close() }, c.entityName) : h("strong", {}, `${c.entityName} (supprimé)`)),
    c.result && c.result !== c.availability ? h("p", { class: ["conflict", "blocked", "failed"].includes(c.status) ? "form-errors" : "small muted" }, c.result) : null,
    c.status === "applied" ? h("p", { class: "small" }, "Appliquée dans le CMS, pas encore sur le site : elle partira avec la prochaine mise en ligne (automatique). ", can("site.publish") ? h("a", { href: "/admin/publish", onclick: () => d.close() }, "Mise en ligne →") : null) : null,
    c.availability ? h("p", { class: "small" }, c.availability) : null,
    changesTable(c.changes, { withCurrent: c.status === "conflict" }),
    c.dependsOn.length ? h("p", { class: "small" }, "Dépend de : ", c.dependsOn.flatMap((x, i) => [i ? ", " : "", link(x), ` (${x.summary}, ${x.statusLabel.toLowerCase()})`])) : null,
    c.chainBefore.length ? h("p", { class: "small" }, "Après, sur les mêmes éléments : ", c.chainBefore.flatMap((x, i) => [i ? ", " : "", link(x), ` (${x.statusLabel.toLowerCase()})`])) : null,
    c.dependents.length ? h("p", { class: "small" }, "En dépendent : ", c.dependents.flatMap((x, i) => [i ? ", " : "", link(x)])) : null,
    c.status === "pending" ? h("p", { class: "small" }, h("a", { href: previewAtUrl(c.runAtLocal), target: "_blank", rel: "noopener" }, icon("eye"), " Aperçu du site à cette date")) : null,
    h("details", {}, h("summary", { class: "small", style: { cursor: "pointer", fontWeight: 600 } }, "Journal de la programmation"),
      h("ul", { class: "activity", style: { marginTop: "8px" } }, c.log.map((l) => h("li", {}, h("span", {}, l.message, l.user_name ? h("span", { class: "muted" }, ` — ${l.user_name}`) : null), h("time", { datetime: l.created_at }, formatDateTime(l.created_at)))))),
    actions.length ? h("div", { class: "actions" }, actions) : null);
  const d = dialog({ title: `Programmation n° ${c.id} · ${c.summary}`, wide: true, body });
}

/** Carte « Programmations » d'une fiche : à venir, à traiter, appliquées pas encore en ligne. */
export function pendingCard({ type, id, onPrepare, onChanged }) {
  const list = h("div", { class: "stack" }, h("p", { class: "muted small" }, "Chargement…"));
  const card = h("section", { class: "card", "aria-labelledby": `sched-${type}-${id}` });
  const load = async () => {
    try {
      const { items } = await get(`/api/schedule${qs({ type, entityId: id, status: "open", pageSize: 50 })}`);
      card.classList.toggle("card--warn", items.some((c) => ["conflict", "blocked", "failed"].includes(c.status)));
      replace(list, items.length
        ? h("ul", { class: "activity" }, items.map((c) => h("li", {},
            h("span", { class: "row", style: { gap: "6px" } }, changeBadge(c), h("button", { type: "button", class: "link-btn", onclick: () => changeDialog(c.id, { onChanged: () => { load(); onChanged?.(); } }) }, c.summary)),
            h("time", { datetime: c.runAt }, `${formatLocal(c.runAtLocal)} · n° ${c.id}`))))
        : h("p", { class: "muted small" }, "Aucune modification programmée."));
    } catch (error) {
      replace(list, h("p", { class: "error-text" }, errorMessage(error)));
    }
  };
  append(card, [
    h("div", { class: "card__head" }, h("h2", { id: `sched-${type}-${id}` }, "Programmations"), h("p", {}, "Modifications prévues à une date, appliquées automatiquement.")),
    list,
    h("div", { class: "actions", style: { marginTop: "10px" } },
      onPrepare && can("content.publish") ? h("button", { type: "button", class: "btn btn--sm", onclick: async () => {
        const local = await askDate({ title: "Préparer une modification programmée", hint: "Le formulaire affichera l'état prévu à cette date (avec les programmations déjà prévues d'ici là) : modifiez-le, puis « Programmer ces modifications »." });
        if (local) onPrepare(local);
      } }, icon("clock"), "Préparer l'état à une date…") : null,
      h("a", { class: "btn btn--sm btn--ghost", href: "/admin/schedule" }, "Toutes")),
  ]);
  card.reload = load;
  load();
  return card;
}

const ORIGINS = { manual: "Saisie", schedule: "Programmation", restore: "Restauration", status: "Statut" };

/** Comparaison de deux versions. */
async function compareDialog(type, id, a, b, title) {
  try {
    const data = await get(`/api/history/${type}/${id}/compare${qs({ a, b })}`);
    dialog({
      title, wide: true,
      body: data.rows.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Élément"), h("th", { scope: "col" }, `Version ${data.a.version}`), h("th", { scope: "col" }, b === "current" ? "Actuelle" : `Version ${data.b.version}`))),
            h("tbody", {}, data.rows.map((r) => h("tr", {}, h("td", { class: "title-col" }, h("strong", {}, r.label)), h("td", { "data-label": `v${data.a.version}` }, h("span", { class: "muted" }, r.a)), h("td", { "data-label": b === "current" ? "Actuelle" : `v${data.b.version}` }, r.b))))))
        : h("p", { class: "muted" }, "Aucune différence de contenu.")
    });
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

/**
 * Carte « Historique » : versions successives (origine, auteur, champs modifiés), comparaison avec la
 * précédente ou l'actuelle, restauration (nouvelle version, les intermédiaires sont conservées).
 */
export function historyCard({ type, id, isDirty = () => false, onRestored }) {
  const list = h("div", { class: "stack" }, h("p", { class: "muted small" }, "Chargement…"));
  const details = h("details", {}, h("summary", { class: "small", style: { cursor: "pointer", fontWeight: 600 } }, "Voir les versions"), list);
  const load = async () => {
    try {
      const { revisions } = await get(`/api/history/${type}/${id}`);
      replace(list, revisions.length ? h("ul", { class: "activity" }, revisions.map((r, i) => h("li", {},
        h("span", {}, h("strong", {}, `Version ${r.version}`), " ", h("span", { class: "pill" }, r.change_id ? `${ORIGINS.schedule} n° ${r.change_id}` : ORIGINS[r.origin] || r.origin),
          i === 0 ? h("span", { class: "pill", style: { marginLeft: "6px" } }, "actuelle") : null, r.user_name ? ` · ${r.user_name}` : ""),
        r.changeLabels.length ? h("span", { class: "small muted" }, `Modifié : ${r.changeLabels.join(", ")}`) : null,
        h("span", { class: "row" }, h("time", { datetime: r.created_at }, formatDateTime(r.created_at)),
          revisions[i + 1] ? h("button", { type: "button", class: "link-btn small", onclick: () => compareDialog(type, id, revisions[i + 1].id, r.id, `Changements de la version ${r.version}`) }, "Changements") : null,
          i > 0 ? h("button", { type: "button", class: "link-btn small", onclick: () => compareDialog(type, id, r.id, "current", `Version ${r.version} et version actuelle`) }, "Comparer à l'actuelle") : null,
          i > 0 && can("content.write") ? h("button", { type: "button", class: "link-btn small", onclick: async () => {
            if (isDirty() && !(await confirm({ title: "Modifications non enregistrées", message: "Elles seront perdues.", confirmLabel: "Continuer", danger: true }))) return;
            if (!(await confirm({ title: `Restaurer la version ${r.version} ?`, message: "Le contenu revient à cette version (le statut, la visibilité et l'adresse actuels sont conservés). Une nouvelle version est créée : rien n'est effacé de l'historique. Les programmations à venir s'appliqueront ensuite normalement (conflit si elles visent un élément restauré).", confirmLabel: "Restaurer" }))) return;
            try {
              const restored = await post(`/api/history/${type}/${id}/restore/${r.id}`);
              toast(`Version ${r.version} restaurée.`);
              onRestored?.(restored);
            } catch (error) {
              toast(errorMessage(error), "error");
            }
          } }, "Restaurer") : null)))) : h("p", { class: "muted" }, "Aucune version."));
    } catch (error) {
      replace(list, h("p", { class: "error-text" }, errorMessage(error)));
    }
  };
  details.addEventListener("toggle", () => { if (details.open) load(); });
  return h("section", { class: "card", "aria-labelledby": `hist-${type}-${id}` },
    h("div", { class: "card__head" }, h("h2", { id: `hist-${type}-${id}` }, "Historique"), h("p", {}, "Chaque enregistrement, programmation ou restauration crée une version.")),
    details);
}

/** Bandeau du mode « préparation » : formulaire affichant l'état prévu à une date. */
export function predictedBanner({ predicted, replaceId, exitHref }) {
  return h("div", { class: "card card--accent", role: "status" },
    h("p", {}, h("strong", {}, replaceId ? `Modification de la programmation n° ${replaceId}` : "Préparation d'une modification programmée"),
      ` — état prévu le ${formatLocal(predicted.atLocal)}`,
      predicted.included.length ? ` (programmations n° ${predicted.included.join(", n° ")} incluses)` : "", "."),
    predicted.skipped.length ? h("p", { class: "small", style: { color: "var(--amber)" } }, `Non incluses (bloquées ou en conflit) : n° ${predicted.skipped.map((s) => s.id).join(", n° ")}.`) : null,
    h("p", { class: "small muted" }, "Modifiez le formulaire puis « Programmer ces modifications » : seuls les éléments changés seront programmés. Rien n'est enregistré ni visible avant l'heure prévue."),
    h("div", { class: "actions" },
      h("a", { class: "btn btn--sm btn--ghost", href: previewAtUrl(predicted.atLocal), target: "_blank", rel: "noopener" }, icon("eye"), "Aperçu du site à cette date"),
      h("a", { class: "btn btn--sm btn--ghost", href: exitHref }, "Revenir à la fiche actuelle")));
}

/** Charge l'état prévu d'une fiche (à une date, ou à la date d'une programmation à modifier). */
export async function loadPredicted(type, id, query) {
  const changeId = Number(query.get("change")) || null;
  let at = query.get("at");
  if (!changeId && !at) return null;
  if (changeId) at = (await get(`/api/schedule/${changeId}`)).runAtLocal;
  return { ...(await get(`/api/schedule/predict/${type}/${id}${qs({ at })}`)), replaceId: changeId };
}

/**
 * Programmation depuis un formulaire createEditor (artistes, lieux) : bouton « Programmer… » dans la
 * barre d'enregistrement ; en mode préparation (predicted), il remplace « Enregistrer ».
 * Renvoie { schedule, banner, cards } (cartes de la colonne latérale).
 */
export function editorScheduling({ ed, type, id, model, toPayload, predicted, path }) {
  const schedule = async () => {
    if (!predicted && !ed.isDirty()) {
      const local = await askDate({ title: "Préparer une modification programmée", hint: "Le formulaire affichera l'état prévu à cette date (programmations déjà prévues incluses) : modifiez-le, puis « Programmer ces modifications »." });
      if (local) navigate(`${path}?at=${encodeURIComponent(local)}`);
      return;
    }
    scheduleChangesDialog({
      type, id, input: toPayload(model),
      basis: predicted ? predicted.basis : { mode: "current", version: model.version },
      replaceId: predicted?.replaceId || null,
      runAtLocal: predicted ? predicted.atLocal : null,
      title: predicted?.replaceId ? `Modifier la programmation n° ${predicted.replaceId}` : "Programmer ces modifications",
      onPredict: (local) => navigate(`${path}?at=${encodeURIComponent(local)}`, { force: true }),
      onDone: () => navigate(path, { force: true, replace: !predicted })
    });
  };
  if (can("content.publish")) {
    const btn = h("button", { type: "button", class: `btn ${predicted ? "btn--primary" : ""}`, onclick: schedule, title: "Appliquer ces modifications automatiquement à une date" }, icon("clock"), predicted ? "Programmer ces modifications" : "Programmer…");
    ed.bar.insertBefore(btn, ed.saveBtn);
  }
  if (predicted) ed.saveBtn.hidden = true;
  const prepare = (local) => navigate(`${path}?at=${encodeURIComponent(local)}`);
  return {
    schedule,
    banner: predicted ? predictedBanner({ predicted, replaceId: predicted.replaceId, exitHref: path }) : null,
    cards: predicted
      ? [pendingCard({ type, id, onPrepare: prepare })]
      : [pendingCard({ type, id, onPrepare: prepare }), historyCard({ type, id, isDirty: ed.isDirty, onRestored: () => navigate(path, { replace: true, force: true }) })]
  };
}
