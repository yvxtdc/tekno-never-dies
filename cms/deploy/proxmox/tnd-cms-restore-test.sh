#!/bin/sh
# Test de restauration hebdomadaire de la sauvegarde externe du CMS — à installer sur l'HÔTE Proxmox
# (pas dans le conteneur) : /usr/local/sbin/tnd-cms-restore-test.sh, lancé par
# tnd-cms-restore-test.service / .timer (même dossier). Procédure : docs/cms/exploitation.md, § 4.
#
# Avant de lancer quoi que ce soit dans le conteneur, l'hôte vérifie :
#   1. que la sauvegarde quotidienne (tnd-cms-backup.service) est terminée (attente bornée) ;
#   2. que le point de montage du disque de sauvegarde est monté et porte l'UUID attendu ;
#   3. que le dossier des sauvegardes existe et que son marqueur .tnd-backup-target contient cet UUID ;
#   4. que le conteneur est démarré (attente bornée après un redémarrage de l'hôte) ;
#   5. que ce dossier est bien monté dans le conteneur au point attendu (configuration pct + findmnt +
#      marqueur lu depuis le conteneur).
# Puis il lance cms/bin/restore-test.mjs dans le conteneur, sous le compte du CMS, avec un environnement
# vide complété uniquement par les variables ci-dessous (aucun réglage implicite).
# Si un contrôle de l'hôte échoue et que le conteneur tourne, l'échec est enregistré dans le rapport du
# CMS (--host-failure, code fixe) ; sinon il n'apparaît que dans le journal systemd. Rien n'est jamais
# écrit sur le disque de sauvegarde ni dans un dossier qui masquerait son absence.
#
# Arrêt : le test du conteneur a son propre délai maximal (TND_RESTORE_TIMEOUT_SECONDS, inférieur au
# délai du service). Si ce script reçoit SIGTERM / SIGINT / SIGHUP (arrêt du service, délai systemd
# dépassé), il demande l'arrêt du test de CETTE exécution dans le conteneur (pkill ciblé sur son
# identifiant --run-id, compte du CMS uniquement), lui laisse le temps de supprimer son dossier temporaire
# et d'écrire un rapport d'échec, puis s'arrête. Il ne supprime lui-même aucun fichier.
# Code de sortie : 0 test réussi ; non nul sinon (143 après un arrêt demandé).
set -eu

GRAID_MOUNT="${TND_GRAID_MOUNT:-/mnt/yPlexLib}"
GRAID_UUID="${TND_GRAID_UUID:-f5b884b5-a8c9-45f2-8275-3bfe71bb5a95}"
TARGET="${TND_BACKUP_TARGET:-$GRAID_MOUNT/sauvegardes/tnd-cms}"
CTID="${TND_CTID:-126}"
CT_MOUNT="${TND_CT_MOUNT:-/mnt/tnd-backups}"
CT_SITE="${TND_CT_SITE:-/srv/tnd-cms/site}"
CT_DATA="${TND_CT_DATA:-/srv/tnd-cms/data}"
CT_USER="${TND_CT_USER:-tnd-cms}"
CT_NODE="${TND_CT_NODE:-/usr/bin/node}"
CT_TMP="${TND_CT_TMP:-/var/tmp}"
CT_MIN_FREE_MB="${TND_CT_MIN_FREE_MB:-512}"
CT_REQUIRE_MOUNT="${TND_CT_REQUIRE_MOUNT:-1}"
BACKUP_UNIT="${TND_BACKUP_UNIT:-tnd-cms-backup.service}"
WAIT_BACKUP="${TND_WAIT_BACKUP_SECONDS:-3600}"
WAIT_CT="${TND_WAIT_CT_SECONDS:-600}"
POLL="${TND_POLL_SECONDS:-30}"
TEST_TIMEOUT="${TND_RESTORE_TIMEOUT_SECONDS:-1800}"
STOP_GRACE="${TND_STOP_GRACE_SECONDS:-30}"
LOCK="${TND_RESTORE_LOCK:-/run/tnd-cms-restore-test.lock}"
# Identifiant de cette exécution (date + pid de ce script) : sert à arrêter ce test et lui seul.
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
CHILD=""

