# Infrastructure Proxmox du CMS — référence et reconstruction

Document de référence de l'installation de production : ce qui tourne où, ce qui est versionné, ce qui
n'existe que sur le serveur, et comment tout reconstruire. Les procédures détaillées déjà écrites
ailleurs ne sont pas recopiées : elles sont citées (installation de l'application, sécurité,
sauvegardes, restauration, mises à jour : [exploitation.md](exploitation.md) ; tableau de santé :
[supervision.md](supervision.md)).

> **Sources de ce document** : le dépôt, et les **relevés de la production faits par l'exploitant, en
> lecture seule, sur l'hôte et dans le conteneur le 27 octobre 2026** (liste au § 9 ; versions, `fstab`,
> configuration du LXC 126, UID/GID, permissions, fichiers de la sauvegarde quotidienne, empreintes,
> `cloudflared`…). Ce document a été écrit depuis le dépôt de développement, sans accès à l'hôte : les
> valeurs ci-dessous sont celles des relevés, pas des constats de l'auteur. Tout ce qui reste marqué
> **inconnu** doit encore être relevé (§ 9).
>
> **Propre à cette installation.** Les scripts et unités de `cms/deploy/proxmox/` contiennent en dur
> l'UUID du G-RAID, ses chemins, le numéro du conteneur (126), le compte `tnd-cms` et les chemins du CMS.
> Ils ne sont pas universels : sur un autre serveur, adapter d'abord les valeurs du § 10.0.

## 1. Vue d'ensemble

```
Hôte Proxmox « yHomeLab » (root@yHomeLab) — proxmox-ve 9.2.0, pve-manager 9.1.11, noyau 6.17.2-1-pve, fuseau Europe/Paris
├─ Disque système ── LXC 126 « TnDweb » (non privilégié, Debian 13 trixie, 192.168.1.50/24)
│                     ├─ service tnd-cms (Node, 127.0.0.1:8787) ◄── cloudflared ◄── Cloudflare (Access) ◄── navigateur
│                     ├─ /srv/tnd-cms/site   copie du site et du CMS (version déployée : § 2.2)
│                     ├─ /srv/tnd-cms/data   base SQLite, médias, sauvegardes locales, rapports
│                     └─ /mnt/tnd-backups    ◄── point de montage mp0 (bind) ──┐
├─ Disque G-RAID ext4 (/dev/sdd1 lors du relevé ; UUID f5b884b5-a8c9-45f2-8275-3bfe71bb5a95)
│     monté sur /mnt/yPlexLib ; dossier /mnt/yPlexLib/sauvegardes/tnd-cms ─────┘
│     (marqueur .tnd-backup-target, backups/, originals/)
├─ tnd-cms-backup.timer          chaque jour 06:00 → tnd-cms-backup.service → /usr/local/sbin/tnd-cms-backup-safe.sh --run
└─ tnd-cms-restore-test.timer    dimanche 06:30  → tnd-cms-restore-test.service → /usr/local/sbin/tnd-cms-restore-test.sh
```

Horaires en heure locale de l'hôte (`Europe/Paris`).

Le G-RAID est un disque **séparé du disque système mais branché au même serveur** : il protège d'une
panne du disque du conteneur ou d'une erreur de manipulation, **pas** d'une perte du serveur (incendie,
vol, surtension). Il n'existe pas encore de copie hors site.

Le site public n'est pas hébergé ici : GitHub Pages, alimenté par les commits du CMS sur `main`.

## 2. Inventaire

Cinq catégories, à ne pas confondre :
- **A. Versionné et identique à la production** : source dans le dépôt **et** empreinte SHA-256 de la
  copie installée, relevée en production, égale à celle de la source (et `cmp` quand il a été fait) ;
