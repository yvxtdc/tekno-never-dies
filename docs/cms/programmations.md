# CMS Tekno Never Dies — programmations ciblées

Programmer une modification précise d'un contenu (publication d'une soirée, nouveau line-up, prix,
infos pratiques, fiche d'artiste, membre de l'équipe, question de la FAQ…) pour qu'elle s'applique
automatiquement à une date et une heure données, **sans écraser les autres modifications**, même
quand plusieurs programmations visent la même soirée, la même page ou le même fichier généré.

Code : `cms/server/services/schedule.mjs` (règles), `schedule-targets.mjs` (contenus et champs
programmables), `api/schedule.mjs` (routes), `publish/scheduler.mjs` (exécution),
`admin/js/lib/schedule.js` et `admin/js/views/schedule.js` (interface). Tests :
`cms/test/schedule.test.mjs`.

## 1. Utilisation

| Je veux… | Dans l'administration |
|---|---|
| Publier une nouvelle soirée à 18 h | Créer la soirée (brouillon), puis carte **Publication → Programmer…**. Elle reste invisible (statut « Programmé ») jusqu'à l'heure dite. |
| Changer un prix, un horaire, le line-up, les infos pratiques… plus tard | Modifier le formulaire, puis **Programmer…** (barre du bas) au lieu d'**Enregistrer** : le dialogue montre exactement les éléments qui changeront (avant → programmé). Le formulaire revient ensuite à l'état actuel. |
| Préparer une modification qui suit une autre déjà programmée (prix à 18 h, puis autre prix à 20 h) | Carte **Programmations → Préparer l'état à une date…** (ou **Programmer…** sans rien modifier) : le formulaire affiche l'état prévu à cette date, programmations antérieures incluses. Modifier, puis **Programmer ces modifications**. |
| Annuler, retirer ou archiver une soirée à une date | Carte **Publication → Programmer un changement de statut…** |
| Ajouter un membre de l'équipe (ou une question) à une date | **Équipe → Nouveau membre → Ajouter masqué et programmer l'affichage…** |
| Voir tout ce qui est prévu | Menu **Programmations** : filtres (à venir, à traiter, appliquées, en ligne, annulées), type de contenu, **Aperçu à une date** (le site tel qu'il sera). |
| Changer la date, le contenu, annuler, exécuter maintenant | **Détails** d'une programmation (vue Programmations, carte de la fiche, tableau de bord). |
| Résoudre un conflit | **Résoudre** : valeurs de référence, actuelle et programmée ; **Imposer la valeur programmée** ou **Garder la valeur actuelle (annuler)**. |
| Comprendre ce qui a changé | Carte **Historique** de la fiche : chaque version (saisie, programmation n°…, restauration, statut), champs modifiés, **Changements**, **Comparer à l'actuelle**, **Restaurer**. |

Dates saisies et affichées à l'**heure de Paris**, stockées en UTC. Au passage à l'heure d'été, de
2 h à 3 h n'existe pas : la saisie est refusée. Au passage à l'heure d'hiver, de 2 h à 3 h existe deux
fois : la première (heure d'été, UTC+2) est retenue et signalée.

Droits : programmer, déplacer, annuler, résoudre = permission `content.publish` (administrateurs et
éditeurs, comme la publication d'une soirée) ; consulter = `content.read` ; restaurer une version =
`content.write`. Toutes les vérifications sont faites par le serveur.

## 2. Ce qui est programmable

| Contenu | Éléments |
|---|---|
| Soirée | tous les champs du formulaire (nom, date, horaires, lieu, prix, tarifs, billetterie, visuels, styles, résumé, infos pratiques, liens, « La soirée », album, SEO, DJ Contest) ; **chaque passage du line-up** (ajout, retrait, artistes, horaires, nom affiché, style, ordre) ; **statut** (publication, annulation, retrait, archivage) |
| Artiste | nom, photo, styles, origine, biographie, liens, artiste mystère, archivage |
| Lieu | nom, libellé, adresse, ville, coordonnées, plan, description, accès, site, capacité, archivage |
| Membre de l'équipe | nom, rôle, photo, missions, détails, présentation, **affichage sur le site** |
| Question (FAQ) | question, réponse, catégorie, « à faire valider », **affichage sur le site** |

Ne se programment pas (à enregistrer directement) : l'adresse (`slug`) d'une fiche, les notes et
contacts internes, la galerie photo, les traductions, les pages institutionnelles et textes
d'interface (ils sont dans le code, voir [architecture.md](architecture.md)). La suppression
définitive n'est pas programmable : on programme un **retrait du site** (archivage, masquage), la
suppression reste une action manuelle d'administrateur.

## 3. Représentation d'une programmation

Une ligne de `scheduled_changes` (migration `005_programmations.sql`) : contenu visé (type,
identifiant, **génération** du contenu), date d'exécution (UTC), statut… La génération est un numéro
attribué par la base à la création de chaque contenu (table `content_generations` en `AUTOINCREMENT`,
déclencheurs SQL sur chaque table, colonne `generation` immuable) : SQLite peut réutiliser l'identifiant
d'un contenu supprimé, jamais sa génération. Une programmation, ses chaînes, ses dépendances et
l'historique ne concernent que le contenu de même identifiant **et** de même génération ; une ancienne
programmation échoue au lieu de modifier un nouveau contenu (la date de création ne suffisait pas : deux
contenus peuvent être créés dans la même milliseconde). Elle garde aussi les dépendances, l'auteur, le résultat, la version de
référence, la révision produite et la mise en ligne qui l'a publiée. Chaque événement (création,
modification, déplacement, conflit, application, mise en ligne, échec…) est écrit dans
`scheduled_change_log`.

Les modifications sont une **liste de changements par clé**, jamais une copie de la fiche :

```json
[
  { "key": "price", "kind": "field", "base": "10 €", "from": "10 €", "to": "12 €" },
  { "key": "slot:3fa29c1e0b7d4a55", "kind": "slot-add", "to": { "artistIds": [12], "startTime": "23:00", … }, "after": "9c01…" },
  { "key": "slot:9c01aa52e4f0b311:startTime", "kind": "slot-field", "base": "22:00", "from": "22:00", "to": "22:30" },
  { "key": "order:9c01aa52e4f0b311", "kind": "slot-order", "to": "3fa2…" },
  { "key": "status", "kind": "status", "base": "scheduled", "from": "scheduled", "to": "published" }
]
```

- Les clés possibles sont une **liste fermée** par type de contenu (`schedule-targets.mjs`). Les
  valeurs sont validées par le **même code que l'enregistrement** du formulaire, à la programmation
  (dans une transaction annulée) puis de nouveau à l'exécution.
- Chaque passage du line-up a un identifiant stable (`lineup_slots.uid`), conservé d'un enregistrement
  à l'autre : une programmation vise un passage précis, les autres passages sont préservés.
- `base` : valeur vue à la préparation ; `from` : valeur attendue juste avant l'exécution (voir 4) ;
  `to` : valeur programmée.

## 4. Règles d'exécution, de conflit et d'ordre

**Chaîne par clé.** Les programmations ouvertes qui visent une même clé sont ordonnées par date puis
par numéro. Pour chacune, `from` = `to` de la précédente (ou la valeur vue à la préparation pour la
première). Deux prix programmés à 18 h puis 20 h s'enchaînent donc sans faux conflit ; insérer,
déplacer ou annuler une programmation recalcule la valeur attendue de la suivante.

**À l'échéance**, pour chaque clé, sur l'état **le plus récent** de la fiche :

| Valeur actuelle | Résultat |
|---|---|
| = `from` | la valeur programmée est écrite |
| = `to` | déjà en place : rien à écrire (relance sans effet) |
| autre valeur (modifiée à la main entre-temps) | **conflit** : rien n'est écrit pour toute la programmation ; intervention demandée |

Les champs non visés, les autres passages du line-up et les autres contenus ne sont jamais réécrits.
Une programmation dont un passage visé a été retiré entre-temps, ou dont la transition de statut est
devenue impossible, passe en conflit « impossible à appliquer » (non forçable : la modifier ou
l'annuler).

**Préparation sur un état périmé.** Préparée sur l'état *actuel*, une programmation qui modifierait
une clé déjà visée par une programmation *antérieure* est refusée (409) : il faut la préparer sur
l'**état prévu** à sa date (sinon elle annulerait silencieusement la précédente). Une programmation
insérée *avant* une autre sur la même clé est acceptée avec un avertissement : la suivante
s'appliquera après elle (ordre explicite, résultat déterministe).

**Dépendances** (enregistrées dans `depends_on`, affichées partout) :
- la mise en ligne programmée d'un contenu encore invisible, si elle est prévue avant (ex. line-up
  modifié à 19 h d'une soirée publiée à 18 h) ;
- l'ajout programmé d'un passage, pour une programmation qui modifie ce passage ;
- implicitement, la programmation précédente sur la même clé.

Une programmation n'est jamais exécutée avant ses dépendances (elle attend, avec le motif). Si une
dépendance est en échec, en conflit, bloquée ou **annulée**, elle passe **Bloquée** (rien n'est
écrit) ; quand la dépendance est résolue (imposée, réessayée), elle redevient **Programmée**
automatiquement. Annuler une programmation dont d'autres dépendent propose de les annuler aussi.

**Contenu supprimé.** Ses programmations ouvertes passent en **Échec** (« supprimé : rien n'a été
modifié »). Une soirée « Programmée » dont on change le statut à la main (dépublier, archiver) perd sa
mise en ligne programmée : elle ne peut pas réapparaître. Une soirée archivée à la main avant un
retrait programmé donne un conflit, jamais un retour en arrière.

**Enregistrer un formulaire ouvert avant une programmation** : fusion champ par champ avec la version
de départ du formulaire (`mergeStale`) : un champ modifié seulement par la programmation est conservé
(message « modifié entre-temps et conservé ») ; un champ modifié des deux côtés est refusé (409) avec
la liste des champs.

## 5. États

| État | Signification |
|---|---|
| Programmée (`pending`) | en attente de son heure ou d'une dépendance |
| Appliquée (`applied`) | modification faite dans la base du CMS ; mise en ligne à faire (automatique) |
| Envoyée, déploiement en cours / Déployée / Envoyée, déploiement échoué… (`published`, mode `push`) | incluse dans une mise en ligne réussie et poussée sur GitHub ; la suite dépend du déploiement GitHub Pages de ce commit, suivi par le CMS (voir ci-dessous) |
| Commitée, non envoyée / Fichiers générés (`published`, modes `commit` / `files`) | mise en ligne réussie localement seulement : **rien n'est visible sur le site public** |
| Conflit (`conflict`) | élément modifié entre-temps, ou modification devenue impossible |
| Bloquée (`blocked`) | dépendance en échec, en conflit, bloquée ou annulée |
| Échec (`failed`) | contenu supprimé, données devenues invalides (lieu ou image supprimés…), ou 3 erreurs inattendues de suite |
| Annulée (`cancelled`) | annulée, ou remplacée par un changement de statut manuel |

Le brouillon (fiche enregistrée non publiée), le contenu publié dans le CMS, le site en ligne et les
programmations restent distincts : une programmation n'est visible nulle part sur le site avant
d'être appliquée **et** mise en ligne.

**Déploiement.** Le dernier maillon, le déploiement par GitHub Actions vers GitHub Pages, est suivi
par le CMS pour le commit exact envoyé (API GitHub en lecture, [supervision.md](supervision.md) § 1).
Une programmation est « Déployée » seulement quand GitHub a confirmé le déploiement de ce commit, ou
d'un commit plus récent qui le contient. Sinon, son libellé dit où en est la chaîne : en cours, échoué,
annulé, écrasé, ou inconnu si GitHub ne répond pas. En mode `push`, une mise en ligne n'est réussie
que si la branche locale n'a plus aucun commit à envoyer : un commit dont l'envoi avait échoué part
avec la mise en ligne suivante, même sans nouveau changement.

## 6. Exécution fiable

- Le planificateur du serveur (`npm run cms`, `CMS_SCHEDULER=1` par défaut) vérifie chaque minute et
  au démarrage : une échéance passée pendant un arrêt est rattrapée (avec la mention du retard). Aucun
  minuteur dans le navigateur : rien ne dépend d'une personne connectée.
- Chaque programmation s'exécute dans **une transaction** (`BEGIN IMMEDIATE`) qui vérifie d'abord
  qu'elle est encore « Programmée » : relancée, ou lancée par deux processus, elle ne s'applique
  qu'une fois ; une erreur annule tout (pas d'application partielle).
- Erreur de validation : **Échec** définitif avec le motif. Erreur inattendue (base occupée…) :
  nouvel essai à la minute suivante, au plus 3 fois.
- Après application, le planificateur lance la **mise en ligne** tant que des programmations
  appliquées ne sont pas en ligne (`CMS_AUTO_PUBLISH_SCHEDULED=1`), avec de nouveaux essais espacés en
  cas d'échec (5, 10, 20, 40 puis 60 minutes). Sans mise en ligne automatique, elles attendent la
  prochaine mise en ligne manuelle.

## 7. Génération et déploiement : pas de version obsolète

- Une mise en ligne exporte toujours **l'état complet et à jour** de la base (jamais un fichier
  préparé à l'avance) : une programmation qui ne modifie qu'un passage du line-up régénère tout
  `events.js`, mais avec toutes les autres données à jour.
- **Une seule mise en ligne à la fois**, y compris entre le serveur et la ligne de commande (verrou en
  base `publish.lock`, renouvelé à chaque étape, expiré après 15 minutes sans nouvelles).
- L'export et la liste des programmations qu'il contient sont lus dans la même transaction : une
  programmation appliquée pendant une mise en ligne n'est pas marquée « envoyée » par celle-ci ; la
  suivante la publiera.
- Mode `push` : la mise en ligne n'envoie que des commits du CMS. Un `git push` envoie tous les commits
  locaux de la branche : si la copie du serveur en contient un qui ne vient pas du CMS (autre auteur ou
  committer, fusion, fichier hors des chemins gérés), la mise en ligne s'arrête avant l'export, sans rien
  envoyer ni supprimer, et le journal liste ces commits (à faire relire et pousser, ou retirer, par
  l'équipe technique). Les commits du CMS restés en attente après un envoi refusé partent tous avec la
  mise en ligne suivante.
- Côté Git : fast-forward uniquement, commits linéaires ; côté GitHub, `deploy-pages.yml` a
  `concurrency: pages` avec `cancel-in-progress` : un déploiement plus ancien est annulé par le plus
  récent et ne peut pas le remplacer.

## 8. Aperçu

- **Aperçu à une date** (`/preview/at-<secondes>/`) : le vrai site public tel qu'il sera à cette
  date, programmations prévues d'ici là appliquées dans une transaction **toujours annulée** (rien
  n'est modifié ni exécuté, et rien n'est visible sur le site public).
- Formulaire en mode préparation (`?at=…`, `?change=n°`) : même mécanisme, pour une fiche.

## 9. Historique

`revisions` garde chaque version (200 dernières par fiche) avec son origine (`manual`, `schedule`,
`restore`, `status`), la programmation associée (`change_id`) et les champs modifiés. Comparer deux
versions et restaurer (nouvelle version ; rien n'est effacé, statut et visibilité actuels conservés).
Les versions d'un contenu supprimé dont l'identifiant a été réutilisé ne sont pas mélangées
(filtre sur la génération). Versions antérieures à la migration : rattachées seulement si c'est sûr
(date de création identique dans la copie enregistrée quand elle y figure ; version postérieure à la
création, ou version 1 seule dans la milliseconde de création) ; une version ambiguë reste en base sans
être rattachée : ni listée, ni comparée, ni restaurable sur un contenu.

## 10. En cas de problème

| Symptôme | Que faire |
|---|---|
| Programmation en **Conflit** | **Résoudre** : imposer la valeur programmée, ou garder la valeur actuelle (annule la programmation). |
| **Bloquée** | Ouvrir la dépendance indiquée et la résoudre (elle se débloque seule), ou annuler. |
| **Échec** | Lire le motif ; corriger les données (image, lieu…) puis **Réessayer**, ou modifier / annuler. |
| **Appliquée** depuis longtemps | Mise en ligne en échec : voir **Mise en ligne** (journal), corriger (fichiers modifiés hors CMS, validation), relancer. |
| Rien ne s'exécute | Le service tourne-t-il (`systemctl status tnd-cms`) ? `CMS_SCHEDULER` n'est-il pas à 0 ? Journal : `journalctl -u tnd-cms`. |
| Restauration d'une sauvegarde | Les programmations sont dans la base : elles reviennent dans l'état de la sauvegarde ; celles arrivées à échéance depuis s'exécutent au redémarrage (avec conflit si la base restaurée diffère). Vérifier la vue **Programmations** après une restauration. |
