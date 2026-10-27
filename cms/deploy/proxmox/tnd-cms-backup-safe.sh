#!/bin/sh
set -eu

EXPECTED_UUID="f5b884b5-a8c9-45f2-8275-3bfe71bb5a95"
HOST_MOUNT="/mnt/yPlexLib"
HOST_DEST="/mnt/yPlexLib/sauvegardes/tnd-cms"
MARKER="$HOST_DEST/.tnd-backup-target"
CTID="126"
MODE="${1:---run}"

case "$MODE" in
    --check|--run) ;;
    *)
        echo "Usage: $0 [--check|--run]" >&2
        exit 2
        ;;
esac

echo "===== VERIFICATION DU DISQUE ====="
ACTUAL_UUID="$(findmnt -n -o UUID -T "$HOST_MOUNT" 2>/dev/null || true)"
ACTUAL_TARGET="$(findmnt -n -o TARGET -T "$HOST_MOUNT" 2>/dev/null || true)"

if [ "$ACTUAL_UUID" != "$EXPECTED_UUID" ] ||
   [ "$ACTUAL_TARGET" != "$HOST_MOUNT" ]; then
    echo "ERREUR : le disque de sauvegarde attendu n'est pas monté correctement."
    exit 1
fi

if [ ! -d "$HOST_DEST" ] ||
   [ "$(cat "$MARKER" 2>/dev/null || true)" != "$EXPECTED_UUID" ]; then
    echo "ERREUR : dossier ou marqueur de sauvegarde absent ou incorrect."
    exit 1
fi

echo "Disque hôte vérifié."

echo "===== VERIFICATION DU CONTENEUR ====="
if ! pct status "$CTID" | grep -q 'status: running'; then
    echo "ERREUR : le LXC $CTID n'est pas démarré."
    exit 1
fi

LXC_TARGET="$(pct exec "$CTID" -- findmnt -n -o TARGET -T /mnt/tnd-backups 2>/dev/null || true)"
LXC_MARKER="$(pct exec "$CTID" -- cat /mnt/tnd-backups/.tnd-backup-target 2>/dev/null || true)"

if [ "$LXC_TARGET" != "/mnt/tnd-backups" ] ||
   [ "$LXC_MARKER" != "$EXPECTED_UUID" ]; then
    echo "ERREUR : le montage ou le marqueur est incorrect dans le LXC."
    exit 1
fi

echo "Montage du LXC vérifié."

if [ "$MODE" = "--check" ]; then
    echo "OK : toutes les vérifications sont réussies. Aucune sauvegarde exécutée."
    exit 0
fi

echo "===== LANCEMENT DE LA SAUVEGARDE ====="
exec pct exec "$CTID" -- runuser -u tnd-cms -- env \
    CMS_DATA_DIR=/srv/tnd-cms/data \
    TND_BACKUP_DEST=/mnt/tnd-backups \
    TND_BACKUP_VERIFY=1 \
    /bin/sh /srv/tnd-cms/site/cms/deploy/backup-media.sh