# Sous systemd, préfixes de priorité du journal (journalctl -p err) ; en terminal, texte brut.
if [ -n "${JOURNAL_STREAM:-}" ]; then E="<3>"; I="<6>"; else E=""; I=""; fi
info() { echo "${I}$*"; }
err() { echo "${E}✗ $*" >&2; }

# Environnement explicite du test dans le conteneur, sous le compte du CMS.
runner() {
  pct exec "$CTID" -- runuser -u "$CT_USER" -- env -i \
    PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
    CMS_DATA_DIR="$CT_DATA" TND_CMS_DIR="$CT_SITE" \
    TND_RESTORE_SOURCE="$CT_MOUNT" TND_BACKUP_TARGET_ID="$GRAID_UUID" \
    TND_RESTORE_TMP_DIR="$CT_TMP" TND_RESTORE_MIN_FREE_MB="$CT_MIN_FREE_MB" \
    TND_RESTORE_REQUIRE_MOUNT="$CT_REQUIRE_MOUNT" TND_RESTORE_TIMEOUT_SECONDS="$TEST_TIMEOUT" \
    "$CT_NODE" --disable-warning=ExperimentalWarning "$CT_SITE/cms/bin/restore-test.mjs" "$@"
}
ct_running() { [ "$(pct status "$CTID" 2>/dev/null)" = "status: running" ]; }

# Échec avant le test : journal systemd, et rapport du CMS si le conteneur est joignable.
refuse() {
  err "$2"
  if ct_running; then
    runner --host-failure "$1" || err "Rapport d'échec non enregistré dans le CMS (voir ci-dessus)."
  else
    err "Conteneur $CTID arrêté : l'échec n'est visible que dans ce journal."
  fi
  exit 1
}

# Une seule exécution à la fois (minuteur et lancement manuel).
exec 9>"$LOCK"
if ! flock -n 9; then
  err "Un test de restauration est déjà en cours."
  exit 1
fi

info "Test de restauration du CMS (conteneur $CTID) : contrôles de l'hôte."

# 1. Sauvegarde quotidienne terminée.
waited=0
while systemctl is-active --quiet "$BACKUP_UNIT" 2>/dev/null; do
  if [ "$waited" -ge "$WAIT_BACKUP" ]; then
    refuse backup-running "$BACKUP_UNIT toujours en cours après ${WAIT_BACKUP} s : test non lancé."
  fi
  [ "$waited" -eq 0 ] && info "$BACKUP_UNIT en cours : attente de sa fin."
  sleep "$POLL"
  waited=$((waited + POLL))
done

# 2. Disque de sauvegarde monté, UUID attendu.
SOURCE="$(findmnt -rn -M "$GRAID_MOUNT" -o SOURCE 2>/dev/null | head -n 1 || true)"
if [ -z "$SOURCE" ]; then
  refuse graid-not-mounted "$GRAID_MOUNT n'est pas un point de montage : disque de sauvegarde absent."
fi
FOUND_UUID="$(findmnt -rn -M "$GRAID_MOUNT" -o UUID 2>/dev/null | head -n 1 || true)"
[ -n "$FOUND_UUID" ] || FOUND_UUID="$(blkid -s UUID -o value "$SOURCE" 2>/dev/null || true)"
if [ "$FOUND_UUID" != "$GRAID_UUID" ]; then
  refuse graid-uuid-mismatch "$GRAID_MOUNT est monté depuis $SOURCE (UUID « ${FOUND_UUID:-inconnu} »), pas depuis le disque attendu ($GRAID_UUID)."
fi

# 3. Dossier des sauvegardes et marqueur.
if [ ! -d "$TARGET" ] || [ -L "$TARGET" ]; then
  refuse target-missing "$TARGET absent du disque de sauvegarde."
fi
if [ ! -f "$TARGET/.tnd-backup-target" ] || [ "$(tr -d '[:space:]' < "$TARGET/.tnd-backup-target")" != "$GRAID_UUID" ]; then
  refuse marker-mismatch "Marqueur $TARGET/.tnd-backup-target absent ou différent de $GRAID_UUID."
fi

