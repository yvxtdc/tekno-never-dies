#!/bin/sh
# Sauvegarde complète hors ligne du CMS (exemple, à lancer chaque nuit par cron) :
# copie cohérente de la base + images originales, archivées hors du serveur avec rsync.
#   0 3 * * * /srv/tnd-cms/site/cms/deploy/backup-media.sh
set -eu
cd /srv/tnd-cms/site
npm run -s cms:admin -- backup --label nuit
DEST="${TND_BACKUP_DEST:-backup@nas.example:/sauvegardes/tnd-cms}"
rsync -a --delete .cms-data/backups .cms-data/media/originals "$DEST/"
