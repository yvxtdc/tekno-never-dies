# CMS Tekno Never Dies — installation et utilisation

Le CMS permet de gérer les soirées, le line-up, les artistes, les lieux, les images, la galerie,
la FAQ, l'équipe et les traductions depuis une interface privée, puis de **mettre le site en ligne**
sans toucher au code. Le site public reste statique (GitHub Pages) : le CMS régénère ses fichiers.

- Pourquoi cette architecture : [architecture.md](architecture.md)
- Production, sécurité, sauvegardes : [exploitation.md](exploitation.md)

## 1. Prérequis

- **Node.js 22.13 ou plus récent** (24 LTS recommandé) : la base SQLite est intégrée à Node (`node:sqlite`).
- `npm install` (une seule dépendance : `sharp`, pour les images).
- Git (modes de mise en ligne `commit` et `push`).

## 2. Démarrage en local

```sh
npm install
cp cms/.env.example cms/.env          # facultatif : les valeurs par défaut conviennent en local
npm run cms:admin -- import           # reprend les contenus actuels du site dans la base du CMS
npm run cms:admin -- create-user --email vous@exemple.fr --name "Votre nom" --role admin
npm run cms                           # http://localhost:8787/admin/
```

- `import` ne modifie aucun fichier du dépôt. Il vérifie que la première mise en ligne reproduira
  **exactement** les données actuelles (« Vérifié : … »).
- `create-user` affiche un **mot de passe temporaire une seule fois** ; il est à changer à la
  première connexion. Il n'existe aucun compte par défaut ni d'inscription publique.
- Les données (base, images importées, sauvegardes) sont dans `.cms-data/` (ignoré par Git).

