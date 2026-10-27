# CMS Tekno Never Dies — supervision, contrôle avant publication et suivi des soirées

Ce document décrit quatre fonctions qui se complètent :
- le suivi du déploiement du site public ;
- le tableau de santé ;
- la vérification avant publication ;
- le suivi des soirées.

Les statistiques sont décrites dans [statistiques.md](statistiques.md), les programmations dans
[programmations.md](programmations.md).

Parcours type : préparer la soirée (**Suivi de la soirée** indique ce qui manque) → **Vérifier avant
publication** → publier ou programmer → la mise en ligne envoie sur GitHub → le CMS suit le
déploiement → **Santé du CMS** signale un problème → après la soirée, la clôture apparaît →
**Statistiques**.

## 1. Mise en ligne et déploiement

Une mise en ligne (`cms/server/publish/publisher.mjs`) passe par des étapes enregistrées dans la
table `publications` (colonne `stage`) : préparation (Git), export, génération des pages, validation,
commit, envoi. Un échec indique donc l'étape en cause (page **Mise en ligne**, tableau de santé).

La validation est celle de `tools/validate.mjs`, exécutée **une seule fois** par mise en ligne avec
l'option `--json`. Elle produit le même contrôle que `npm run validate`, avec un résultat structuré :
- les **erreurs** bloquent la mise en ligne ;
- les points **« à compléter »** (images inutilisées…) sont affichés comme avertissements non bloquants.

### États du déploiement

Après un envoi sur GitHub (mode `push`), le CMS suit l'exécution du workflow
`.github/workflows/deploy-pages.yml` pour **le commit exact envoyé**
(`cms/server/publish/deploy-tracker.mjs`), par l'API GitHub, en lecture seule.

| État | Signification |
|---|---|
| Non envoyé | modes `files` / `commit` : rien n'est parti sur GitHub (« Fichiers générés », « Commit local ») |
| Envoyé, déploiement pas encore démarré | commit sur GitHub, exécution du workflow pas encore visible |
| Déploiement en attente / en cours | exécution du workflow en file ou en cours |
| Déployé sur le site | le workflow a réussi pour ce commit |
| Déployé avec une version plus récente | exécution annulée (`concurrency: cancel-in-progress`) au profit d'un commit plus récent **qui contient celui-ci** (vérifié avec Git), et ce dernier a été déployé |
| Déploiement échoué | échec du workflow (voir son journal) |
| Déploiement annulé | annulé sans déploiement plus récent contenant ces modifications : relancer une mise en ligne |
| Écrasé par une version antérieure | déployé, puis une exécution plus ancienne s'est terminée après : le site ne montre pas ces modifications |
| Déploiement ignoré | condition du workflow non remplie (ex. dépôt copié) |
| État inconnu | dépôt non identifié, aucune exécution trouvée, ou aucune réponse exploitable pendant 6 heures |

Règles :
- **Attribution :** une exécution n'est attribuée à une mise en ligne que par son `head_sha`. Le
  succès d'un commit antérieur ne vaut jamais pour un commit plus récent.
- **Indisponibilité de GitHub :** une erreur de l'API, une limite d'appels atteinte (403/429) ou un
  délai dépassé (10 s) laissent l'état inchangé, avec le motif, et une nouvelle vérification est
  prévue (après la remise à zéro de la limite). Jamais un succès par défaut.
- **Rythme :** vérifications par le planificateur, chaque minute pendant la première demi-heure, puis
  toutes les 5 et 15 minutes, et abandon (« inconnu ») après 6 heures. Un succès reste surveillé une
  heure (exécution plus ancienne terminée après lui). Bouton **Vérifier maintenant** (une demande
  toutes les 15 s au plus).
- **Une seule source :** l'état est enregistré sur la mise en ligne (colonnes `deploy_*`). La page
  Mise en ligne, le tableau de santé, les programmations (« Déployée », « Envoyée, déploiement en
  cours »…) et le suivi des soirées la lisent sans appeler GitHub.

Configuration (`cms/.env`) :

