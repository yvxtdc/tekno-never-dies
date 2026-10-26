/** Mise en ligne : ce qui va changer, lancement, journal détaillé, historique. */
import { h, replace } from "../lib/dom.js";
import { get, post } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, statusBadge, toast, errorMessage, confirm, busy, dialog } from "../lib/ui.js";
import { relative, formatDateTime } from "../lib/format.js";
import { can, isAdmin, session } from "../lib/session.js";
import { deploymentBadge, deploymentDetails } from "../lib/supervision.js";

const STAGES = { preparation: "préparation (Git)", export: "export des contenus", generation: "génération des pages", validation: "validation du site", commit: "commit", push: "envoi sur GitHub", done: "terminée" };

const MODES = {
  files: "Les fichiers du site sont écrits dans la copie de travail (mode développement : relisez puis committez-les vous-même).",
  commit: "Les fichiers du site sont écrits puis enregistrés dans un commit Git (à pousser ensuite).",
  push: "Les fichiers du site sont écrits, enregistrés dans un commit et envoyés sur GitHub, qui publie le site en quelques minutes (déploiement non suivi par le CMS : onglet Actions du dépôt)."
};

export async function publishView(ctx, main) {
  document.title = "Mise en ligne — Administration TND";
  replace(main, loadingState());
  let pending, history;
  try {
    [pending, history] = await Promise.all([get("/api/publications/pending"), get("/api/publications")]);
  } catch (error) {
    return replace(main, errorState(error, () => publishView(ctx, main)));
  }
  const logBox = h("div");
  const run = (force = false) => async (e) => {
    const btn = e.currentTarget;
    const ok = await confirm({
      title: force ? "Forcer la mise en ligne ?" : "Mettre le site en ligne ?",
      message: force
        ? `Les fichiers modifiés hors du CMS (${pending.drift.join(", ")}) seront remplacés par le contenu du CMS. Vérifiez avec l'équipe technique que rien d'important n'y a été ajouté.`
        : "Le site public sera régénéré avec les contenus publiés du CMS (fiches, agenda, traductions, plan du site), après une validation complète.",
      confirmLabel: force ? "Forcer et mettre en ligne" : "Mettre en ligne",
      danger: force
    });
    if (!ok) return;
    replace(logBox, h("div", { class: "card card--accent", role: "status" }, h("p", {}, "⏳ Mise en ligne en cours (validation complète du site, jusqu'à une minute)…")));
    await busy(btn, async () => {
      try {
        const result = await post("/api/publications", { force });
        toast(result.status === "success" ? result.summary : `Échec : ${result.summary}`, result.status === "success" ? "success" : "error", { timeout: 12000 });
        publishView(ctx, main).then(() => showLog(result, main.querySelector("#last-log")));
      } catch (error) {
        replace(logBox);
        toast(errorMessage(error), "error");
      }
    });
  };
  const running = history.running;
  // Déploiement GitHub Pages de la dernière mise en ligne réussie (suivi par le serveur, sans appel depuis cette page).
  const lastSent = history.items.find((p) => p.status === "success");
  const deployBox = h("div");
  const renderDeploy = (pub) => replace(deployBox, pub?.deployment?.status ? h("section", { class: `card ${pub.deployment.level === "error" ? "card--danger" : pub.deployment.level === "warning" ? "card--warn" : ""}` },
    h("div", { class: "card__head" }, h("h2", {}, "Site public"), h("p", {}, `Dernière mise en ligne réussie : ${formatDateTime(pub.finished_at)}`)),
    deploymentDetails(pub.deployment),
    pub.deployment.status !== "not_sent" && can("site.publish") ? h("div", { class: "actions", style: { marginTop: "10px" } }, h("button", { type: "button", class: "btn btn--sm", onclick: (e) => busy(e.currentTarget, async () => {
      try {
        const res = await post("/api/deployments/check", {});
        const fresh = res.items.find((d) => d.publicationId === pub.id);
        if (res.error) toast(res.error, "warn");
        if (fresh) renderDeploy({ ...pub, deployment: fresh });
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    }) }, "Vérifier maintenant")) : null,
    !history.deployTracking && pub.mode === "push" ? h("p", { class: "small muted" }, "Suivi des déploiements désactivé (CMS_DEPLOY_TRACKING=0).") : null) : null);
  renderDeploy(lastSent);
  replace(main,
    pageHead({ title: "Mise en ligne", subtitle: "Publier dans le CMS ne suffit pas : la mise en ligne régénère le site public avec tout ce qui est publié." }),
    h("div", { class: "split" },
      h("div", { class: "stack" },
        h("section", { class: `card ${pending.hasChanges ? "card--accent" : ""}` },
          h("div", { class: "card__head" }, h("h2", {}, pending.hasChanges ? "Modifications en attente" : "Le site est à jour"), pending.hasChanges ? statusBadge("running", "À mettre en ligne") : statusBadge("success", "À jour")),
          pending.hasChanges
            ? h("div", { class: "stack" },
                pending.events.length ? h("div", {}, h("p", {}, "Soirées modifiées depuis la dernière mise en ligne :"), h("ul", { class: "diff-list" }, pending.events.map((e) => h("li", {}, h("a", { href: `/admin/events/${e.id}` }, e.title), ` — ${relative(e.updated_at)}`)))) : null,
                pending.changed.length ? h("p", { class: "small muted" }, `Fichiers de données concernés : ${pending.changed.join(", ")}.`) : null,
                pending.missingMedia.length ? h("p", { class: "small muted" }, `${pending.missingMedia.length} image(s) optimisée(s) à copier dans le site.`) : null)
            : h("p", { class: "muted" }, `Rien de nouveau depuis ${pending.lastPublishedAt ? `la dernière mise en ligne (${relative(pending.lastPublishedAt)})` : "l'import des contenus"}. Vous pouvez quand même relancer une mise en ligne.`),
          pending.drift.length ? h("div", { class: "form-errors" }, h("strong", {}, "Fichiers modifiés hors du CMS : "), pending.drift.join(", "),
            h("p", { class: "small", style: { margin: "6px 0 0" } }, "Quelqu'un a modifié ces fichiers directement dans le dépôt. La mise en ligne est bloquée pour ne pas écraser ce travail : reportez ces changements dans le CMS, ou demandez à un administrateur de forcer.")) : null,
          h("div", { class: "actions", style: { marginTop: "12px" } },
            can("site.publish") ? h("button", { type: "button", class: "btn btn--primary", disabled: running, onclick: run(false) }, icon("publish"), running ? "Mise en ligne en cours…" : "Mettre en ligne") : null,
            pending.drift.length && isAdmin() ? h("button", { type: "button", class: "btn btn--danger", onclick: run(true) }, "Forcer la mise en ligne") : null,
            h("a", { class: "btn btn--ghost", href: "/preview/site/", target: "_blank", rel: "noopener" }, icon("eye"), "Aperçu du site")),
          logBox),
        deployBox,
        h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Historique")),
          history.items.length
            ? h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
                h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Par"), h("th", {}, "Résultat"), h("th", {}, "Site public"), h("th", {}, h("span", { class: "sr-only" }, "Journal")))),
                h("tbody", {}, history.items.map((p) => h("tr", {},
                  h("td", { "data-label": "Date" }, formatDateTime(p.started_at)),
                  h("td", { "data-label": "Par" }, p.trigger === "schedule" ? "Programmation" : p.trigger === "cli" ? "Ligne de commande" : p.user_name || "—"),
                  h("td", { class: "title-col" }, statusBadge(p.status, { success: "Réussie", failed: "Échouée", running: "En cours" }[p.status]),
                    p.status === "failed" && p.stage ? h("div", { class: "small", style: { color: "var(--red)" } }, `Étape : ${STAGES[p.stage] || p.stage}`) : null, h("div", { class: "small muted" }, p.summary)),
                  h("td", { "data-label": "Site public" }, deploymentBadge(p.deployment) || h("span", { class: "muted" }, "—")),
                  h("td", {}, h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: async () => showLog(await get(`/api/publications/${p.id}`)) }, "Journal")))))))
            : h("p", { class: "muted" }, "Aucune mise en ligne depuis le CMS."),
          h("div", { id: "last-log" }))),
      h("div", { class: "split__side" },
        h("section", { class: "card" }, h("h2", {}, "Comment ça marche ?"),
          h("ol", { class: "small", style: { paddingLeft: "18px", margin: "10px 0 0", display: "grid", gap: "6px" } },
            h("li", {}, "Les contenus publiés du CMS sont exportés dans les fichiers de données du site, avec les images optimisées."),
            h("li", {}, "Les outils du site régénèrent les fiches soirées, l'agenda, les plans, les pages allemandes et anglaises et le plan du site."),
            h("li", {}, "Le site est validé (liens, images, pages). En cas d'erreur, rien n'est mis en ligne et le site reste dans son dernier état."),
            h("li", {}, MODES[session.publishMode] || MODES.files)),
          h("p", { class: "small muted", style: { marginTop: "10px" } }, "Les modifications programmées (", h("a", { href: "/admin/schedule" }, "Programmations"), ") sont appliquées à l'heure prévue, puis mises en ligne automatiquement. Une programmation n'est « Envoyée sur GitHub » qu'après une mise en ligne réussie qui l'inclut ; GitHub Pages publie ensuite le site en quelques minutes, sans que le CMS le vérifie (onglet Actions du dépôt).")))));
  // Lien direct vers le journal d'une mise en ligne (depuis le tableau de santé).
  const asked = Number(ctx.query.get("publication"));
  if (asked) get(`/api/publications/${asked}`).then((p) => showLog(p)).catch((error) => toast(errorMessage(error), "error"));
}