En local, `CMS_PUBLISH_MODE=files` (défaut) : « Mettre en ligne » écrit les fichiers du site dans
la copie de travail. Relisez avec `git diff`, puis committez vous-même. Pour voir le site :
`npm start` (ou l'aperçu intégré du CMS : `/preview/site/`).

## 3. Utilisation (pour l'équipe)

| Je veux… | Dans l'administration |
|---|---|
| Annoncer une soirée | **Soirées → Nouvelle soirée** : nom, date, horaires, lieu, billetterie, affiche, line-up. Enregistrer (brouillon), vérifier l'**aperçu**, puis **Publier** et **Mettre en ligne**. |
| Préparer la prochaine édition | Sur une soirée : **Dupliquer** (copie en brouillon avec le line-up). |
| Programmer une annonce | Carte **Publication → Programmer…** : la soirée reste invisible, puis elle est publiée et le site mis à jour automatiquement à l'heure choisie. |
| Programmer une modification (prix, line-up, infos pratiques, artiste, lieu, équipe, FAQ…) | Modifier le formulaire puis **Programmer…** au lieu d'**Enregistrer** ; suivi dans le menu **Programmations**. Seuls les éléments modifiés sont appliqués, sur la version la plus récente : voir [programmations.md](programmations.md). |
| Annuler une soirée | **Annuler la soirée** : elle reste affichée « Soirée annulée », sans billetterie ; l'agenda des abonnés est mis à jour. |
| Retirer une soirée du site | **Dépublier** (brouillon) ou **Archiver**. Une soirée en ligne ne peut pas être supprimée directement. |
| Modifier le line-up | Section **Line-up** : un passage = un créneau, un ou plusieurs artistes (B2B). Glisser-déposer ou flèches ↑ ↓ pour l'ordre ; **Enchaîner les horaires**, **Trier par horaire**. La frise signale les chevauchements. |
| Indiquer les prix | Section **Billetterie et entrée** → **Tarifs** : un tarif par ligne (Early, Regular, Late…), état « En vente », « Épuisé » (grisé et barré sur le site), « Bientôt » ou « Terminé », fin de vente facultative ; **Ajouter la caisse du soir** (toujours affichée en dernier). Le site les montre dans la section « Billets », avant les infos pratiques. |
| Proposer une place au DJ Contest | Mettre au line-up la fiche artiste **DJ Contest** (case « Artiste mystère » cochée), puis renseigner la section **DJ Contest** de la soirée (date limite, adresse). Sur le site, le nom ouvre une fenêtre qui explique comment envoyer son set. |
| Ajouter un artiste | Depuis le line-up (« Créer l'artiste … ») ou **Artistes**. Le CMS signale les noms proches (doublons). Une photo, un lien Instagram et un style sur la fiche s'affichent dans toutes ses soirées. |
| Corriger une adresse | **Lieux** : la modification s'applique à toutes les soirées de ce lieu. Coordonnées GPS = plans « Y aller ». |
| Importer des photos | **Médiathèque** (glisser-déposer) ou directement depuis un champ image. Renseignez le **texte alternatif**. |
| Publier un album | **Galerie photo → Nouvel album**, ajouter les photos, cocher « publié », puis le lier à la soirée (champ « Album de la galerie »). |
| Traduire | **Traductions** (ou section Traductions d'une soirée) : allemand et anglais. Sans traduction, le français s'affiche. |
| Mettre le site à jour | **Mise en ligne** : liste ce qui a changé, lance la régénération et la validation complète, affiche le journal, puis **suit le déploiement GitHub Pages** du commit envoyé (« Déployé sur le site », « Déploiement échoué »…). |
| Savoir si une soirée est prête | Fiche → **Vérifier avant publication** (erreurs bloquantes, avertissements, contrôles impossibles) et carte **Suivi de la soirée** ; vue d'ensemble : **Suivi des soirées**. Voir [supervision.md](supervision.md). |
| Clôturer une soirée passée | Carte **Suivi de la soirée** : photos, album, participants, DJ Contest, relecture de l'archive. |
| Savoir si tout fonctionne | **Santé du CMS** (planificateur, mise en ligne, déploiement ; serveur, base et sauvegardes pour les administrateurs). |
| Voir la fréquentation | **Statistiques** (GoatCounter : visites, pages, soirées, clics billetterie / agenda / itinéraire / partage). Voir [statistiques.md](statistiques.md). |
| Revenir en arrière | Carte **Historique** (soirée, artiste, lieu) : comparer les versions, restaurer (nouvelle version, rien n'est effacé). |

Statuts d'une soirée : **Brouillon** (invisible), **Programmé**, **Publié**, **Annulé** (visible avec
mention), **Archivé** (retiré, conservé). « À venir » / « passée » reste calculé par la date.

Rôles : **Administrateur** (tout, y compris comptes, journal, sauvegardes, suppressions définitives)
et **Éditeur** (contenus, médias, publication, mise en ligne).

Raccourci : **Ctrl/Cmd + S** enregistre la fiche ouverte. Quitter une page avec des modifications non
enregistrées demande confirmation.

## 4. Ce que fait « Mettre en ligne »

1. Exporte les contenus publiés dans `js/data/*.js` et `js/i18n/contenus-*.js` (même format qu'avant)
   et copie les images importées, optimisées en WebP, dans `assets/img/cms/`.
2. Lance les outils existants : `event-pages` (fiches et images d'aperçu), `generate-calendar`
   (agenda), `maps` (plans des nouveaux lieux, si `CMS_RUN_MAPS=1`), `langues` (pages `de/`, `en/`,
   sitemap), puis `validate`.
3. Selon `CMS_PUBLISH_MODE` : rien de plus (`files`), commit des seuls fichiers gérés (`commit`), ou
   commit puis push vers GitHub, qui déploie le site (`push`).

Garde-fous : si la validation échoue, les fichiers sont restaurés et rien n'est commité ni poussé.
Si un fichier géré (ex. `js/data/events.js`) a été modifié à la main depuis la dernière mise en ligne,
la mise en ligne est bloquée au lieu de l'écraser ; un administrateur peut forcer.

**Après la mise en service du CMS**, ne modifiez plus à la main les fichiers qu'il gère :
`js/data/events.js`, `artistes.js`, `artistes-photos.js`, `faq.js`, `equipe.js`, `galerie.js`,
`js/i18n/contenus-de.js`, `contenus-en.js`. Les commandes `npm run photos` et `npm run artistes`
sont remplacées par la médiathèque et la galerie du CMS. `js/data/site.js`, les pages HTML,
`partials/` et les dictionnaires `de.js` / `en.js` restent gérés dans le code.

## 5. Commandes

| Commande | Rôle |
|---|---|
| `npm run cms` | Démarre le serveur (administration, API, aperçu, tâches programmées). |
| `npm run cms:admin -- import` | Import initial depuis le dépôt (base vide uniquement). |
| `npm run cms:admin -- verify` | Compare l'export du CMS aux fichiers `js/data` actuels. |
| `npm run cms:admin -- create-user --email … --name … [--role admin\|editor]` | Crée un compte (mot de passe temporaire affiché une fois). |
| `npm run cms:admin -- reset-password --email …` | Nouveau mot de passe temporaire. |
| `npm run cms:admin -- list-users` | Liste des comptes. |
| `npm run cms:admin -- publish [--force]` | Mise en ligne depuis la ligne de commande. |
| `npm run cms:admin -- backup [--label …]` | Sauvegarde de la base. |
| `npm run cms:admin -- restore <fichier> --yes` | Restauration (serveur arrêté). |
| `npm run cms:admin -- verify-backup [--name …]` | Teste la dernière sauvegarde sur une copie temporaire (base en service non modifiée) ; résultat au tableau de santé. |
| `node cms/bin/restore-test.mjs [--backup …]` | Test de restauration de la sauvegarde **externe** (support monté, variables explicites, n'ouvre pas la base) ; lancé chaque semaine depuis l'hôte Proxmox. [exploitation.md](exploitation.md) § 4 |
| `npm run cms:admin -- status` | État de la base, de la configuration et des modifications en attente. |
| `npm test` | Tests automatisés du CMS (node:test). |
| `npm run validate` | Validation du site public (inchangée). |

Les migrations de base de données sont appliquées automatiquement au démarrage et par chaque
commande (`npm run cms:admin -- migrate` pour les appliquer seules). Une nouvelle migration = un
nouveau fichier `cms/server/db/migrations/NNN_nom.sql` (ne jamais modifier une migration déjà appliquée).

## 6. Configuration (`cms/.env`)

Voir [`cms/.env.example`](../../cms/.env.example), commenté. Principales variables :

| Variable | Défaut | Rôle |
|---|---|---|
| `CMS_PUBLIC_URL` | `http://localhost:8787` | Adresse de l'administration ; en `https://`, les cookies sont `Secure` et préfixés `__Host-`. |
| `CMS_HOST`, `CMS_PORT` | `127.0.0.1`, `8787` | Écoute du serveur. |
| `CMS_DATA_DIR` | `.cms-data` | Base, images importées, sauvegardes. **À sauvegarder.** |
| `CMS_SITE_DIR` | `.` | Copie de travail du site écrite par la mise en ligne. |
| `CMS_PUBLISH_MODE` | `files` | `files`, `commit` ou `push`. |
| `CMS_GIT_REMOTE`, `CMS_GIT_BRANCH` | `origin`, `main` | Destination du push. |
| `CMS_TRUST_PROXY` | `0` | `1` derrière un proxy de confiance (IP réelle pour la limitation des connexions). |
| `CMS_RUN_MAPS` | `1` | Génère les plans OpenStreetMap des nouveaux lieux. |
| `CMS_SESSION_IDLE_MINUTES`, `CMS_SESSION_MAX_HOURS` | `120`, `12` | Expiration des sessions. |
| `CMS_MAX_UPLOAD_MB` | `20` | Taille maximale d'une image. |
| `CMS_BACKUP_EVERY_HOURS`, `CMS_BACKUP_KEEP` | `24`, `30` | Sauvegardes automatiques et rotation. |
| `CMS_DEPLOY_TRACKING`, `CMS_GITHUB_REPO`, `CMS_GITHUB_WORKFLOW`, `CMS_GITHUB_TOKEN` | `1`, déduit du dépôt distant, `deploy-pages.yml`, vide | Suivi du déploiement GitHub Pages (API en lecture ; jeton facultatif, lecture seule). [supervision.md](supervision.md) |
| `CMS_GOATCOUNTER_TOKEN`, `CMS_GOATCOUNTER_URL`, `CMS_STATS_SINCE` | vide | Onglet Statistiques (jeton GoatCounter en lecture, côté serveur). [statistiques.md](statistiques.md) |
| `CMS_EXTERNAL_BACKUP_MAX_HOURS` | `36` | Âge maximal attendu du rapport de `cms/deploy/backup-media.sh`. |
| `CMS_RESTORE_TEST_MAX_HOURS` | `192` | Âge maximal attendu du rapport du test de restauration de la sauvegarde externe. |

## 7. Tests

```sh
npm test            # 100+ tests : authentification, permissions, CRUD, validation, line-up,
                    # médias, export identique, mise en ligne (fichiers, commit, push), aperçu, sauvegardes,
                    # programmations (schedule.test.mjs : conflits, dépendances, reprise, heure d'été…),
                    # déploiements et santé (supervision.test.mjs), vérification et suivi des soirées
                    # (checklist.test.mjs), statistiques (stats.test.mjs) : GitHub et GoatCounter simulés
npm run validate    # site public
```

Les tests créent des bases et des copies du site temporaires (rien n'est écrit dans le dépôt).

## 8. Organisation du code

```
cms/
  server/
    index.mjs, app.mjs, config.mjs   serveur HTTP, contrôles de sécurité, configuration
    db/                              accès SQLite, migrations SQL
    auth/                            mots de passe, sessions, limitation, permissions
    services/                        règles métier (soirées, artistes, lieux, médias, FAQ, équipe…)
    api/                             routes de l'API JSON
    export/                          import initial et export vers js/data
    publish/                         mise en ligne et planificateur (exécute les programmations)
    preview/                         prévisualisation du site
  admin/                             interface (HTML, CSS, modules JS natifs)
  bin/cms.mjs                        ligne de commande d'exploitation
  test/                              tests node:test
  deploy/                            exemples : systemd, Caddy, sauvegarde nocturne
```

Ajouter un type de contenu : migration SQL → service (validation, `version`, révisions) → routes
API (`perm`) → export dans `export/site-data.mjs` et `modules.mjs` → vue d'administration → tests.
