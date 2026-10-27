#!/bin/sh
# Sauvegarde externe du CMS : copie cohérente de la base + images originales, envoyées avec rsync vers
# un AUTRE support que le disque du CMS. Les sauvegardes automatiques du CMS restent sur le même disque
# que la base : cette copie protège d'une panne de ce disque ; seule une destination sur une autre
# machine, ou hors site, protège aussi d'une perte du serveur entier.
#
# Réglage obligatoire : TND_BACKUP_DEST, destination rsync, sous l'une des deux formes prises en charge :
#   - dossier d'un support monté, ex. /mnt/tnd-backups. C'est l'installation actuelle : disque G-RAID
#     de l'hôte Proxmox (même serveur : PAS une sauvegarde hors site), monté dans le conteneur ; script
#     lancé chaque jour par tnd-cms-backup.timer sur l'hôte, via tnd-cms-backup-safe.sh (hors dépôt),
#     qui vérifie le montage et le marqueur .tnd-backup-target avant. Ce script-ci ne vérifie pas le
#     support : appelé seul avec un dossier non monté, il écrirait dans un simple dossier local ;
#   - machine distante, ex. backup@nas.local:/sauvegardes/tnd-cms (clé SSH de l'utilisateur du CMS, sans
#     mot de passe), planifiée par exemple dans la crontab de cet utilisateur :
#     0 3 * * * TND_BACKUP_DEST=backup@nas.local:/sauvegardes/tnd-cms /chemin/du/site/cms/deploy/backup-media.sh
# Résultat dans la destination : backups/ (sauvegardes de la base) et originals/ (images importées),
# relus par le test de restauration (cms/bin/restore-test.mjs).
#
# Le dossier des données est CMS_DATA_DIR (environnement, sinon cms/.env), comme pour le CMS.
# Après l'envoi, la copie est VÉRIFIÉE : rsync compare chaque fichier local à sa copie dans la
# destination par somme de contrôle (--checksum --dry-run) ; un fichier absent ou différent est
# signalé. TND_BACKUP_VERIFY=0 désactive cette vérification (déconseillé : le tableau de santé l'indique).
#
# Compte rendu : CMS_DATA_DIR/status/backup-externe.json, lu par le tableau de santé du CMS :
#   commandOk (envoi terminé sans erreur), verified (true : copie identique ; false : différences, ou
#   destination injoignable lors de la vérification ; null : non vérifié), verifiedFiles, differences,
#   latestBackup (nom du fichier, jamais de chemin). Ni la destination ni aucun identifiant n'y figurent.
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

STATUS_DIR="$DATA/status"
STEP="configuration"
COMMAND_OK=false
VERIFIED=null
VERIFIED_FILES=0
DIFFERENCES=0
LATEST=""
# Compte rendu écrit d'un bloc (fichier temporaire puis renommage) : jamais à moitié écrit.
report() {
  mkdir -p "$STATUS_DIR"
  printf '{"finishedAt":"%s","ok":%s,"step":"%s","message":"%s","commandOk":%s,"verified":%s,"verifiedFiles":%s,"differences":%s,"latestBackup":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$COMMAND_OK" "$VERIFIED" "$VERIFIED_FILES" "$DIFFERENCES" "$LATEST" > "$STATUS_DIR/backup-externe.json.tmp"
  mv "$STATUS_DIR/backup-externe.json.tmp" "$STATUS_DIR/backup-externe.json"
}
# Toute sortie en erreur (set -e) est consignée avec l'étape en cours.
trap 'code=$?; if [ "$code" -ne 0 ]; then report false "$STEP" "Échec (code $code) : voir le journal de la tâche planifiée."; fi' EXIT

DEST="${TND_BACKUP_DEST:-}"
if [ -z "$DEST" ]; then
  echo "TND_BACKUP_DEST non défini : indiquez la destination rsync (autre machine)." >&2
  exit 1
fi

STEP="sauvegarde de la base"
npm run -s cms:admin -- backup --label nuit
LATEST="$(ls -1 "$DATA/backups" | grep -E '^cms-[0-9]{8}-[0-9]{6}(-[a-z0-9-]+)?\.sqlite$' | sort | tail -n 1)"
STEP="envoi rsync"
# Pas de --delete : une base abîmée ou une photo supprimée par erreur sur le serveur ne fait pas
# disparaître les copies déjà envoyées.
rsync -a "$DATA/backups" "$DATA/media/originals" "$DEST/"
COMMAND_OK=true

if [ "${TND_BACKUP_VERIFY:-1}" = "0" ]; then
  STEP="terminé"
  report true "$STEP" "Envoi terminé ; copie NON vérifiée (TND_BACKUP_VERIFY=0)."
  echo "Sauvegarde envoyée vers $DEST, sans vérification."
  exit 0
fi

# Vérification de la copie : comparaison par somme de contrôle, sans rien transférer. Toute ligne
# « < », « > » ou « c » est un fichier (ou dossier) absent ou différent dans la destination.
STEP="vérification distante"
VERIFIED=false
VERIFIED_FILES="$(find "$DATA/backups" "$DATA/media/originals" -type f | wc -l | tr -d ' ')"
CHANGES="$(rsync -a --checksum --dry-run --itemize-changes "$DATA/backups" "$DATA/media/originals" "$DEST/")"
DIFFERENCES="$(printf '%s\n' "$CHANGES" | grep -c '^[<>c]' || true)"
if [ "$DIFFERENCES" -ne 0 ]; then
  report false "$STEP" "Envoi terminé, mais $DIFFERENCES élément(s) absent(s) ou différent(s) dans la copie externe."
  echo "Vérification distante : $DIFFERENCES différence(s)." >&2
  trap - EXIT
  exit 1
fi
VERIFIED=true
STEP="terminé"
report true "$STEP" "Envoi terminé et vérifié : $VERIFIED_FILES fichier(s) identiques dans la copie externe."
echo "Sauvegarde envoyée et vérifiée vers $DEST ($(date -u +%Y-%m-%dT%H:%MZ))."