function showLog(p, container) {
  const v = p.validation;
  const body = h("div", { class: "stack" },
    h("p", {}, statusBadge(p.status, { success: "Réussie", failed: "Échouée", running: "En cours" }[p.status]), " ", p.summary),
    p.status === "failed" && p.stage ? h("p", { class: "form-errors" }, `Échec à l'étape « ${STAGES[p.stage] || p.stage} ».`) : null,
    p.commit_sha ? h("p", { class: "small muted" }, `Commit ${p.commit_sha.slice(0, 7)}`) : null,
    p.deployment?.status ? deploymentDetails(p.deployment) : null,
    v ? h("div", { class: "small" },
      h("strong", {}, v.ok ? `Validation du site : sans erreur (${v.files} fichiers, ${v.pages} pages)` : `Validation du site : ${v.errors.length} erreur(s) bloquante(s)`),
      v.errors.length ? h("ul", {}, v.errors.slice(0, 30).map((e) => h("li", { style: { color: "var(--red)" } }, e))) : null,
      v.warnings.length ? h("details", {}, h("summary", { style: { cursor: "pointer" } }, `${v.warnings.length} point(s) « à compléter » (avertissements, non bloquants)`), h("ul", {}, v.warnings.map((w) => h("li", {}, w)))) : null) : null,
    h("pre", { class: "log" }, p.log || "(journal vide)"));
  if (container) replace(container, h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", {}, "Dernière mise en ligne"), body));
  else dialog({ title: `Mise en ligne du ${formatDateTime(p.started_at)}`, wide: true, body });
}
