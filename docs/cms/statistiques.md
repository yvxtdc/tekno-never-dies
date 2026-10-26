# CMS Tekno Never Dies — statistiques (GoatCounter)

Le site compte déjà ses visites avec **GoatCounter**, sans cookie (`js/partials.js`, page
Confidentialité). Il compte aussi les clics suivis comme « événements » GoatCounter :
- billetterie ;
- ajout à l'agenda ;
- itinéraire ;
- partage ;
- DJ Contest ;
- Instagram, e-mail…

Ces clics sont envoyés par `track()` (`js/pages/helpers.js`).

L'onglet **Statistiques** du CMS lit ces chiffres par l'API de GoatCounter, côté serveur. Aucun
deuxième système de comptage n'est ajouté, et rien n'est modifié sur le site public.

## Mise en service

1. Dans GoatCounter (`https://teknoneverdies.goatcounter.com`) : nom d'utilisateur → **API** →
   créer un jeton qui n'a **que** la permission de lecture des statistiques.
2. Sur le serveur du CMS, dans `cms/.env` (jamais versionné) : `CMS_GOATCOUNTER_TOKEN=<jeton>`.
   Facultatif : `CMS_GOATCOUNTER_URL` (déduite de `js/data/site.js`) et `CMS_STATS_SINCE=AAAA-MM-JJ`
   (début du comptage, sinon détecté automatiquement).
3. Redémarrer le service.

Sans jeton, l'onglet l'explique et renvoie vers le tableau de bord GoatCounter. Il n'affiche aucun
chiffre.

Le jeton reste côté serveur : il n'est jamais envoyé au navigateur ni écrit dans une réponse. Les
réponses ne contiennent que des totaux agrégés : aucun visiteur, aucune adresse, aucun identifiant.

## Ce qui est affiché

| Indicateur | Source |
|---|---|
| Visites des pages, interactions suivies | `/api/v0/stats/total` (total moins interactions ; interactions = « événements » GoatCounter) |
| Visites par jour (graphique, table jour par jour) | `/api/v0/stats/hits` (pages seulement) |
| Pages les plus consultées | `/api/v0/stats/hits` |
| Soirées : visites de la fiche, clics par type | pages `/evenement-<adresse>.html` ; clics « Billetterie · <adresse> », « Ajouter à l'agenda · … », « Itinéraire · … », « Partager · … », « DJ Contest · … » (voir ci-dessous) |
| Provenance des visites | `/api/v0/stats/toprefs` |
| Comparaison avec la période précédente | même durée, juste avant |

Les périodes disponibles sont les 7, 30 ou 90 derniers jours, ou une période choisie (366 jours au
plus), découpées en jours à l'heure de Paris. Les unités sont celles de GoatCounter : le CMS reprend
ses compteurs sans les recalculer.

## Fiabilité

- **Indisponible n'est pas zéro.** Une section dont la lecture échoue est affichée « Indisponible »
  avec le motif : délai dépassé (10 s), jeton refusé, limite d'appels (4 par seconde), réponse
  inattendue. Dans une réponse réussie, une page ou un clic absent vaut réellement 0.
- **Cache et panne.** Le cache dure 10 minutes. Si GoatCounter ne répond pas, la dernière réponse
  complète de la période est affichée et signalée comme ancienne. Aucune consultation n'est bloquée.
- **Comparaison.** Elle n'est faite que si GoatCounter comptait déjà au début de la période
  précédente. Le premier jour compté est détecté sur 3 ans, ou fixé par `CMS_STATS_SINCE`.
- **Attribution à une soirée : par son adresse.** Le site nomme chaque clic lié à une soirée
  « Catégorie · <adresse de la fiche> » (ex. « Billetterie · ice-boiler-v2-2026 »), avec le titre comme
  libellé lisible dans GoatCounter (`trackEvent`, `js/pages/helpers.js`). L'adresse est l'identifiant
  stable d'une soirée sur le site, et elle est unique : une adresse, même ancienne, ne peut pas être
  reprise par une autre soirée. Les visites et les clics sont rattachés par cette adresse ou par ses
  anciennes adresses (`event_redirects`) : une soirée renommée garde toutes ses statistiques, et deux
  soirées de même titre restent séparées.
- **Clics enregistrés avant ce format (« Catégorie · <titre> »).** Rien n'est supprimé. Ils restent
  lus, et sont attribués seulement si **une seule** soirée porte ou a porté ce titre (titres de son
  historique de versions compris). La fiche indique combien de clics viennent de cet ancien format.
  Un titre partagé par plusieurs soirées ou inconnu, ou un titre identique à l'adresse d'une autre
  soirée, est listé « non attribué » avec la raison : jamais réparti au hasard.
- **Nom d'une soirée supprimée, repris ensuite.** La base enregistre, pour chaque soirée, chaque adresse
  et chaque titre qu'elle a portés, avec la date à laquelle elle les a pris (table `event_names`, tenue
  par des déclencheurs SQL, donc vraie pour toute écriture). Un nom ne compte pour une soirée qu'à partir
  de cette date (détail jour par jour de GoatCounter). Les jours antérieurs, par exemple ceux d'une
  soirée supprimée dont l'adresse ou le titre a été repris, sont listés « non attribués ».

  Les noms déjà portés lors de la migration 006 n'ont pas de date : tout leur historique revient à la
  soirée qui les porte, comme avant. La base n'a pas d'historique fiable antérieur à cette migration
  (l'import initial ne crée pas de versions).
- **Unicité des adresses.** Une adresse, actuelle ou ancienne, n'appartient qu'à une soirée. Le
  formulaire le contrôle, et des déclencheurs SQL (migration 006) le garantissent pour toute écriture.
  Une soirée supprimée libère ses adresses : le point précédent évite alors toute attribution erronée.
- **Historique.** Les clics ne sont comptés que depuis leur mise en place sur le site : rien n'est
  reconstitué. Pour une soirée publiée dans le CMS après l'import initial, la date de publication est
  indiquée.
- **Pas de doublon côté site.** Chaque clic suivi passe par un seul écouteur (`js/partials.js`) ou un
  seul bouton (`js/pages/evenement.js`). Côté CMS, une page renvoyée deux fois par la pagination de
  GoatCounter n'est comptée qu'une fois.

## Limites

- Plus de 500 pages ou clics différents sur une période : seuls les 500 premiers sont détaillés.
  Les totaux restent exacts.
- Les autres analyses (navigateurs, pays, campagnes…) restent consultables dans le tableau de bord
  GoatCounter.