# 4. Conteneur démarré.
waited=0
until ct_running; do
  if [ "$waited" -ge "$WAIT_CT" ]; then
    err "Conteneur $CTID non démarré après ${WAIT_CT} s : test impossible, aucun rapport enregistré dans le CMS."
    exit 1
  fi
  [ "$waited" -eq 0 ] && info "Conteneur $CTID pas encore démarré : attente."
  sleep "$POLL"
  waited=$((waited + POLL))
done

# 5. Montage du dossier dans le conteneur : configuration (point de montage « mpN: source,mp=cible »
# ou entrée brute « lxc.mount.entry: source cible none bind… »), montage effectif, même marqueur.
if ! pct config "$CTID" | awk -v src="$TARGET" -v dst="$CT_MOUNT" '
  /^mp[0-9]+: / { line = $0; sub(/^mp[0-9]+: */, "", line); n = split(line, f, /, */)
    if (f[1] == src) for (i = 2; i <= n; i++) if (f[i] == "mp=" dst) found = 1 }
  /^lxc\.mount\.entry: / { d = $3; sub(/^\//, "", d); c = dst; sub(/^\//, "", c); if ($2 == src && d == c) found = 1 }
  END { exit !found }'; then
  refuse ct-mount-mismatch "La configuration du conteneur $CTID ne monte pas $TARGET sur $CT_MOUNT."
fi
if [ -z "$(pct exec "$CTID" -- findmnt -rn -M "$CT_MOUNT" -o TARGET 2>/dev/null || true)" ]; then
  refuse ct-mount-missing "$CT_MOUNT n'est pas monté dans le conteneur $CTID."
fi
if [ "$(pct exec "$CTID" -- cat "$CT_MOUNT/.tnd-backup-target" 2>/dev/null | tr -d '[:space:]' || true)" != "$GRAID_UUID" ]; then
  refuse ct-mount-mismatch "Le marqueur lu dans le conteneur ($CT_MOUNT) ne correspond pas : mauvais dossier monté."
fi

# 6. Test dans le conteneur.
# Processus du test encore actif (un processus terminé non encore attendu reste « Z » : il ne compte pas).
child_alive() {
  state="$(ps -o stat= -p "$CHILD" 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$state" ] && [ "${state#Z}" = "$state" ]
}
stop_test() {
  trap '' TERM INT HUP
  err "Arrêt demandé pendant le test (exécution $RUN_ID) : arrêt du test dans le conteneur $CTID."
  if ! pct exec "$CTID" -- pkill -TERM -u "$CT_USER" -f "restore-test\.mjs --run-id $RUN_ID" 2>/dev/null; then
    err "Aucun processus de cette exécution trouvé dans le conteneur (déjà terminé, ou conteneur injoignable)."
  fi
  # Le test supprime son dossier temporaire et écrit un rapport d'échec ; attente bornée.
  [ -n "$CHILD" ] || exit 143
  waited=0
  while child_alive && [ "$waited" -lt "$STOP_GRACE" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if child_alive; then
    err "Test toujours actif après ${STOP_GRACE} s : pct exec arrêté. Vérifier dans le conteneur : pgrep -u $CT_USER -af restore-test.mjs ; ls -ld $CT_TMP/tnd-restore-externe-* (docs/cms/exploitation.md, § 4)."
    pkill -TERM -P "$CHILD" 2>/dev/null || true
    kill -TERM "$CHILD" 2>/dev/null || true
  fi
  exit 143
}
info "Contrôles de l'hôte réussis : lancement du test dans le conteneur $CTID (compte $CT_USER, exécution $RUN_ID, délai ${TEST_TIMEOUT} s)."
# Lancé en arrière-plan : « wait » est interrompu par un signal, le piège s'exécute donc tout de suite
# (au premier plan, il attendrait la fin du test).
trap stop_test TERM INT HUP
runner --run-id "$RUN_ID" &
CHILD=$!
set +e
wait "$CHILD"
code=$?
set -e
trap - TERM INT HUP
if [ "$code" -eq 0 ]; then
  info "✓ Test de restauration réussi (rapport : $CT_DATA/status/restore-test.json dans le conteneur)."
  exit 0
fi
err "Test de restauration en échec (code $code) : détail ci-dessus et dans Santé du CMS."
exit "$code"
