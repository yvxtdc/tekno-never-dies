#!/bin/sh
# Sauvegarde externe du CMS : copie cohérente de la base + images originales, envoyées avec rsync vers
# un AUTRE support que le disque du CMS. Les sauvegardes automatiques du CMS restent sur le même disque
# que la base : cette copie protège d'une panne de ce disque ; seule une destination sur une autre
# machine, ou hors site, protège aussi d'une perte du serveur entier.
#
# Réglage obligatoire : TND_BACKUP_DEST, destination rsync, sous l'une des deux formes prises en charge :
#   - dossier d'un support monté (chemin absolu), ex. /mnt/tnd-backups. C'est l'installation actuelle :
#     disque G-RAID de l'hôte Proxmox (même serveur : PAS une sauvegarde hors site), monté dans le
#     conteneur ; script lancé chaque jour par tnd-cms-backup.timer sur l'hôte, via
#     tnd-cms-backup-safe.sh (cms/deploy/proxmox/), qui vérifie le montage et le marqueur
#     .tnd-backup-target avant. Ce script-ci ne vérifie pas le support : appelé seul avec un dossier non
#     monté, il écrirait dans un simple dossier local ;
#   - machine distante, ex. backup@nas.local:/sauvegardes/tnd-cms (clé SSH de l'utilisateur du CMS, sans
#     mot de passe), planifiée par exemple dans la crontab de cet utilisateur :
#     0 3 * * * TND_BACKUP_DEST=backup@nas.local:/sauvegardes/tnd-cms /chemin/du/site/cms/deploy/backup-media.sh
# Résultat dans la destination : backups/ (sauvegardes de la base) et originals/ (images importées),
# relus par le test de restauration (cms/bin/restore-test.mjs).
#
# Le dossier des données est CMS_DATA_DIR (environnement, sinon cms/.env), comme pour le CMS.
# Envoi : les TND_BACKUP_KEEP_REMOTE (60 par défaut) sauvegardes locales les plus récentes de la base, et
# originals/ en entier (sans --delete : une photo supprimée par erreur sur le serveur ne disparaît pas de
# la copie).
# Après l'envoi, la copie est VÉRIFIÉE : rsync compare chaque fichier envoyé à sa copie dans la
# destination par somme de contrôle (--checksum --dry-run) ; un fichier absent ou différent est
# signalé. TND_BACKUP_VERIFY=0 désactive cette vérification (déconseillé : le tableau de santé l'indique).
#
# Rétention, SEULEMENT après une vérification réussie et pour une destination locale (chemin absolu) :
# dans <destination>/backups/, les fichiers ordinaires nommés cms-AAAAMMJJ-HHMMSS[-étiquette].sqlite
# au-delà des TND_BACKUP_KEEP_REMOTE plus récents sont supprimés (60 par défaut : environ deux mois au
# rythme d'une sauvegarde par jour, au moins un mois s'il y en a deux). Seule cette variable, lue dans
# l'environnement du script, règle la limite (cms/.env n'est pas consulté pour elle). Rien d'autre n'est
# jamais supprimé :
# ni originals/, ni un fichier d'un autre format, ni un lien, ni un fichier envoyé par cette exécution.
# Refusée (échec signalé, rien supprimé) si backups/ est un lien ou se trouve dans les données du CMS ou
# le site. Destination distante (SSH) : pas de rétention (compte rendu « not-local »).
#
# Compte rendu : CMS_DATA_DIR/status/backup-externe.json, lu par le tableau de santé du CMS :
#   commandOk (envoi terminé sans erreur), verified (true : copie identique ; false : différences, ou
#   destination injoignable lors de la vérification ; null : non vérifié), verifiedFiles, differences,
#   latestBackup (nom du fichier, jamais de chemin), retention (applied, unverified, not-local, refused,
#   pending), retentionLimit, remoteBackups (sauvegardes restantes dans la destination), deletedBackups.
#   Ni la destination ni aucun identifiant n'y figurent.
# (Les noms d'étapes « envoi rsync », « vérification distante » sont conservés : rapports existants.)
set -eu

# Dossier du site : celui qui contient ce script (lien symbolique suivi), sauf réglage.
SCRIPT="$(readlink -f "$0")"
DIR="${TND_CMS_DIR:-$(cd "$(dirname "$SCRIPT")/../.." && pwd)}"
cd "$DIR"