| Variable | Rôle |
|---|---|
| `CMS_DEPLOY_TRACKING` | `1` (défaut) ou `0` pour désactiver le suivi |
| `CMS_GITHUB_REPO` | `propriétaire/dépôt` ; vide = déduit de l'adresse du dépôt distant Git (`yvxtdc/tekno-never-dies`) |
| `CMS_GITHUB_WORKFLOW` | fichier du workflow (`deploy-pages.yml`) |
| `CMS_GITHUB_TOKEN` | facultatif. Le dépôt étant public, l'API répond sans jeton (60 appels par heure et par adresse). Un jeton *fine-grained* limité à ce dépôt, permission **Actions : lecture** uniquement, relève cette limite. Côté serveur seulement, jamais envoyé au navigateur ni versionné |

## 2. Tableau de santé (menu « Santé du CMS », carte du tableau de bord)

Chaque indicateur a l'un des niveaux suivants :
- **Normal** ;
- **En cours** (fonctionnement normal) ;
- **Avertissement** ;
- **Intervention nécessaire** ;
- **Inconnu / non configuré**.

Une information impossible à vérifier n'est jamais affichée comme normale. Chaque ligne explique la
cause et, si besoin, la marche à suivre, avec un lien vers le détail.

| Section | Contenu | Visible par |
|---|---|---|
| Serveur et base | démarrage du processus, base disponible, intégrité (`PRAGMA quick_check`, lecture seule, toutes les 6 h ou « Contrôler maintenant »), migrations en attente, erreurs des dernières 24 h (messages sans pile ni chemin), espace disque, dossiers de données | administrateurs |
| Programmations | planificateur actif et dernière vérification (erreur s'il ne tourne plus depuis 3 min), prochaine échéance, programmations en retard, en conflit, bloquées ou en échec, nouvelles tentatives, appliquées mais pas mises en ligne | tous |
| Mise en ligne et déploiement | mise en ligne trop longue, dernier résultat et étape d'un échec, dernière validation (erreurs et points « à compléter »), état du déploiement, fichiers modifiés hors du CMS | tous |
| Sauvegardes | âge de la dernière sauvegarde locale (avertissement au-delà de 1,5 fois la fréquence, erreur au-delà de 3 fois), échec de la sauvegarde automatique, sauvegarde externe, originaux des images, test de restauration de la copie locale | administrateurs |
| Test de restauration de la sauvegarde externe | dernier rapport de `cms/bin/restore-test.mjs` : statut, date et durée, sauvegarde testée, SQLite, cohérence, médias, originaux, avertissements, dernier test réussi | administrateurs |

Le calcul ne fait ni appel externe ni opération lourde : il ne bloque pas l'administration. Rien n'est
réparé, migré ni supprimé depuis ce tableau.

### Sauvegarde externe

Une sauvegarde locale (même disque) et une sauvegarde externe ne protègent pas des mêmes risques. La
destination est un support monté (installation actuelle : disque G-RAID de l'hôte Proxmox, **même
serveur, donc pas une sauvegarde hors site**) ou une autre machine (rsync par SSH) : voir
[exploitation.md](exploitation.md) § 4. `cms/deploy/backup-media.sh` fait deux choses distinctes :
1. **l'envoi** : `rsync` de `backups/` et `media/originals/` vers la destination ;
2. **la vérification de la copie**, juste après :
   `rsync -a --checksum --dry-run --itemize-changes` compare chaque fichier local à sa copie par somme
   de contrôle, sans rien transférer. Un fichier absent ou différent dans la destination est compté
   comme une différence. Les fichiers présents seulement dans la destination (anciennes sauvegardes,
   la copie n'efface rien) ne comptent pas.

Il écrit un compte rendu dans `CMS_DATA_DIR/status/backup-externe.json`, sans la destination ni aucun
identifiant. Il contient :
- la date, la réussite et l'étape en échec ;
- `commandOk` : envoi terminé sans erreur ;
- `verified` : `true` (copie identique), `false` (différences, ou destination injoignable lors de la
  vérification) ou `null` (non vérifié) ;
- le nombre de fichiers comparés et de différences ;
- le **nom** de la dernière sauvegarde de la base.

`TND_BACKUP_VERIFY=0` désactive la vérification (par exemple pour une destination qui ne la permet pas).

Le tableau de santé affiche deux lignes :

| Ligne | Normal | Avertissement / erreur / inconnu |
|---|---|---|
| Sauvegarde externe : envoi | « Terminé il y a … » | pas de compte rendu (inconnu, « Non configurée ou jamais exécutée ») ; échec (erreur, avec l'étape) ; plus ancien que `CMS_EXTERNAL_BACKUP_MAX_HOURS` (36 h par défaut ; avertissement, erreur au-delà du double) |
| Sauvegarde externe : contenu de la copie | « Vérifié il y a … » (N fichiers identiques) | différences ou destination injoignable (erreur) ; compte rendu incohérent, « vérifié » avec des différences (erreur) ; aucun fichier comparé (avertissement) ; vérification désactivée, ou compte rendu d'une version du script sans vérification (avertissement « Non vérifié ») ; vérification ancienne (avertissement) |

Ce que « vérifié » garantit, et ce qu'il ne garantit pas :
- au moment de la sauvegarde, chaque fichier sauvegardé existait dans la destination avec un contenu
  identique, constaté par rsync lui-même ;
- le CMS n'accède pas à la destination : il lit le compte rendu du script ;
- une perte survenue ensuite dans la destination n'est pas détectée avant la vérification suivante ;
- seul un essai de restauration à partir de la copie externe prouve qu'elle est utilisable : c'est le
  rôle du test hebdomadaire ci-dessous. « Tester la restauration » contrôle la copie **locale**.

Le script lit maintenant `CMS_DATA_DIR` dans l'environnement avant `cms/.env`, comme le CMS.

### Test de restauration de la copie locale

**Tester la restauration** (administrateurs) ou `npm run cms:admin -- verify-backup` procède ainsi :
1. copie la dernière sauvegarde dans un dossier temporaire ;
2. l'ouvre et contrôle son intégrité, ses migrations et ses contenus ;
3. note la date et le résultat (`settings` : `backup.restoreTest`).

La base en service et les sauvegardes ne sont jamais modifiées. Ce test ne remplace pas un exercice
de restauration complet du serveur (voir [exploitation.md](exploitation.md) § 5).

### Test de restauration de la sauvegarde externe

Test hebdomadaire de la copie du disque de sauvegarde externe (G-RAID), lancé par un minuteur de l'hôte
Proxmox : fonctionnement, contrôles, rapport, installation et diagnostic dans
[exploitation.md](exploitation.md) § 4. Le CMS ne lance jamais ce test : il lit le dernier rapport
(`CMS_DATA_DIR/status/restore-test.json`, `readRestoreReport` de `services/restore-test.mjs`) et
l'affiche dans sa propre section.

| Ligne | Normal | Avertissement / erreur / inconnu |
|---|---|---|
| Dernier test | « Réussi il y a … », tous les contrôles obligatoires exécutés et réussis | jamais exécuté, rapport illisible, d'un autre format ou incohérent (inconnu) ; échec (erreur, avec chaque contrôle en échec et son message) ; réussite plus ancienne que `CMS_RESTORE_TEST_MAX_HOURS` (192 h = 8 jours par défaut ; avertissement, erreur au-delà du double) |
| Date et durée | date du dernier test, durée | — |
| Sauvegarde externe testée | nom du fichier (support, sélection, espace, copie réussis) | contrôle en échec (erreur) ou non exécuté (inconnu) |
| Base SQLite restaurée | « Intègre · N tables » (intégrité, clés étrangères, structure) | intégrité en échec, violations, structure incomplète |
| Contrôles de cohérence | « Réussis » | en échec, non exécutés |
| Médias du dépôt | fichiers présents / attendus, références valides | référence cassée, fichier absent ou chemin refusé |
| Originaux téléversés | récupérés et vérifiés / attendus | original absent du support ou différent de son empreinte |
| Avertissements | (absente) | sauvegarde ancienne, image du dépôt modifiée depuis son enregistrement, pas d'administrateur actif… |
| Dernier test réussi | date et sauvegarde (conservées après un échec) | « Aucun » (inconnu) |

Un échec constaté sur l'hôte avant le test (disque absent, UUID ou marqueur faux, montage incorrect)
apparaît comme un échec, avec seulement les lignes « Dernier test », « Date et durée » et « Dernier test
réussi » : aucun contrôle n'est présenté comme fait.

## 3. Vérifier avant publication (fiche d'une soirée)

Bouton **Vérifier avant publication** (carte Publication). Le contrôle se fait aussi automatiquement
avant **Publier** et avant **Programmer…** une mise en ligne.

La liste est groupée en quatre catégories :
- **erreurs bloquantes** ;
- **avertissements** ;
- **contrôles impossibles depuis le CMS** ;
- **vérifications réussies**.

Les éléments sans objet sont regroupés à part. Chaque point a un lien vers la section de la fiche.

| Niveau | Exemples | Effet |
|---|---|---|
| Erreur bloquante | image dont le fichier manque sur le serveur (la mise en ligne échouerait), fiche publique impossible à générer, heure de fin sans début, passage sans artiste | publication immédiate et programmation refusées ; exécution d'une programmation refusée |
| Avertissement | pas de lien de billetterie, tarifs non ouverts, lieu sans coordonnées, pas de visuel, texte alternatif manquant, line-up incohérent (chevauchements, horaires hors soirée), traductions manquantes, résumé du prix contradictoire, album non publié | publication possible, après confirmation explicite |
| Contrôle impossible | page de billetterie et liens externes (le CMS n'appelle pas les sites externes) | à vérifier à la main |
| Sans objet | billetterie d'une soirée passée ou annulée | — |

Les règles dépendent du contexte : une soirée passée, annulée ou archivée n'a besoin ni de billetterie
ni d'un line-up complet. Les données sont contrôlées par `eventCheckItems` (`services/events.mjs`), qui
reprend les contrôles existants avec les mêmes messages. Les fichiers et le rendu de la fiche (même
modèle que l'aperçu, `tools/lib/event-page.mjs`) sont contrôlés par `services/event-checklist.mjs`.

**Programmations.** Le contrôle bloquant est refait **au moment de l'exécution**, sur le contenu du
moment, pour toute programmation qui rend une soirée visible ou modifie une soirée visible. Seuls les
problèmes **apportés** par la modification la bloquent : un défaut déjà toléré ne gèle pas la soirée.

En cas d'échec :
- la transaction est annulée et rien n'est publié ;
- la programmation est conservée en « Échec » avec le motif et son journal ;
- après correction, **Réessayer** la remet en attente : elle s'exécute à son heure, ou tout de suite
  si l'heure est passée.

Le contrôle complet du site (liens, pages, agenda…) reste celui de la mise en ligne : la fiche en
rappelle le dernier résultat.

## 4. Suivi des soirées

Carte **Suivi de la soirée** (fiche) et menu **Suivi des soirées** (vue d'ensemble filtrable : en
préparation, tâches en retard, erreurs bloquantes, clôture à faire, prêtes ou clôturées). Les statuts
existants ne changent pas. Aucune transition automatique : passer la date de la soirée fait seulement
apparaître la clôture.

| Phase | Tâches (selon la soirée) |
|---|---|
| Avant (à venir) | informations principales ; horaires et lieu ; affiche et texte alternatif ; tarifs et billetterie (*non concerné* possible) ; line-up cohérent ; **line-up confirmé** (manuel) ; DJ Contest (si artiste mystère) ; **infos pratiques relues** (manuel) ; traductions (*non concerné* possible) ; vérification avant publication sans erreur ; soirée publiée ; dernières modifications **déployées** sur le site public |
| Annulée | annulation affichée ; **annulation communiquée** (manuel) ; déploiement ; informations, lieu, visuels, traductions, vérification |
| Après (date passée) | photos « La soirée » ; album de la galerie ; nombre de participants (détecté dans les infos pratiques, ex. « 250 participant·es ») ; gagnant du DJ Contest au line-up ; **visuels de l'archive vérifiés** (manuel) ; **archive relue** (manuel) |
| Archivée, ou passée sans avoir été publiée | aucune tâche |

Fonctionnement des tâches :
- **Tâches automatiques :** une tâche qui se déduit des données se valide d'elle-même. Elle ne se
  coche pas à la main ; si elle le prévoit, elle peut être marquée **Non concerné**.
- **Tâches manuelles :** elles sont confirmées par une personne. Seules ces confirmations sont
  enregistrées (table `event_tasks`), avec la date, l'auteur et le numéro de génération de la soirée.
  Une soirée **dupliquée** repart donc sans aucune confirmation.
- **Échéances :** elles sont relatives à la date de la soirée (heure de Paris), par exemple J-30 pour
  les informations, J-7 pour la relecture et J+14 pour les photos. Elles sont recalculées si la date
  change.

Rien n'est inventé : photos, nombre de participants et résultat du DJ Contest sont saisis par l'équipe.
La vue d'ensemble couvre les soirées non archivées à venir ou passées depuis moins de 120 jours.
