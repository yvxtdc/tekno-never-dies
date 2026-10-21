#!/bin/sh
# Sauvegarde hors du serveur du CMS : copie cohérente de la base + images originales, envoyées avec
# rsync vers une AUTRE machine (NAS, autre serveur…). Les sauvegardes automatiques du CMS restent sur
# le même disque que la base : seule cette copie protège d'une panne du serveur ou du conteneur.
#
# Réglage obligatoire : TND_BACKUP_DEST, destination rsync, ex. backup@nas.local:/sauvegardes/tnd-cms
# (accès par clé SSH de l'utilisateur du CMS, sans mot de passe).
# Exemple de planification (crontab de l'utilisateur du CMS, chaque nuit à 3 h) :
#   0 3 * * * TND_BACKUP_DEST=backup@nas.local:/sauvegardes/tnd-cms /chemin/du/site/cms/deploy/backup-media.sh
#
# Le dossier des données est lu dans cms/.env (CMS_DATA_DIR), comme le fait le CMS.
set -eu

DEST="${TND_BACKUP_DEST:-}"
if [ -z "$DEST" ]; then
  echo "TND_BACKUP_DEST non défini : indiquez la destination rsync (autre machine)." >&2
  exit 1
fi

# Dossier du site : celui qui contient ce script (lien symbolique suivi), sauf réglage.
SCRIPT="$(readlink -f "$0")"
DIR="${TND_CMS_DIR:-$(cd "$(dirname "$SCRIPT")/../.." && pwd)}"
cd "$DIR"

# CMS_DATA_DIR : chemin absolu, ou relatif au dossier du site ; .cms-data par défaut.
DATA="$(sed -n 's/^[[:space:]]*CMS_DATA_DIR[[:space:]]*=[[:space:]]*//p' cms/.env 2>/dev/null | tail -n 1 | sed "s/^[\"']//; s/[\"']\$//")"
DATA="${DATA:-.cms-data}"
case "$DATA" in /*) ;; *) DATA="$DIR/$DATA" ;; esac

npm run -s cms:admin -- backup --label nuit
# Pas de --delete : une base abîmée ou une photo supprimée par erreur sur le serveur ne fait pas
# disparaître les copies déjà envoyées.
rsync -a "$DATA/backups" "$DATA/media/originals" "$DEST/"
echo "Sauvegarde envoyée vers $DEST ($(date -u +%Y-%m-%dT%H:%MZ))."