# CMS_DATA_DIR : chemin absolu, ou relatif au dossier du site ; .cms-data par défaut.
DATA="${CMS_DATA_DIR:-$(sed -n 's/^[[:space:]]*CMS_DATA_DIR[[:space:]]*=[[:space:]]*//p' cms/.env 2>/dev/null | tail -n 1 | sed "s/^[\"']//; s/[\"']\$//")}"
DATA="${DATA:-.cms-data}"
case "$DATA" in /*) ;; *) DATA="$DIR/$DATA" ;; esac

# Nom d'une sauvegarde de la base (services/backup.mjs) ; horodatage UTC de largeur fixe : l'ordre
# alphabétique (LC_ALL=C) est l'ordre chronologique.
NAME_RE='^cms-[0-9]{8}-[0-9]{6}(-[a-z0-9-]+)?\.sqlite$'
backups_in() { ls -1A "$1" | grep -E "$NAME_RE" | LC_ALL=C sort; }
# Les mêmes, limitées aux fichiers ordinaires (ni lien, ni dossier) : les seules que la rétention compte.
regular_backups_in() {
  for f in $(backups_in "$1"); do
    if [ -f "$1/$f" ] && [ ! -L "$1/$f" ]; then echo "$f"; fi
  done
}

STATUS_DIR="$DATA/status"
STEP="configuration"
COMMAND_OK=false
VERIFIED=null
VERIFIED_FILES=0
DIFFERENCES=0
LATEST=""
RETENTION=pending
KEEP="${TND_BACKUP_KEEP_REMOTE:-60}"
REMOTE_BACKUPS=null
DELETED=0
# Compte rendu écrit d'un bloc (fichier temporaire puis renommage) : jamais à moitié écrit.
report() {
  mkdir -p "$STATUS_DIR"
  printf '{"finishedAt":"%s","ok":%s,"step":"%s","message":"%s","commandOk":%s,"verified":%s,"verifiedFiles":%s,"differences":%s,"latestBackup":"%s","retention":"%s","retentionLimit":%s,"remoteBackups":%s,"deletedBackups":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$COMMAND_OK" "$VERIFIED" "$VERIFIED_FILES" "$DIFFERENCES" "$LATEST" "$RETENTION" "$KEEP" "$REMOTE_BACKUPS" "$DELETED" > "$STATUS_DIR/backup-externe.json.tmp"
  mv "$STATUS_DIR/backup-externe.json.tmp" "$STATUS_DIR/backup-externe.json"
}
# Toute sortie en erreur (set -e) est consignée avec l'étape en cours.
trap 'code=$?; if [ "$code" -ne 0 ]; then report false "$STEP" "Échec (code $code) : voir le journal de la tâche planifiée."; fi' EXIT

case "$KEEP" in
  ''|*[!0-9]*|0*) KEEP=60; echo "TND_BACKUP_KEEP_REMOTE : entier ≥ 1 attendu." >&2; exit 1 ;;
esac

DEST="${TND_BACKUP_DEST:-}"
if [ -z "$DEST" ]; then
  echo "TND_BACKUP_DEST non défini : indiquez la destination rsync (support monté ou autre machine)." >&2
  exit 1
fi

STEP="sauvegarde de la base"
BEFORE="$(backups_in "$DATA/backups" 2>/dev/null || true)"
npm run -s cms:admin -- backup --label nuit
# Sauvegarde créée par cette exécution : un nom absent avant, fichier non vide. Sinon, échec (aucune
# suppression ne peut avoir lieu).
for f in $(backups_in "$DATA/backups"); do
  case "
$BEFORE
" in *"
$f
"*) ;; *) LATEST="$f" ;; esac
done
if [ -z "$LATEST" ] || [ ! -s "$DATA/backups/$LATEST" ]; then
  echo "Aucune nouvelle sauvegarde de la base n'a été créée." >&2
  exit 1
fi
# Envoyées : les KEEP plus récentes, et toujours celle du jour (même si l'horloge la classait plus loin).
SENT="$( (backups_in "$DATA/backups" | tail -n "$KEEP"; echo "$LATEST") | LC_ALL=C sort -u)"

STEP="envoi rsync"
printf '%s\n' "$SENT" | rsync -a --files-from=- "$DATA/backups/" "$DEST/backups/"
# Pas de --delete : une photo supprimée par erreur sur le serveur ne fait pas disparaître sa copie.
rsync -a "$DATA/media/originals" "$DEST/"
COMMAND_OK=true

if [ "${TND_BACKUP_VERIFY:-1}" = "0" ]; then
  STEP="terminé"
  RETENTION=unverified
  report true "$STEP" "Envoi terminé ; copie NON vérifiée (TND_BACKUP_VERIFY=0) : aucune ancienne sauvegarde supprimée."
  echo "Sauvegarde envoyée vers $DEST, sans vérification ni rétention."
  exit 0
fi

# Vérification de la copie : comparaison par somme de contrôle, sans rien transférer. Toute ligne
# « < », « > » ou « c » est un fichier (ou dossier) absent ou différent dans la destination.
STEP="vérification distante"
VERIFIED=false
VERIFIED_FILES="$(( $(printf '%s\n' "$SENT" | grep -c .) + $(find "$DATA/media/originals" -type f | wc -l) ))"
CHANGES_DB="$(printf '%s\n' "$SENT" | rsync -a --checksum --dry-run --itemize-changes --files-from=- "$DATA/backups/" "$DEST/backups/")"
CHANGES_MEDIA="$(rsync -a --checksum --dry-run --itemize-changes "$DATA/media/originals" "$DEST/")"
DIFFERENCES="$(printf '%s\n%s\n' "$CHANGES_DB" "$CHANGES_MEDIA" | grep -c '^[<>c]' || true)"
if [ "$DIFFERENCES" -ne 0 ]; then
  report false "$STEP" "Envoi terminé, mais $DIFFERENCES élément(s) absent(s) ou différent(s) dans la copie externe : aucune ancienne sauvegarde supprimée."
  echo "Vérification distante : $DIFFERENCES différence(s)." >&2
  trap - EXIT
  exit 1
fi
VERIFIED=true

# Rétention des sauvegardes de la base dans la destination : seulement maintenant, la copie du jour
# étant vérifiée.
STEP="rétention"
case "$DEST" in
  /*)
    RDIR="$DEST/backups"
    REAL="$(readlink -f "$RDIR" 2>/dev/null || true)"
    case "$REAL/" in
      /backups/|"$(readlink -f "$DATA")"/*|"$(readlink -f "$DIR")"/*) REAL="" ;;
    esac
    if [ -L "$DEST" ] || [ -L "$RDIR" ] || [ ! -d "$RDIR" ] || [ -z "$REAL" ] || [ ! -f "$RDIR/$LATEST" ]; then
      RETENTION=refused
      report false "$STEP" "Copie vérifiée, mais rétention refusée : dossier backups/ de la destination absent, lien, ou situé dans les données du CMS ou le site. Rien n'a été supprimé."
      echo "Rétention refusée : destination hors périmètre. Rien n'a été supprimé." >&2
      trap - EXIT
      exit 1
    fi
    # Fichiers ordinaires au bon format seulement, du plus ancien au plus récent.
    REMOTE="$(regular_backups_in "$RDIR")"
    COUNT="$(printf '%s\n' "$REMOTE" | grep -c . || true)"
    if [ "$COUNT" -gt "$KEEP" ]; then
      for f in $(printf '%s\n' "$REMOTE" | head -n "$((COUNT - KEEP))"); do
        # Jamais un fichier envoyé par cette exécution (celle du jour comprise).
        case "
$SENT
" in *"
$f
"*) continue ;; esac
        rm -f -- "$RDIR/$f"
        DELETED=$((DELETED + 1))
      done
    fi
    REMOTE_BACKUPS="$(regular_backups_in "$RDIR" | grep -c . || true)"
    [ -f "$RDIR/$LATEST" ]
    RETENTION=applied
    ;;
  *)
    RETENTION=not-local
    ;;
esac

STEP="terminé"
case "$RETENTION" in
  applied) KEPT_MSG=" ; $REMOTE_BACKUPS sauvegarde(s) de la base conservée(s) (limite $KEEP), $DELETED ancienne(s) supprimée(s)" ;;
  *) KEPT_MSG=" ; destination non locale : pas de rétention" ;;
esac
report true "$STEP" "Envoi terminé et vérifié : $VERIFIED_FILES fichier(s) identiques dans la copie externe$KEPT_MSG."
echo "Sauvegarde envoyée et vérifiée vers $DEST ($(date -u +%Y-%m-%dT%H:%MZ))$KEPT_MSG."
