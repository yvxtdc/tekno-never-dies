/** Tableau de bord : ce qui demande de l'attention, prochaines soirées, mise en ligne, activité. */
import { h, replace } from "../lib/dom.js";
import { get } from "../lib/api.js";
import { icon, loadingState, errorState, statusBadge, pageHead } from "../lib/ui.js";
import { shortDay, relative, formatDate, plural } from "../lib/format.js";
import { session, can } from "../lib/session.js";

const ACTIONS = {
  "event.create": "a créé la soirée", "event.update": "a modifié la soirée", "event.publish": "a publié", "event.schedule": "a programmé",
  "event.cancel": "a annulé", "event.unpublish": "a dépublié", "event.archive": "a archivé", "event.restore": "a restauré", "event.duplicate": "a dupliqué",
  "event.delete": "a supprimé la soirée", "artist.create": "a ajouté l'artiste", "artist.update": "a modifié l'artiste", "artist.merge": "a fusionné",
  "venue.create": "a ajouté le lieu", "venue.update": "a modifié le lieu", "media.upload": "a importé", "media.replace": "a remplacé l'image",
  "media.delete": "a supprimé l'image", "site.publish": "a mis le site en ligne", "site.publish.failed": "mise en ligne échouée :",
  "faq.create": "a ajouté la question", "faq.update": "a modifié la question", "team.update": "a modifié la fiche équipe de",
  "album.photos": "a modifié l'album", "translation.update": "a traduit", "user.create": "a créé le compte", "backup.create": "a sauvegardé la base",
  "event.published.scheduled": "Publication programmée :", import: "a importé les contenus existants du site :"
};