- **B. Versionné, non comparé** : source dans le dépôt, mais l'identité avec la copie installée n'a pas été
  contrôlée par empreinte (copie d'un relevé, installation par `pct pull`, clone Git…) ;
- **C. Documenté, non versionné** : réglage sans fichier à versionner (configuration Proxmox, `fstab`,
  permissions, versions…). « Relevé » : valeur constatée en production le 27/10/2026 (relevés de
  l'exploitant, en lecture seule) ; sinon, seulement décrit ;
- **D. Inconnu** : ni relevé ni versionné ; commande de relevé au § 9 ;
- **E. Hors Git** : secret ou donnée, jamais dans le dépôt (§ 8).

| # | Élément | Emplacement en production | Cat. | Détail |
|---|---|---|---|---|
| 1 | Service applicatif `tnd-cms` | LXC : `/etc/systemd/system/tnd-cms.service` | **A** | identique au modèle `cms/deploy/tnd-cms.service` : même SHA-256 (`6a8c0dec5830283f34b012e448ab789caf61227d5264436e16831ba5bd1c0fa4`) pour la copie installée, la copie du site déployé et le dépôt ; `cmp` sans différence ; `FragmentPath=/etc/systemd/system/tnd-cms.service`, aucun `DropInPaths`, dossier `tnd-cms.service.d/` vide |
| 1 | Code du CMS, site, outils | LXC : `/srv/tnd-cms/site` | **B** | sources versionnées, mais **version déployée non identifiée** : `git rev-parse --is-inside-work-tree` n'y a pas reconnu de dépôt Git exploitable lors du relevé (§ 2.2) |
| 1 | `update-cms` | LXC : lien `/usr/local/bin/update-cms` → `/srv/tnd-cms/site/cms/deploy/update-cms.sh` | **B** (script) ; lien **C, relevé** | `command -v update-cms` n'a rien renvoyé dans l'environnement du relevé : utiliser le chemin absolu (§ 10 B.4) |
| 1 | Copie externe (rsync, vérification, rapport) | LXC : `cms/deploy/backup-media.sh` | **B** | fait partie du site déployé (version non identifiée, § 2.2) ; lancé avec succès par la production |
| 2 | Script de sauvegarde quotidien | hôte : `/usr/local/sbin/tnd-cms-backup-safe.sh` | **A** | SHA-256 de production = source du dépôt (§ 2.1) ; `root:root 750` (relevé) |
| 3 | `tnd-cms-backup.service`, `.timer` | hôte : `/etc/systemd/system/` | **A** | SHA-256 de production = sources (§ 2.1) ; `root:root 644`, activés (relevé) |
| 4 | Test de restauration : script, service, minuteur | hôte : `/usr/local/sbin/`, `/etc/systemd/system/` | **A** | SHA-256 de production = sources (§ 2.1) ; installés par `pct pull` ; test réel réussi |
| 4 | Test de restauration : programme | LXC : `cms/bin/restore-test.mjs`, `cms/server/services/restore-test.mjs` | **B** | fait partie du site déployé (version non identifiée, § 2.2) ; test réel réussi |
| 5 | Montage du G-RAID | hôte : `/etc/fstab`, `/mnt/yPlexLib` | **C, relevé** | ligne `fstab`, ext4, UUID (§ 5) |
| 6 | Montage dans le LXC (`mp0`) | hôte : `/etc/pve/lxc/126.conf` | **C, relevé** | § 5.1 |
| 7 | UID/GID (non privilégié) | conteneur et hôte | **C, relevé** | `tnd-cms` 999:991 ↔ 100999:100991 ; aucune ligne `lxc.idmap` (§ 6) |
| 8 | Marqueur `.tnd-backup-target` | hôte : `…/sauvegardes/tnd-cms/.tnd-backup-target` | **C, relevé** | `100999:100991`, mode `440`, contenu = UUID (§ 5) ; jamais versionné |
| 9 | Chemins et permissions des données | LXC | **C, relevé** | `status/` 999:991 `755`, copie externe `750` (§ 3, § 6) |
| 10 | Conteneur 126 : configuration | hôte : `/etc/pve/lxc/126.conf` | **C, relevé** | § 5.1 ; pas d'`onboot` |
| 10 | Conteneur 126 : modèle (template) de création | — | **D** | § 9 |
| 10 | Pare-feu Proxmox : fichier du conteneur | hôte : `/etc/pve/firewall/126.fw` | **C, relevé** | fichier **absent** ; `firewall=1` sur `net0` (§ 5.1) |
| 10 | Pare-feu Proxmox : niveaux supérieurs (centre de données, hôte) | hôte : `/etc/pve/firewall/cluster.fw`, `/etc/pve/nodes/<nœud>/host.fw` | **D** | non inventoriés : l'absence de `126.fw` ne prouve pas l'absence de filtrage (§ 9) |
| 10 | Système du conteneur | LXC | **C, relevé** | Debian GNU/Linux 13 (trixie) |
| 10 | Node.js | LXC | **C, relevé** | paquet `nodejs` `24.22.1-1nodesource1` (dépôt NodeSource `node_24.x`), `/usr/bin/node` fourni par ce paquet (§ 7) |
| 10 | `npm`, `git`, `rsync`, `curl`, `runuser`, `pkill` | LXC | **C, relevé** | versions et chemins au § 7 |
| 10 | `cloudflared` dans le conteneur : paquet, dépôt APT, version | LXC | **C, relevé** | paquet `cloudflared` `2026.10.3` (fournit `/usr/bin/cloudflared`) du dépôt `https://pkg.cloudflare.com/cloudflared` `any main` (§ 7) ; commandes d'installation initiales **D** |
| 10 | `cloudflared.service`, `cloudflared-update.service`, `cloudflared-update.timer` | LXC : `/etc/systemd/system/` (service principal) | **C, relevé** | contenu du service principal relevé (§ 4.2) ; activé, actif ; contenu de `cloudflared-update.service` **D** |
| 10 | Tunnel côté Cloudflare (nom, routes publiques, règles Access) | tableau de bord Cloudflare | **D** | non exposé par les relevés du conteneur |
| 10 | `cloudflared` sur l'hôte | hôte | **D** | seulement constaté : absent du `PATH` de `root` ; ne prouve pas l'absence sur tout l'hôte (§ 9). Le tunnel de production est celui du conteneur |
| 10 | Hôte Proxmox | hôte | **C, relevé** | `proxmox-ve` 9.2.0, `pve-manager` 9.1.11, noyau 6.17.2-1-pve, `Europe/Paris` |
| 10 | Cloudflare Access, DNS | tableau de bord Cloudflare | **C, décrit** | règles en [exploitation.md § 0](exploitation.md#0-installation-actuelle-production) ; configuration exacte non relevée |
| 11 | Mise à jour, déploiement, restauration | — | **C, décrit** | [exploitation.md § 4 à 6](exploitation.md#4-sauvegardes) ; test de restauration réel réussi |
| 12 | `cms/.env` | LXC | **E** (valeurs) ; noms **C, relevé** | 21 variables (§ 8) |
| 12 | Jeton du tunnel | LXC : `/etc/cloudflared/token` (`root:root`, `600`, relevé ; contenu jamais lu) | **E** | § 8 |
| 12 | Clé SSH de déploiement, comptes du CMS, bases, sauvegardes, rapports | LXC, G-RAID | **E** | § 8 |

### 2.1 Fichiers de l'hôte : source dans le dépôt → chemin installé

| Source (dépôt) | Installé sur l'hôte | Propriétaire, mode installés | Origine du contenu |
|---|---|---|---|
| `cms/deploy/proxmox/tnd-cms-backup-safe.sh` | `/usr/local/sbin/tnd-cms-backup-safe.sh` | `root:root`, `750` (relevé) | copie exacte du relevé du 27/10/2026 |
| `cms/deploy/proxmox/tnd-cms-backup.service` | `/etc/systemd/system/tnd-cms-backup.service` | `root:root`, `644` (relevé) | copie exacte du relevé |
| `cms/deploy/proxmox/tnd-cms-backup.timer` | `/etc/systemd/system/tnd-cms-backup.timer` | `root:root`, `644` (relevé) | copie exacte du relevé |
| `cms/deploy/proxmox/tnd-cms-restore-test.sh` | `/usr/local/sbin/tnd-cms-restore-test.sh` | `root:root`, `755` (procédure d'installation) | écrit dans le dépôt, installé par `pct pull` |
| `cms/deploy/proxmox/tnd-cms-restore-test.service` | `/etc/systemd/system/tnd-cms-restore-test.service` | `root:root`, `644` (procédure) | idem |
| `cms/deploy/proxmox/tnd-cms-restore-test.timer` | `/etc/systemd/system/tnd-cms-restore-test.timer` | `root:root`, `644` (procédure) | idem |

Dans le dépôt, Git ne conserve que « exécutable ou non » : les scripts y sont en `755`. Le mode installé
est celui du tableau. Les trois fichiers de la sauvegarde quotidienne sont versionnés **sans aucune
modification** (pas même un commentaire d'en-tête), pour rester comparables octet par octet avec la
production ; leur documentation est ici. Toute évolution se fait dans le dépôt, puis est réinstallée
(§ 10 D), jamais l'inverse sans relevé.

Comparaison des empreintes SHA-256 (27/10/2026) : sources de la copie de travail du dépôt (test de
restauration : version du commit `0515ee1`) et fichiers **installés sur l'hôte** (relevé de
l'exploitant). À refaire, et ce tableau à mettre à jour, après toute modification de l'un d'eux :

| Fichier | SHA-256 de la source (dépôt) | SHA-256 installé (production) | Résultat |
|---|---|---|---|
| `tnd-cms-backup-safe.sh` | `30a293fb2355b69151d738d58fc713337d64497fd76f2911d9f4e27aab956f04` | `30a293fb2355b69151d738d58fc713337d64497fd76f2911d9f4e27aab956f04` | identique et vérifié |
| `tnd-cms-backup.service` | `4540122311c5b8d148f6a949db14b687f20c77f6b9fc852e08a58657331be97a` | `4540122311c5b8d148f6a949db14b687f20c77f6b9fc852e08a58657331be97a` | identique et vérifié |
| `tnd-cms-backup.timer` | `30a4c76ed0f7f8ce1642620284e217437d7e549666e2c15259370b6b9f94b778` | `30a4c76ed0f7f8ce1642620284e217437d7e549666e2c15259370b6b9f94b778` | identique et vérifié |
| `tnd-cms-restore-test.sh` | `ec8256f181d948eb5b6f0c6dd0b95ea8606cfdb756df9fd2b66d2ef56306b9e4` | `ec8256f181d948eb5b6f0c6dd0b95ea8606cfdb756df9fd2b66d2ef56306b9e4` | identique et vérifié |
| `tnd-cms-restore-test.service` | `15d34bc230c971688a512643a9aa62a0d12a10e7028eb64cb04508b723937e32` | `15d34bc230c971688a512643a9aa62a0d12a10e7028eb64cb04508b723937e32` | identique et vérifié |
| `tnd-cms-restore-test.timer` | `7bd0de1bfef7c8c3e4a9c52dc82520b061d5ebf185207c90e460c7dcc1e5ee84` | `7bd0de1bfef7c8c3e4a9c52dc82520b061d5ebf185207c90e460c7dcc1e5ee84` | identique et vérifié |

Les trois fichiers de la sauvegarde quotidienne **n'existent pas** dans la copie du site déployée dans le
conteneur (`/srv/tnd-cms/site/cms/deploy/proxmox/`) : ils ont été ajoutés au dépôt après le dernier
déploiement. Ils sont pourtant bien installés sur l'hôte, aux chemins ci-dessus ; leur comparaison se
fait donc avec la copie de travail du dépôt. Tant qu'un déploiement ne les a pas apportés dans le
conteneur, la méthode `pct pull` du § 10 D ne s'applique pas à eux (copier alors depuis le dépôt par un
autre canal, puis contrôler l'empreinte).

### 2.2 Sources versionnées et version déployée

Versionner une source (ce dépôt) et savoir **quelle version** tourne en production sont deux choses
différentes. Les six fichiers de l'hôte sont identifiés par leur empreinte (§ 2.1) et `tnd-cms.service`
aussi (§ 2) ; en revanche, la version du site et du CMS déployée dans `/srv/tnd-cms/site` **n'a pas pu
être déterminée** : lors du relevé, `git rev-parse --is-inside-work-tree` n'y a pas reconnu de dépôt Git
exploitable. Aucun commit de la copie de travail ne doit donc être présenté comme celui de la production.

Ce résultat est à éclaircir (§ 9) : la mise en ligne du CMS et `update-cms.sh` utilisent Git dans ce
dossier, **sous le compte `tnd-cms`** (`as_cms`). Une commande Git lancée par `root` sur un dépôt
appartenant à un autre compte peut être refusée (« dubious ownership »), ce qui expliquerait le
résultat ; c'est une **hypothèse**, à vérifier avec le compte `tnd-cms`.

Script de mise à jour, chemin absolu fiable, en root dans le conteneur :
`/usr/local/bin/update-cms` (lien relevé vers `/srv/tnd-cms/site/cms/deploy/update-cms.sh`), ou
directement `sh /srv/tnd-cms/site/cms/deploy/update-cms.sh`. La commande courte `update-cms` dépend du
`PATH` du shell : elle n'a pas été trouvée dans celui du relevé.

## 3. Chemins

| Rôle | Chemin | Lieu |
|---|---|---|
| Copie du site (installée comme dépôt Git selon [exploitation.md § 2](exploitation.md#2-installation-sur-le-serveur) ; non reconnue par `git rev-parse` lors du relevé, § 2.2) | `/srv/tnd-cms/site` (= `~tnd-cms/site`) | LXC |
| Configuration du CMS (hors Git, `chmod 600`) | `/srv/tnd-cms/site/cms/.env` | LXC |
| Données du CMS (`CMS_DATA_DIR`) | `/srv/tnd-cms/data` | LXC |
| Base SQLite active | `/srv/tnd-cms/data/cms.sqlite` | LXC |
| Sauvegardes locales de la base | `/srv/tnd-cms/data/backups/cms-AAAAMMJJ-HHMMSS[-étiquette].sqlite` | LXC |
| Originaux des images importées | `/srv/tnd-cms/data/media/originals/` | LXC |
| Cache des variantes (recalculable) | `/srv/tnd-cms/data/media/cache/` | LXC |
| Rapports lus par Santé du CMS | `/srv/tnd-cms/data/status/backup-externe.json`, `restore-test.json` | LXC |
| Copie externe vue du conteneur | `/mnt/tnd-backups/` (`backups/`, `originals/`, `.tnd-backup-target`) | LXC |
| Point de montage du G-RAID | `/mnt/yPlexLib` | hôte |
| Copie externe vue de l'hôte | `/mnt/yPlexLib/sauvegardes/tnd-cms/` | hôte |
| Dossier temporaire du test de restauration | `/var/tmp/tnd-restore-externe-XXXXXX` (supprimé après chaque test) | LXC |
| Verrou du test de restauration | `/run/tnd-cms-restore-test.lock` | hôte |

## 4. Services, minuteurs et horaires

| Unité | Lieu | Rôle | Horaire | Source |
|---|---|---|---|---|
| `tnd-cms.service` | LXC | serveur du CMS (planificateur intégré : sauvegarde locale toutes les 24 h, programmations) | permanent | `cms/deploy/tnd-cms.service`, **identique** à la copie installée (§ 2) |
| `cloudflared.service` | LXC : `/etc/systemd/system/cloudflared.service` | tunnel vers Cloudflare (`/usr/bin/cloudflared`, version `2026.10.3`, build du 2026-10-21) | permanent ; **activé et actif** lors du relevé, aucun `DropInPaths` | hors dépôt ; contenu relevé au § 4.2 |
| `cloudflared-update.timer` → `cloudflared-update.service` | LXC | mise à jour de `cloudflared` (d'après le nom : contenu **non relevé**) | minuteur présent : dernière exécution le 27/10/2026 à 00:00 UTC, suivante le 28/10/2026 à 00:00 UTC (relevé) ; service `static`, inactif lors du relevé | hors dépôt |
| `tnd-cms-backup.timer` → `.service` | hôte | sauvegarde externe quotidienne | tous les jours 06:00, `Persistent=true` | versionné, identique à la production (§ 2.1) |
| `tnd-cms-restore-test.timer` → `.service` | hôte | test de restauration de la copie externe | dimanche 06:30, `Persistent=true` | versionné, identique à la production (§ 2.1) |

Horaires en heure de l'hôte (`Europe/Paris`). `Persistent=true` : une exécution manquée (hôte éteint)
est rattrapée au démarrage suivant. Le test de restauration attend la fin de `tnd-cms-backup.service`
s'il tourne encore ; il ne le modifie ni ne le démarre.

| Réglage du service | `tnd-cms-backup.service` (relevé) | `tnd-cms-restore-test.service` (dépôt) |
|---|---|---|
| Type, délai | `oneshot`, `TimeoutStartSec=2h` | `oneshot`, `TimeoutStartSec=2h` |
| Priorité | `Nice=10`, `IOSchedulingClass=best-effort`, `IOSchedulingPriority=7` | idem |
| `UMask` | `0077` | non défini (défaut de systemd) |
| Réglages par `Environment=` | aucun : valeurs écrites dans le script | tous (UUID, chemins, conteneur, délais) |
| Arrêt | défaut (`KillMode=control-group`) | `KillMode=mixed`, arrêt ciblé du test (voir [exploitation.md § 4](exploitation.md#4-sauvegardes)) |
| Ordre | `After=local-fs.target` | `After=local-fs.target pve-guests.service tnd-cms-backup.service` |

### 4.1 `tnd-cms-backup-safe.sh` : fonctionnement

Usage : `tnd-cms-backup-safe.sh [--check|--run]` (`--run` par défaut ; le service passe `--run`).

1. **Disque** : `findmnt -T /mnt/yPlexLib` doit donner l'UUID attendu **et** la cible `/mnt/yPlexLib`
   (sinon, le chemin appartiendrait au disque système : refus) ; le dossier `…/sauvegardes/tnd-cms`
   doit exister et son marqueur contenir exactement l'UUID.
2. **Conteneur** : `pct status 126` doit indiquer `running` ; dans le conteneur, `findmnt -T
   /mnt/tnd-backups` doit avoir pour cible `/mnt/tnd-backups` (vrai point de montage) et le marqueur lu
   doit être l'UUID.
3. `--check` s'arrête là (« Aucune sauvegarde exécutée ») : **vérification sans effet**, utilisable à
   tout moment.
4. `--run` : `pct exec 126 -- runuser -u tnd-cms -- env CMS_DATA_DIR=/srv/tnd-cms/data
   TND_BACKUP_DEST=/mnt/tnd-backups TND_BACKUP_VERIFY=1 /bin/sh
   /srv/tnd-cms/site/cms/deploy/backup-media.sh` (`exec` : le code de sortie du service est celui de
   `backup-media.sh`).

Variables transmises à la sauvegarde :

| Variable | Valeur | Rôle |
|---|---|---|
| `CMS_DATA_DIR` | `/srv/tnd-cms/data` | données du CMS (prioritaire sur `cms/.env`) |
| `TND_BACKUP_DEST` | `/mnt/tnd-backups` | destination rsync : `backups/` et `originals/` y sont copiés |
| `TND_BACKUP_VERIFY` | `1` | vérification de la copie par somme de contrôle (rapport `backup-externe.json`) |

Comportements à connaître (constatés à la lecture du script, **non modifiés**) :
- un échec d'une vérification de l'hôte n'apparaît que dans le journal systemd : le rapport
  `backup-externe.json` n'est pas mis à jour, et Santé du CMS signale alors la sauvegarde comme ancienne
  (avertissement après `CMS_EXTERNAL_BACKUP_MAX_HOURS`, 36 h par défaut, erreur au double) ;
- `env` sans `-i` : l'environnement de `runuser` est transmis, les trois variables ci-dessus le
  complètent ; `backup-media.sh` lance `npm run cms:admin -- backup`, qui lit aussi `cms/.env` pour le
  reste de la configuration et, comme toute commande `cms:admin`, applique les migrations en attente ;
- pas de verrou : deux lancements simultanés (manuel et minuteur) ne sont pas empêchés ;
- le marqueur est comparé **exactement** (seule la fin de ligne finale est ignorée) : un espace ou un
  retour chariot Windows le rend non conforme.

### 4.2 `cloudflared.service` (relevé dans le conteneur)

Contenu relevé de `/etc/systemd/system/cloudflared.service` (aucun secret : le jeton est dans un fichier
séparé, jamais lu) :

```ini
[Unit]
Description=Cloudflare Tunnel client
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=15
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token-file /etc/cloudflared/token
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

- Le tunnel est désigné par le jeton de `/etc/cloudflared/token` (`root:root`, `600`), seul fichier
  trouvé dans les dossiers de configuration inspectés (pas de `config.yml`). Un tunnel lancé par jeton
  sans configuration locale est normalement géré depuis le tableau de bord Cloudflare (routes publiques
  comprises) : c'est une **déduction** du fonctionnement de `cloudflared`, les routes n'ont pas été
  relevées.
- `--no-autoupdate` : le binaire ne se remplace pas lui-même. Son évolution dépend donc d'une autre
  voie : mises à jour du paquet APT, et peut-être `cloudflared-update.service` (contenu non relevé : son
  rôle exact reste inconnu).
- Cette unité n'est pas versionnée (ce n'est pas une source du projet) ; elle est reproduite ici pour la
  reconstruction (§ 10 B.5).

## 5. Disque G-RAID et marqueur

- UUID attendu : `f5b884b5-a8c9-45f2-8275-3bfe71bb5a95` ; système de fichiers ext4 ; point de montage
  `/mnt/yPlexLib` ; périphérique `/dev/sdd1` lors du relevé (le nom peut changer : seul l'UUID compte).
- Ligne réelle de `/etc/fstab` :

  ```
  UUID=f5b884b5-a8c9-45f2-8275-3bfe71bb5a95 /mnt/yPlexLib ext4 defaults,nofail 0 2
  ```

  `nofail` : l'hôte démarre même si le G-RAID est absent ; `/mnt/yPlexLib` est alors un simple dossier
  du disque système, d'où les contrôles d'UUID et de marqueur avant toute écriture. `0 2` : pas de
  `dump`, vérification `fsck` après la racine.
- Dossier de sauvegarde : `/mnt/yPlexLib/sauvegardes/tnd-cms`, propriétaire `100999:100991`, mode `750`
  (§ 6).
- Marqueur : `/mnt/yPlexLib/sauvegardes/tnd-cms/.tnd-backup-target`, fichier ordinaire contenant
  **exactement** l'UUID ci-dessus, suivi au plus d'une fin de ligne (pas d'espace : le script de
  sauvegarde le compare à l'identique ; le test de restauration, lui, ignore les espaces). Il prouve que
  le dossier vu est bien celui du G-RAID et non un dossier local créé à la place du point de montage. Il
  est vérifié par `tnd-cms-backup-safe.sh` et `tnd-cms-restore-test.sh` (sur l'hôte, puis lu depuis le
  conteneur) et par `cms/bin/restore-test.mjs`. Propriétaire et mode relevés : `100999:100991` (soit
  `tnd-cms` dans le conteneur), mode `440` (lecture seule, propriétaire et groupe). Il est lu par `root`
  sur l'hôte, par `root` du conteneur (`pct exec … cat`, dont l'UID est dans la plage du conteneur) et par
  `tnd-cms` ; personne ne doit pouvoir le modifier depuis le conteneur sans changer d'abord son mode.

Recréer le marqueur (seulement après un remplacement du disque, ou s'il a été supprimé ; jamais pour
« faire passer » un contrôle en échec) :

```sh
# Sur l'hôte. 1) Le point de montage est bien un montage, depuis le bon disque :
findmnt -M /mnt/yPlexLib
blkid -s UUID -o value "$(findmnt -rn -M /mnt/yPlexLib -o SOURCE)"   # doit afficher l'UUID attendu
# 2) Le dossier existe sur ce disque (le créer sinon, voir § 10 A), puis écrire le marqueur :
printf '%s\n' f5b884b5-a8c9-45f2-8275-3bfe71bb5a95 > /mnt/yPlexLib/sauvegardes/tnd-cms/.tnd-backup-target
chown 100999:100991 /mnt/yPlexLib/sauvegardes/tnd-cms/.tnd-backup-target     # comme en production (§ 6)
chmod 440 /mnt/yPlexLib/sauvegardes/tnd-cms/.tnd-backup-target
# 3) Contrôle complet, sans sauvegarde :
/usr/local/sbin/tnd-cms-backup-safe.sh --check
```

Si le G-RAID est remplacé par un autre disque, son UUID change : il faut alors mettre à jour, ensemble,
`fstab`, le marqueur, le script de sauvegarde de l'hôte et `TND_GRAID_UUID` du test de restauration
(`systemctl edit tnd-cms-restore-test.service`), puis ce document.

### 5.1 Conteneur 126 « TnDweb » (relevé)

| Réglage | Valeur |
|---|---|
| Nom, architecture | `hostname: TnDweb`, `arch: amd64` |
| Système | `ostype: debian` ; Debian GNU/Linux 13 (trixie) |
| Type | `unprivileged: 1` ; `features: nesting=1` ; aucune ligne `lxc.idmap` ni `lxc.mount.entry` |
| Ressources | `cores: 1`, `memory: 1024`, `swap: 1024` |
| Racine | `local-lvm:vm-126-disk-0,size=10G` |
| Réseau | `net0: name=eth0,bridge=vmbr0,firewall=1,gw=192.168.1.254,ip=192.168.1.50/24,ip6=auto,type=veth` (adresse MAC `hwaddr` relevée, volontairement non reportée : Proxmox en attribue une nouvelle à la création) |
| Point de montage | `mp0: /mnt/yPlexLib/sauvegardes/tnd-cms,mp=/mnt/tnd-backups,backup=0` |
| **Absents** de la configuration | `onboot`, `startup`, `nameserver`, `searchdomain` |
| Pare-feu | `firewall=1` sur `net0` ; fichier `/etc/pve/firewall/126.fw` **absent** (relevé) : aucune règle ni option propre au conteneur. Les niveaux supérieurs (`cluster.fw`, `host.fw`) ne sont **pas** inventoriés : rien ne permet de dire si un filtrage s'applique (§ 9) |
| Non relevés | modèle (template) exact ayant servi à la création |

Conséquences des réglages absents (constat, rien n'a été modifié) :
- **pas d'`onboot`** : Proxmox ne démarre **pas** le conteneur après un redémarrage de l'hôte. Le CMS
  reste arrêté jusqu'à un `pct start 126` manuel ; la sauvegarde de 06:00 échoue alors (« le LXC 126
  n'est pas démarré », dans le journal seulement) et le test de restauration attend 10 min puis échoue
  sans rapport. Pour un démarrage automatique : `pct set 126 -onboot 1` — **décision de l'exploitant**,
  non appliquée ;
- **pas de `nameserver` ni `searchdomain`** : le conteneur reprend la configuration DNS de l'hôte
  (comportement par défaut de Proxmox).

`backup=0` : le dossier monté n'est pas inclus dans une sauvegarde `vzdump` du conteneur (il est
lui-même la sauvegarde). Le disque racine fait 10 Go : le test de restauration vérifie l'espace libre de
`/var/tmp` avant de copier quoi que ce soit.

## 6. Conteneur non privilégié : UID/GID et permissions

Dans un conteneur non privilégié, les UID et GID du conteneur sont décalés sur l'hôte. **Par défaut**
(sans ligne `lxc.idmap` dans `/etc/pve/lxc/126.conf`), Proxmox fait correspondre les UID 0 à 65535 du
conteneur aux UID 100000 à 165535 de l'hôte : `root` du conteneur est `100000` sur l'hôte, et un compte
d'UID `N` dans le conteneur est `100000 + N` sur l'hôte (idem pour les GID).

Valeurs relevées (aucune ligne `lxc.idmap` : correspondance par défaut, cohérente avec les chiffres) :

| Élément | Dans le conteneur | Sur l'hôte | Mode |
|---|---|---|---|
| Compte `tnd-cms` | UID `999`, GID `991` | `100999`, `100991` | — |
| Copie externe (`/mnt/tnd-backups` ↔ `/mnt/yPlexLib/sauvegardes/tnd-cms`) | `999:991` | `100999:100991` | `750` |
| Rapports `/srv/tnd-cms/data/status` | `999:991` | — | `755` |

Le mode `750` réserve la copie externe à `tnd-cms` (et à `root` de l'hôte) : les sauvegardes contiennent
les empreintes des mots de passe. `/etc/subuid` et `/etc/subgid` n'ont pas été relevés (inutile tant
qu'il n'y a pas de correspondance personnalisée).

Besoins (déduits des scripts) :

| Qui (dans le conteneur) | Accès | Où |
|---|---|---|
| `tnd-cms` (sauvegarde : `backup-media.sh`, lancé sous ce compte par `tnd-cms-backup-safe.sh`) | écriture | `/mnt/tnd-backups/backups/`, `/mnt/tnd-backups/originals/` |
| `tnd-cms` (test de restauration) | lecture | `/mnt/tnd-backups/` entier, marqueur compris |
| `tnd-cms` | écriture | `/srv/tnd-cms/data/status/`, `/var/tmp` |
| service `tnd-cms` (même compte) | lecture | `/srv/tnd-cms/data/status/*.json` |

Vérifier la situation (après une reconstruction, ou en cas d'erreur de droits) :

```sh
# Hôte
pct config 126 | grep -E '^(unprivileged|mp[0-9]+|lxc\.idmap)'
grep -E '^root:' /etc/subuid /etc/subgid
ls -lna /mnt/yPlexLib/sauvegardes/tnd-cms /mnt/yPlexLib/sauvegardes/tnd-cms/backups | head
# Conteneur
pct exec 126 -- id tnd-cms
pct exec 126 -- ls -lna /mnt/tnd-backups
```

Un fichier créé par `root` sur l'hôte apparaît comme `nobody` dans le conteneur : il reste lisible s'il
est en `644` (cas d'un marqueur recréé selon le § 5, le dossier `750` appartenant à `tnd-cms`), mais pas
modifiable. Si l'UID de `tnd-cms` change (conteneur recréé, compte recréé), le propriétaire de la copie
externe sur l'hôte doit suivre : `100000 + nouvel UID`.

## 7. Dépendances système

| Lieu | Paquets ou commandes | Utilisés par |
|---|---|---|
| Hôte | Proxmox VE (relevé : `proxmox-ve` 9.2.0, `pve-manager` 9.1.11, noyau 6.17.2-1-pve), fuseau `Europe/Paris` | tout |
| Hôte | `pct`, `systemd`, `findmnt`, `flock` (util-linux), `ps`, `pkill` (procps), `grep`, `awk`, `tr` ; `blkid` en secours | `tnd-cms-backup-safe.sh`, `tnd-cms-restore-test.sh` |
| LXC | Debian GNU/Linux 13 (trixie) | tout |
| LXC | Node.js ≥ 22.13 (`engines`) : relevé `v24.22.1`, paquet `nodejs` `24.22.1-1nodesource1` du dépôt NodeSource (`https://deb.nodesource.com/node_24.x nodistro/main`), qui fournit `/usr/bin/node` ; `npm` relevé `11.19.1` (fourni avec ce paquet) | CMS, `update-cms`, test de restauration |
| LXC | `git` (relevé `2.47.3`) | CMS (mise en ligne), `update-cms` |
| LXC | `rsync` (relevé `3.5.0`, protocole 32), `/bin/sh` | `backup-media.sh` |
| LXC | `curl` (relevé `8.14.1`) | `update-cms` (vérification `/healthz`) |
| LXC | `runuser` (relevé : `/sbin/runuser`), `findmnt`, `cat` (util-linux, coreutils) | sauvegarde et test, lancés depuis l'hôte |
| LXC | `pkill` (relevé : `/bin/pkill`, procps) | arrêt ciblé du test de restauration |
| LXC | `cloudflared` : paquet `cloudflared` `2026.10.3` (version installée et candidate lors du relevé), dépôt APT `https://pkg.cloudflare.com/cloudflared` suite `any`, composant `main`, `amd64` ; fournit `/usr/bin/cloudflared` (`/bin/cloudflared` par le lien `/bin` → `/usr/bin`) | accès public à l'administration |
| npm | `sharp` (seule dépendance, `package-lock.json`) | traitement des images |

Les versions ci-dessus sont celles **installées lors du relevé du 27/10/2026**, pas des versions
garanties : `apt upgrade` les fait évoluer (Node.js dans la branche 24.x de NodeSource). `update-cms`
ne met jamais Node.js à jour.

### 7.1 Installer Node.js comme en production (Debian 13)

Méthode constatée : dépôt APT NodeSource, branche `node_24.x`. Sur un conteneur neuf, en root, après
avoir **lu** le script d'installation de NodeSource (il ajoute la clé et le fichier de dépôt APT) :

```sh
apt-get update && apt-get install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x -o /root/nodesource_setup.sh
less /root/nodesource_setup.sh                         # relire avant d'exécuter
bash /root/nodesource_setup.sh
apt-get install -y nodejs                              # dernière 24.x disponible ce jour-là
apt-cache policy nodejs                                # origine : deb.nodesource.com node_24.x
node -v && npm -v && command -v node                   # /usr/bin/node
```

Pour reprendre exactement la version relevée (si NodeSource la propose encore) :
`apt-get install -y nodejs=24.22.1-1nodesource1`. Une autre version 24.x convient au CMS (`engines` :
≥ 22.13 ; CI en Node 24) ; après tout changement de version majeure, relancer `npm ci --omit=dev` (module
`sharp`). Aucun script du dépôt n'installe ni ne met à jour Node.js : c'est volontaire.

## 8. Configuration hors Git

Jamais dans le dépôt (`.gitignore` : `cms/.env`, `.cms-data/`, `*.sqlite*`), ni dans un rapport, ni dans
ce document. À conserver dans un gestionnaire de mots de passe ou un stockage chiffré, **séparément**
des sauvegardes du G-RAID :

| Élément | Où | Secret ? | Reconstruction |
|---|---|---|---|
| `cms/.env` (`tnd-cms`, `600`) | LXC : `/srv/tnd-cms/site/cms/.env` | oui pour `CMS_GOATCOUNTER_TOKEN` ; le reste est de la configuration | restaurer la copie conservée en lieu sûr, ou recréer depuis `cms/.env.example` avec des valeurs adaptées (liste des variables ci-dessous ; réglages connus : [exploitation.md § 0 et § 2](exploitation.md#2-installation-sur-le-serveur)) |
| Clé SSH de déploiement GitHub | LXC : `~tnd-cms/.ssh/` | oui | en créer une nouvelle (GitHub → Deploy keys, écriture), retirer l'ancienne |
| Jeton du tunnel `cloudflared` | LXC : `/etc/cloudflared/token` (`root:root`, `600` ; seul fichier trouvé dans les dossiers de configuration inspectés ; contenu jamais lu) | oui | restaurer le jeton conservé en lieu sûr au même chemin et avec les mêmes droits, ou en obtenir un nouveau dans Cloudflare Zero Trust (tunnel existant) |
| Comptes du CMS (empreintes de mots de passe) | base SQLite | oui (empreintes) | restaurés avec la base |
| Cloudflare Access, DNS | tableau de bord Cloudflare | — | règles décrites en [exploitation.md § 0](exploitation.md#0-installation-actuelle-production) |

Variables présentes dans le `cms/.env` de production (relevé du 27/10/2026 : **noms seulement**, aucune
valeur n'a été relevée ni ne doit l'être) :

`CMS_AUTO_PUBLISH_SCHEDULED`, `CMS_BACKUP_EVERY_HOURS`, `CMS_BACKUP_KEEP`, `CMS_DATA_DIR`,
`CMS_GIT_AUTHOR_EMAIL`, `CMS_GIT_AUTHOR_NAME`, `CMS_GIT_BRANCH`, `CMS_GIT_REMOTE`,
`CMS_GOATCOUNTER_TOKEN`, `CMS_HOST`, `CMS_LOG_LEVEL`, `CMS_MAX_UPLOAD_MB`, `CMS_PORT`, `CMS_PUBLIC_URL`,
`CMS_PUBLISH_MODE`, `CMS_RUN_MAPS`, `CMS_SCHEDULER`, `CMS_SESSION_IDLE_MINUTES`, `CMS_SESSION_MAX_HOURS`,
`CMS_SITE_DIR`, `CMS_TRUST_PROXY`.

Les autres variables de `cms/.env.example` (dont `CMS_GITHUB_TOKEN`, `CMS_GOATCOUNTER_URL`,
`CMS_EXTERNAL_BACKUP_MAX_HOURS`, `CMS_RESTORE_TEST_MAX_HOURS`) sont absentes : le CMS applique leur
valeur par défaut ([README du CMS, § 6](README.md#6-configuration-cmsenv)). Les scripts lancés depuis
l'hôte ne dépendent pas de ce fichier pour leurs chemins (variables explicites, § 4.1), sauf
`backup-media.sh`, dont la commande `cms:admin -- backup` le lit.

## 9. Ce qui reste à extraire de Proxmox

Relevés du 27/10/2026 intégrés (tous en lecture seule, faits par l'exploitant) :
1. hôte, `fstab`, LXC 126, UID/GID, permissions, script et unités de la sauvegarde quotidienne ;
2. configuration complète du LXC 126, marqueur, `cloudflared` absent du `PATH` de `root` sur l'hôte. La
   partie conteneur de ce relevé était **sans résultat** (commandes `pct` lancées dans le conteneur) ;
3. conteneur : comparaison de `tnd-cms.service` (identique au modèle), Debian 13, Node.js et origine
   NodeSource, versions des outils, lien `update-cms`, noms des variables de `cms/.env`, `cloudflared`
   (présence, version, unités, fichier de jeton : nom et droits seulement) ;
4. empreintes des six fichiers installés sur l'hôte (**identiques** aux sources, § 2.1), absence de
   `/etc/pve/firewall/126.fw`, paquet et dépôt APT de `cloudflared`, contenu de `cloudflared.service`,
   `cloudflared-update.timer`, site déployé sans dépôt Git reconnu par `git rev-parse`.

Restent à relever, **sans rien réécrire de mémoire** (relire la sortie, retirer tout secret, puis
reporter ici ou versionner dans `cms/deploy/`) :

| Élément | Pourquoi | Où le reporter |
|---|---|---|
| Version déployée dans `/srv/tnd-cms/site` | `git rev-parse` n'a pas reconnu de dépôt (par `root` ?) ; à refaire **sous `tnd-cms`** (§ 2.2) | § 2, § 2.2 |
| Pare-feu de niveau supérieur | `126.fw` absent ; `cluster.fw` et `host.fw` non inventoriés | § 5.1 |
| Modèle (template) Debian de la création du conteneur | reconstruction à l'identique | § 10 A.4 |
| Commandes d'installation initiales de `cloudflared` (ajout du dépôt APT, de sa clé) | seuls le paquet et le dépôt sont relevés | § 10 B.5 |
| Contenu de `cloudflared-update.service` et de `cloudflared-update.timer` | seuls les noms, l'état et les dates sont relevés | § 4 |
| Tunnel côté Cloudflare (nom, routes, règles Access) | hors du conteneur | § 8 |
| `cloudflared` ailleurs sur l'hôte | l'absence du `PATH` de `root` ne prouve pas l'absence | § 2 |

**1. Sur l'hôte** (`root@yHomeLab:~#`, **sans** `pct enter`) :

```sh
cat /etc/pve/firewall/cluster.fw 2>/dev/null || echo "aucun /etc/pve/firewall/cluster.fw"
cat "/etc/pve/nodes/$(hostname)/host.fw" 2>/dev/null || echo "aucun host.fw pour ce nœud"
pve-firewall status
for f in $(grep -rl ':vzcreate:126:' /var/log/pve/tasks/ 2>/dev/null); do grep -h 'archive' "$f"; done   # modèle, si le journal de création existe encore
ls -l /var/lib/vz/template/cache/ 2>/dev/null
dpkg -l cloudflared 2>/dev/null | tail -n 1; systemctl list-unit-files 'cloudflared*' --no-pager; ls -l /usr/bin/cloudflared /usr/local/bin/cloudflared 2>&1
```

Les fichiers de pare-feu ne contiennent normalement pas de secret, mais peuvent nommer des adresses
internes : relire avant de transmettre.

**2. Dans le conteneur** (`pct enter 126`, `root@TnDweb:~#`, **aucune** commande `pct`) ; une ligne à la
fois :

```sh
runuser -u tnd-cms -- git -C /srv/tnd-cms/site rev-parse --is-inside-work-tree
runuser -u tnd-cms -- git -C /srv/tnd-cms/site log -1 --format='%H %ci %s'
runuser -u tnd-cms -- git -C /srv/tnd-cms/site status --short | head
ls -ld /srv/tnd-cms/site/.git
systemctl cat cloudflared-update.service cloudflared-update.timer
ls -l /etc/apt/sources.list.d/ /usr/share/keyrings/ 2>/dev/null | grep -i cloudflare
echo "$PATH"; command -v update-cms
```

Ne **jamais** afficher `/etc/cloudflared/token` ni aucun fichier d'identifiants.

Ne **pas** copier dans le dépôt : `cms/.env`, `/etc/cloudflared/token`, `~/.ssh/`, une base, une
sauvegarde, un rapport de `status/`, le marqueur lui-même, l'adresse MAC du conteneur.

## 10. Reconstruction sur un hôte neuf

Ordre impératif : disque et montage d'abord, conteneur et CMS ensuite, données, puis tâches planifiées.
Chaque étape renvoie à la procédure détaillée quand elle existe. Les éléments marqués ⚠ dépendent
d'informations **encore inconnues** (§ 9) : l'étape doit alors être faite à la main et revalidée, pas
supposée identique à la production.

### 10.0 Valeurs propres à cette installation

À vérifier, et à adapter **partout** où elles apparaissent avant de reconstruire sur un autre serveur,
un autre disque ou un autre numéro de conteneur :

| Valeur | Production | Écrite en dur dans | Réglable sans modifier le fichier |
|---|---|---|---|
| UUID du G-RAID | `f5b884b5-a8c9-45f2-8275-3bfe71bb5a95` | `fstab`, marqueur, `tnd-cms-backup-safe.sh` (`EXPECTED_UUID`), `tnd-cms-restore-test.service` | test : `TND_GRAID_UUID` |
| Point de montage de l'hôte | `/mnt/yPlexLib` | `fstab`, `tnd-cms-backup-safe.sh` (`HOST_MOUNT`) | test : `TND_GRAID_MOUNT` |
| Dossier de sauvegarde de l'hôte | `/mnt/yPlexLib/sauvegardes/tnd-cms` | `mp0`, `tnd-cms-backup-safe.sh` (`HOST_DEST`) | test : `TND_BACKUP_TARGET` |
| Numéro du conteneur | `126` | `tnd-cms-backup-safe.sh` (`CTID`) | test : `TND_CTID` |
| Montage dans le conteneur | `/mnt/tnd-backups` | `mp0`, `tnd-cms-backup-safe.sh` (en dur, deux fois) | test : `TND_CT_MOUNT` |
| Compte du CMS | `tnd-cms` (UID 999, GID 991) | `tnd-cms-backup-safe.sh`, `tnd-cms.service`, propriétaire de la copie externe | test : `TND_CT_USER` |
| Chemins du CMS | `/srv/tnd-cms/site`, `/srv/tnd-cms/data` | `tnd-cms-backup-safe.sh`, `tnd-cms.service` | test : `TND_CT_SITE`, `TND_CT_DATA` |
| Unité de sauvegarde attendue par le test | `tnd-cms-backup.service` | `tnd-cms-restore-test.service` | `TND_BACKUP_UNIT` |

Pour le test de restauration : `systemctl edit tnd-cms-restore-test.service` (fichier installé
inchangé). Pour la sauvegarde quotidienne, aucune variable : toute adaptation modifie le script, à faire
**dans le dépôt** puis à réinstaller (§ 10 D).

### A. Hôte Proxmox

1. Installer Proxmox VE (production : `proxmox-ve` 9.2.0, `pve-manager` 9.1.11), fuseau `Europe/Paris`
   (`timedatectl set-timezone Europe/Paris` : les minuteurs suivent l'heure de l'hôte).
2. Brancher le G-RAID, vérifier son UUID (`blkid`), créer `/mnt/yPlexLib` et ajouter à `/etc/fstab` la
   ligne du § 5 (`UUID=… /mnt/yPlexLib ext4 defaults,nofail 0 2`). `systemctl daemon-reload`,
   `mount /mnt/yPlexLib`, puis `findmnt -M /mnt/yPlexLib`.
3. Si le disque est neuf ou vide : `mkdir -p /mnt/yPlexLib/sauvegardes/tnd-cms`, puis le marqueur (§ 5).
   Si c'est le disque existant : **ne rien recréer**, vérifier seulement le marqueur ; les sauvegardes
   s'y trouvent (`backups/`, `originals/`).
4. Créer le conteneur 126 non privilégié depuis un modèle Debian 13 ⚠ (modèle exact non relevé :
   `pveam available --section system | grep debian-13`), avec les réglages relevés du § 5.1 :

   ```sh
   pct create 126 local:vztmpl/<modèle debian-13>.tar.zst --unprivileged 1 --hostname TnDweb \
     --arch amd64 --ostype debian --cores 1 --memory 1024 --swap 1024 --features nesting=1 \
     --rootfs local-lvm:10 \
     --net0 name=eth0,bridge=vmbr0,firewall=1,gw=192.168.1.254,ip=192.168.1.50/24,ip6=auto,type=veth
   pct set 126 -mp0 /mnt/yPlexLib/sauvegardes/tnd-cms,mp=/mnt/tnd-backups,backup=0
   ```

   Sans `onboot`, comme en production (voir § 5.1 avant de reproduire ce choix). Pare-feu : pas de
   `/etc/pve/firewall/126.fw` en production, donc rien à recréer pour le conteneur ; niveaux supérieurs
   (`cluster.fw`, `host.fw`) ⚠ non relevés. Démarrer le conteneur.
5. Une fois `tnd-cms` créé dans le conteneur (étape B.2) avec **UID 999 et GID 991** (`useradd --uid
   999` et `groupadd --gid 991`, ou constater les valeurs attribuées) : sur l'hôte,
   `chown 100999:100991 /mnt/yPlexLib/sauvegardes/tnd-cms && chmod 750 /mnt/yPlexLib/sauvegardes/tnd-cms`
   si le dossier est neuf. Sur le disque existant, si l'UID a changé : `chown -R <100000+UID>:<100000+GID>`
   de ce seul dossier, après vérification (§ 6).

### B. Dans le conteneur

1. Paquets : Node.js par le dépôt NodeSource `node_24.x` (§ 7.1), puis
   `apt-get install -y git rsync curl util-linux procps` (versions relevées en production : § 7).
2. Compte, clé de déploiement, clone, dépendances, `cms/.env` : [exploitation.md § 2](exploitation.md#2-installation-sur-le-serveur)
   (UID/GID : étape A.5), **sans** `import` ni `create-user` si une sauvegarde existe (étape C).
   `cms/.env` : restaurer la copie conservée en lieu sûr, ou le recréer avec les variables du § 8
   (`chown tnd-cms: … && chmod 600 …`). `/srv/tnd-cms/data/status` : propriétaire `tnd-cms`, mode `755`.
3. Service : `install -o root -g root -m 644 /srv/tnd-cms/site/cms/deploy/tnd-cms.service
   /etc/systemd/system/tnd-cms.service` (modèle **identique** à la production, § 2), puis
   `systemctl daemon-reload` (ne pas encore démarrer). Contrôle : `sha256sum` égal à la valeur du § 2.
4. `update-cms` : `ln -sf /srv/tnd-cms/site/cms/deploy/update-cms.sh /usr/local/bin/update-cms` (lien
   relevé en production). Lors du relevé, `command -v update-cms` n'a rien renvoyé : selon le `PATH` du
   shell (par exemple celui de `pct exec`), la commande courte peut ne pas être trouvée. Dans les
   procédures, utiliser le **chemin absolu**, en root dans le conteneur : `/usr/local/bin/update-cms`
   (ou `sh /srv/tnd-cms/site/cms/deploy/update-cms.sh`, équivalent : le script retrouve le site à partir
   de son propre chemin). Vérification : `ls -l /usr/local/bin/update-cms`.
5. Tunnel :
   - **Paquet** : ajouter le dépôt APT de Cloudflare relevé en production
     (`https://pkg.cloudflare.com/cloudflared`, suite `any`, composant `main`) en suivant les
     instructions officielles de `pkg.cloudflare.com` (clé de signature comprise), puis
     `apt-get install -y cloudflared`. Les commandes exactes utilisées à l'installation initiale ne sont
     **pas** connues ⚠ ; la version installée sera la plus récente du dépôt, pas forcément `2026.10.3`.
   - **Jeton** (secret, § 8) : le récupérer par un canal sûr (gestionnaire de mots de passe, ou nouveau
     jeton du tunnel existant dans Cloudflare Zero Trust), puis le déposer **sans le faire apparaître**
     dans l'historique du shell ni dans un journal :
     `install -d -m 755 /etc/cloudflared && install -m 600 -o root -g root /dev/null /etc/cloudflared/token`,
     puis coller le jeton dans ce fichier avec un éditeur.
   - **Service** : recréer `/etc/systemd/system/cloudflared.service` avec le contenu relevé du § 4.2
     (`root:root`, `644`), puis `systemctl daemon-reload && systemctl enable --now cloudflared`.
     Ne pas utiliser `cloudflared service install <jeton>` : cette commande place le jeton dans la ligne
     de commande de l'unité, contrairement à la production (`--token-file`).
   - **Mise à jour** ⚠ : `cloudflared-update.timer` et `.service` existent en production, mais leur
     contenu n'a pas été relevé (§ 9) : ne pas les recréer de mémoire.
   - Vérifier : `systemctl is-active cloudflared`, accès à `https://admin.teknoneverdies.fr`, règles
     Cloudflare Access.

### C. Données (depuis le G-RAID, dans le conteneur)

```sh
ls -1 /mnt/tnd-backups/backups/ | tail -n 5          # choisir la plus récente
runuser -u tnd-cms -- sh -c 'cd /srv/tnd-cms/site && npm run cms:admin -- restore /mnt/tnd-backups/backups/<cms-AAAAMMJJ-HHMMSS-….sqlite> --yes'
runuser -u tnd-cms -- mkdir -p /srv/tnd-cms/data/media/originals
runuser -u tnd-cms -- rsync -a /mnt/tnd-backups/originals/ /srv/tnd-cms/data/media/originals/
systemctl enable --now tnd-cms
curl -fsS http://127.0.0.1:8787/healthz
```

`restore` contrôle l'intégrité de la sauvegarde et applique les migrations du code présent
([exploitation.md § 5](exploitation.md#5-restauration)). La copie `rsync` n'efface rien
(pas de `--delete`). Sans aucune sauvegarde : `import` reconstruit les contenus publiés depuis le dépôt,
sans brouillons, comptes ni historique ([exploitation.md § 4](exploitation.md#4-sauvegardes)).

### D. Tâches planifiées de l'hôte

1. **Sauvegarde quotidienne** (sources versionnées, identiques à la production, § 2.1), sur l'hôte, une
   fois le CMS en service (étape C) ; fichiers lus dans la copie du site du conteneur, donc de la version
   déployée. Ces fichiers n'y sont présents qu'à partir d'un déploiement qui les contient (§ 2.1) ; sinon,
   les copier depuis le dépôt par un autre canal et contrôler leur empreinte :

   ```sh
   pct pull 126 /srv/tnd-cms/site/cms/deploy/proxmox/tnd-cms-backup-safe.sh /usr/local/sbin/tnd-cms-backup-safe.sh
   pct pull 126 /srv/tnd-cms/site/cms/deploy/proxmox/tnd-cms-backup.service /etc/systemd/system/tnd-cms-backup.service
   pct pull 126 /srv/tnd-cms/site/cms/deploy/proxmox/tnd-cms-backup.timer /etc/systemd/system/tnd-cms-backup.timer
   chown root:root /usr/local/sbin/tnd-cms-backup-safe.sh /etc/systemd/system/tnd-cms-backup.service /etc/systemd/system/tnd-cms-backup.timer
   chmod 750 /usr/local/sbin/tnd-cms-backup-safe.sh
   chmod 644 /etc/systemd/system/tnd-cms-backup.service /etc/systemd/system/tnd-cms-backup.timer
   sha256sum /usr/local/sbin/tnd-cms-backup-safe.sh /etc/systemd/system/tnd-cms-backup.service /etc/systemd/system/tnd-cms-backup.timer
   pct exec 126 -- sh -c 'cd /srv/tnd-cms/site/cms/deploy/proxmox && sha256sum tnd-cms-backup-safe.sh tnd-cms-backup.service tnd-cms-backup.timer'
   sh -n /usr/local/sbin/tnd-cms-backup-safe.sh && echo syntaxe-ok
   systemd-analyze verify /etc/systemd/system/tnd-cms-backup.service /etc/systemd/system/tnd-cms-backup.timer
   systemctl daemon-reload
   /usr/local/sbin/tnd-cms-backup-safe.sh --check          # vérifications seules
   systemctl start tnd-cms-backup.service                  # première sauvegarde
   journalctl -u tnd-cms-backup.service -n 50 --no-pager
   systemctl enable --now tnd-cms-backup.timer
   ```

   Valeurs écrites dans le script : § 10.0. Sur la production actuelle, ces fichiers sont déjà
   installés : **ne pas les réinstaller** sans raison (une réinstallation n'est utile qu'après une
   modification dans le dépôt).
2. **Test de restauration** : [exploitation.md § 4, « Mise en service »](exploitation.md#mise-en-service)
   (vérifications, `pct pull`, contrôle `sha256sum`, test manuel, activation du minuteur), après la
   première sauvegarde réussie.

### E. Depuis le dépôt (VS Code)

Rien à modifier si les valeurs du § 10.0 sont les mêmes. Sinon : test de restauration par
`systemctl edit tnd-cms-restore-test.service` sur l'hôte ; sauvegarde quotidienne par une modification
du script **dans le dépôt** (PR, `update-cms`, réinstallation § 10 D) ; puis mise à jour de ce document.

Toute évolution du code passe par une PR fusionnée dans `main`, puis `update-cms` dans le conteneur ;
les fichiers de `cms/deploy/proxmox/` modifiés sont ensuite réinstallés sur l'hôte ([exploitation.md, « Quand relancer update-cms »](exploitation.md#quand-relancer-update-cms)).

## 11. Contrôle après reconstruction

**Disque et montages**
- [ ] `findmnt -M /mnt/yPlexLib` : monté ; `blkid` : UUID attendu ; `fstab` désigne l'UUID.
- [ ] Marqueur présent, contenu = UUID **exactement** (vu depuis l'hôte **et** `pct exec 126 -- cat /mnt/tnd-backups/.tnd-backup-target`) ; `stat -c '%u:%g %a'` → `100999:100991 440`.
- [ ] `pct config 126` : `mp0: /mnt/yPlexLib/sauvegardes/tnd-cms,mp=/mnt/tnd-backups,backup=0` ; `pct exec 126 -- findmnt /mnt/tnd-backups`.
- [ ] `/usr/local/sbin/tnd-cms-backup-safe.sh --check` : « OK : toutes les vérifications sont réussies ».

**Permissions**
- [ ] Hôte : `stat -c '%u:%g %a' /mnt/yPlexLib/sauvegardes/tnd-cms` → `100999:100991 750` ; conteneur : `id tnd-cms` → UID 999, GID 991.
- [ ] Hôte : scripts `root:root 750` (sauvegarde) et `755` (test), unités `root:root 644` (§ 2.1).
- [ ] Hôte : `sha256sum` des six fichiers installés = tableau du § 2.1.
- [ ] `pct exec 126 -- runuser -u tnd-cms -- sh -c 'ls /mnt/tnd-backups/backups /mnt/tnd-backups/originals >/dev/null && test -w /mnt/tnd-backups/backups && test -w /srv/tnd-cms/data/status && test -w /var/tmp && echo ok'`
- [ ] `cms/.env` en `600`, propriétaire `tnd-cms`.

**Conteneur**
- [ ] `node -v` (24.x) et `apt-cache policy nodejs` : origine `deb.nodesource.com node_24.x` ; `command -v node` → `/usr/bin/node`.
- [ ] `sha256sum /etc/systemd/system/tnd-cms.service` = `6a8c0dec5830283f34b012e448ab789caf61227d5264436e16831ba5bd1c0fa4` (tant que le modèle n'a pas changé) ; `systemctl show tnd-cms -p DropInPaths` vide.
- [ ] `ls -l /usr/local/bin/update-cms` → `/srv/tnd-cms/site/cms/deploy/update-cms.sh`.
- [ ] `systemctl is-enabled cloudflared && systemctl is-active cloudflared` ; `stat -c '%U:%G %a' /etc/cloudflared/token` → `root:root 600` (sans lire le fichier) ; `apt-cache policy cloudflared` : origine `pkg.cloudflare.com/cloudflared`.
- [ ] `runuser -u tnd-cms -- git -C /srv/tnd-cms/site log -1 --format=%H` : commit déployé connu et noté.

**CMS**
- [ ] `systemctl is-active tnd-cms` ; `curl -fsS http://127.0.0.1:8787/healthz` ; connexion par `https://admin.teknoneverdies.fr` (Cloudflare Access puis compte du CMS).
- [ ] Santé du CMS : migrations à jour, planificateur actif, intégrité contrôlée.
- [ ] Une mise en ligne de test crée un commit sur `main` et le déploiement est confirmé.

**Sauvegarde quotidienne**
- [ ] `systemctl start tnd-cms-backup.service` puis `journalctl -u tnd-cms-backup.service -n 50 --no-pager` : réussite.
- [ ] Santé du CMS : « Sauvegarde externe : envoi » et « contenu de la copie : vérifié » récents.

**Test de restauration**
- [ ] `systemctl start tnd-cms-restore-test.service` : réussite (`journalctl -u tnd-cms-restore-test.service -n 80 --no-pager`).
- [ ] Aucun dossier `/var/tmp/tnd-restore-externe-*` restant dans le conteneur.
- [ ] Santé du CMS : « Test de restauration de la sauvegarde externe » réussi, date du dernier test réussi renseignée.

**Démarrage**
- [ ] `pct config 126 | grep -E '^(onboot|startup):'` : conforme à la décision prise (absent en production le 27/10/2026 : pas de démarrage automatique, § 5.1).

**Minuteurs**
- [ ] `systemctl list-timers tnd-cms-backup.timer tnd-cms-restore-test.timer --no-pager` : les deux actifs, prochaines exécutions à 06:00 (quotidien) et dimanche 06:30.
- [ ] `systemctl is-enabled tnd-cms-backup.timer tnd-cms-restore-test.timer` : `enabled`.

## 12. Validations en production

Résultats constatés par l'exploitant ; aucun rapport ni donnée n'est recopié ici (les rapports restent
dans `/srv/tnd-cms/data/status/`).

| Date | Élément | Résultat |
|---|---|---|
| octobre 2026 (avant le 27) | Sauvegarde externe manuelle | réussie : copie vérifiée identique (17 fichiers comparés, aucune différence) ; copie SQLite du G-RAID récupérable, `integrity_check` = `ok`, 28 tables |
| 27 octobre 2026 | Test de restauration de la sauvegarde externe (installation sur l'hôte, test réel) | **réussi** |
| 27 octobre 2026 | Minuteurs | `tnd-cms-backup.timer` quotidien à 06:00 ; `tnd-cms-restore-test.timer` le dimanche à 06:30 |
| 27 octobre 2026 | Relevé de configuration (hôte, G-RAID, LXC 126, UID/GID, sauvegarde quotidienne) | intégré à ce document ; script et unités de la sauvegarde versionnés tels que relevés ; `tnd-cms-backup.service` et `.timer` activés |
| 27 octobre 2026 | Second relevé, partie hôte : configuration complète du LXC 126, marqueur, `cloudflared` | intégré (§ 5, § 5.1) : `hostname`, `arch`, `ostype`, réseau complet ; **pas d'`onboot`** ; marqueur `100999:100991 440` ; `cloudflared` absent du `PATH` de `root` sur l'hôte |
| 27 octobre 2026 | Second relevé, partie conteneur (`tnd-cms.service`, Node, outils, `cloudflared`, variables) | **sans résultat** : commandes `pct` lancées dans le conteneur (§ 9) ; rien n'est déduit de ce relevé |
| 27 octobre 2026 | Troisième relevé, dans le conteneur | `tnd-cms.service` **identique** au modèle (SHA-256, `cmp`, pas de surcharge) ; Debian 13 ; Node.js `24.22.1-1nodesource1` (NodeSource) ; npm 11.19.1, git 2.47.3, rsync 3.5.0, curl 8.14.1 ; lien `update-cms` ; 21 noms de variables de `cms/.env` (sans valeurs) ; `cloudflared` 2026.10.3 installé, `cloudflared.service` activé et actif, `/etc/cloudflared/token` `root:root 600` (contenu non lu) |
| 27 octobre 2026 | Quatrième relevé (hôte et conteneur) | empreintes des six fichiers installés sur l'hôte **identiques** aux sources du dépôt ; `/etc/pve/firewall/126.fw` absent ; `cloudflared` : paquet `2026.10.3` du dépôt `pkg.cloudflare.com`, `cloudflared.service` relevé (`--token-file`), `cloudflared-update.timer` présent (dernière exécution 27/10 00:00 UTC) ; `/srv/tnd-cms/site` : aucun dépôt Git reconnu par `git rev-parse` |

Restent à constater : première exécution automatique du test le dimanche 1er novembre 2026 ; arrêt d'un
test en cours par `systemctl stop` (testé seulement sur un hôte simulé) ; version du site déployée
(§ 2.2) ; reconstruction complète (jamais exercée : l'infrastructure n'est **pas** encore entièrement
reproductible, voir § 2, catégories D et E, et il n'existe aucune copie hors site). Les fichiers
de la sauvegarde quotidienne ajoutés au dépôt n'ont été vérifiés que par `sh -n` et
`systemd-analyze verify` en développement : jamais exécutés depuis le dépôt.