export async function dashboardView(ctx, main) {
  document.title = "Tableau de bord — Administration TND";
  replace(main, pageHead({ title: `Salut ${session.user.name}`, subtitle: "Ce qui se passe sur le site de Tekno Never Dies." }), loadingState());
  let data;
  try {
    data = await get("/api/dashboard");
  } catch (error) {
    return replace(main, errorState(error, () => dashboardView(ctx, main)));
  }
  const { counts, upcoming, pending, lastPublication, drift } = data;

  const publishCard = h("section", { class: `card ${pending.hasChanges || drift.length ? "card--accent" : ""}`, "aria-labelledby": "pub-title" },
    h("div", { class: "card__head" }, h("h2", { id: "pub-title" }, "Site public"),
      pending.hasChanges ? h("span", { class: "badge badge--running" }, "Modifications en attente") : h("span", { class: "badge badge--success" }, "À jour")),
    pending.hasChanges
      ? h("p", {}, `Des modifications ne sont pas encore en ligne${pending.events.length ? ` (${pending.events.slice(0, 3).map((e) => e.title).join(", ")}${pending.events.length > 3 ? "…" : ""})` : ""}.`)
      : h("p", { class: "muted" }, "Tout ce qui est publié dans le CMS est en ligne."),
    drift.length ? h("p", { class: "error-text" }, `Fichiers modifiés hors du CMS : ${drift.join(", ")}.`) : null,
    lastPublication ? h("p", { class: "small muted" }, `Dernière mise en ligne ${relative(lastPublication.finished_at || lastPublication.started_at)} — `, statusBadge(lastPublication.status, { success: "réussie", failed: "échouée", running: "en cours" }[lastPublication.status])) : h("p", { class: "small muted" }, "Aucune mise en ligne depuis le CMS pour l'instant."),
    can("site.publish") ? h("a", { class: `btn ${pending.hasChanges ? "btn--primary" : ""}`, href: "/admin/publish" }, icon("publish"), "Mettre en ligne") : null);

  const upcomingCard = h("section", { class: "card", "aria-labelledby": "next-title" },
    h("div", { class: "card__head" }, h("h2", { id: "next-title" }, "Prochaines soirées"), h("a", { class: "btn btn--sm", href: "/admin/events/new" }, icon("plus"), "Nouvelle soirée")),
    upcoming.length
      ? upcoming.map((ev) => {
          const d = shortDay(ev.date);
          return h("a", { class: "event-row", href: `/admin/events/${ev.id}` },
            h("span", { class: "event-row__date", "aria-hidden": "true" }, h("b", {}, d.day), h("span", {}, d.month)),
            h("span", {},
              h("span", { class: "event-row__title" }, ev.title),
              h("span", { class: "small muted", style: { display: "block" } }, [formatDate(ev.date, { weekday: true }), ev.venue, plural(ev.lineupCount, "artiste", "artistes")].filter(Boolean).join(" · ")),
              ev.errors || ev.warnings ? h("span", { class: "small", style: { display: "block", color: ev.errors ? "var(--red)" : "var(--amber)" } }, ev.errors ? plural(ev.errors, "erreur à corriger", "erreurs à corriger") : plural(ev.warnings, "point à vérifier", "points à vérifier")) : null),
            statusBadge(ev.status, ev.statusLabel));
        })
      : h("p", { class: "muted" }, "Aucune soirée à venir n'est encore créée."));

  const quality = [
    counts.drafts ? [`${plural(counts.drafts, "brouillon", "brouillons")} de soirée`, "/admin/events?status=draft"] : null,
    counts.scheduled ? [`${plural(counts.scheduled, "soirée programmée", "soirées programmées")}`, "/admin/events?status=scheduled"] : null,
    counts.artistsNoPhoto ? [`${plural(counts.artistsNoPhoto, "artiste sans photo", "artistes sans photo")}`, "/admin/artists?missing=photo"] : null,
    counts.mediaNoAlt ? [`${plural(counts.mediaNoAlt, "image importée sans texte alternatif", "images importées sans texte alternatif")}`, "/admin/media?usage=noalt"] : null,
    counts.translationsMissing ? [`${plural(counts.translationsMissing, "texte à traduire", "textes à traduire")} (allemand / anglais)`, "/admin/translations?missing=any"] : null
  ].filter(Boolean);

  const activity = h("section", { class: "card", "aria-labelledby": "act-title" },
    h("div", { class: "card__head" }, h("h2", { id: "act-title" }, "Activité récente"), can("audit.read") ? h("a", { class: "btn btn--sm btn--ghost", href: "/admin/audit" }, "Tout le journal") : null),
    data.activity.length
      ? h("ul", { class: "activity" }, data.activity.map((a) => h("li", {},
          h("span", {}, h("strong", {}, a.user_name || "Le CMS"), ` ${ACTIONS[a.action] || a.action} `, a.summary ? h("span", { class: "muted" }, a.summary) : null),
          h("time", { datetime: a.created_at }, relative(a.created_at)))))
      : h("p", { class: "muted" }, "Rien pour l'instant."));

  replace(main,
    pageHead({ title: `Salut ${session.user.name}`, subtitle: "Ce qui se passe sur le site de Tekno Never Dies.",
      actions: [h("a", { class: "btn btn--primary", href: "/admin/events/new" }, icon("plus"), "Nouvelle soirée"), h("a", { class: "btn", href: "/admin/media" }, icon("image"), "Importer des images")] }),
    h("div", { class: "grid grid--stats", style: { marginBottom: "16px" } },
      h("a", { class: "stat", href: "/admin/events?period=upcoming" }, h("div", { class: "stat__value" }, String(counts.upcoming)), h("div", { class: "stat__label" }, "soirées à venir en ligne")),
      h("a", { class: "stat", href: "/admin/events" }, h("div", { class: "stat__value" }, String(counts.events)), h("div", { class: "stat__label" }, "soirées dans le CMS")),
      h("a", { class: "stat", href: "/admin/artists" }, h("div", { class: "stat__value" }, String(counts.artists)), h("div", { class: "stat__label" }, "artistes")),
      h("a", { class: "stat", href: "/admin/venues" }, h("div", { class: "stat__value" }, String(counts.venues)), h("div", { class: "stat__label" }, "lieux")),
      h("a", { class: "stat", href: "/admin/media" }, h("div", { class: "stat__value" }, String(counts.media)), h("div", { class: "stat__label" }, "images"))),
    h("div", { class: "split" },
      h("div", { class: "stack" }, upcomingCard, activity),
      h("div", { class: "split__side" },
        publishCard,
        h("section", { class: "card", "aria-labelledby": "todo-title" },
          h("div", { class: "card__head" }, h("h2", { id: "todo-title" }, "À compléter")),
          quality.length ? h("ul", { class: "checklist" }, quality.map(([text, href]) => h("li", {}, h("a", { href }, text)))) : h("ul", { class: "checklist" }, h("li", { class: "is-ok" }, "Rien à signaler.")),
          session.user.role === "admin" ? h("p", { class: "small muted", style: { marginTop: "12px" } }, data.lastBackupAt ? `Dernière sauvegarde de la base : ${relative(data.lastBackupAt)}.` : "Aucune sauvegarde de la base pour l'instant.") : null))));
}
