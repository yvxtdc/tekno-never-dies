#!/bin/sh
# Mise à jour du CMS en une commande (à lancer en root dans le conteneur du CMS) :
#   update-cms
# Installation (une seule fois, en root) :
#   ln -sf /srv/tnd-cms/site/cms/deploy/update-cms.sh /usr/local/bin/update-cms
#
# Étapes : sauvegarde de la base, récupération de main (fast-forward uniquement), dépendances si
# package-lock.json a changé, redémarrage du service, vérification que le CMS répond.
# Rien n'est modifié si la copie du site a des changements non enregistrés ou si l'historique diverge.
# Réglages (facultatifs) : TND_CMS_DIR, TND_CMS_USER, TND_CMS_SERVICE, TND_CMS_PORT.
set -eu

DIR="${TND_CMS_DIR:-/srv/tnd-cms/site}"
USER_NAME="${TND_CMS_USER:-tnd-cms}"
SERVICE="${TND_CMS_SERVICE:-tnd-cms}"
PORT="${TND_CMS_PORT:-8787}"

if [ "$(id -u)" -ne 0 ]; then
  echo "À lancer en root (ou avec sudo) : update-cms" >&2
  exit 1
fi

# Commande lancée en tant qu'utilisateur du CMS, dans la copie du site.
as_cms() { su -s /bin/sh "$USER_NAME" -c "cd '$DIR' && $1"; }

echo "→ Sauvegarde de la base"
as_cms "npm run -s cms:admin -- backup --label avant-mise-a-jour"

echo "→ Récupération de main"
if [ -n "$(as_cms 'git status --porcelain')" ]; then
  echo "La copie du site a des modifications non enregistrées, mise à jour annulée :" >&2
  as_cms "git status --short" >&2
  exit 1
fi
BEFORE="$(as_cms 'git rev-parse HEAD')"
as_cms "git pull --ff-only origin main"
AFTER="$(as_cms 'git rev-parse HEAD')"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "✓ Déjà à jour ($(as_cms 'git log -1 --format=%h\ %s'))."
  printf "Redémarrer quand même le CMS ? [o/N] "
  read -r answer || answer=""
  case "$answer" in o|O|oui|y|Y) ;; *) exit 0 ;; esac
else
  echo "  Nouveautés :"
  as_cms "git log --format='    %h %s' $BEFORE..$AFTER --no-merges"
  if as_cms "git diff --quiet $BEFORE $AFTER -- package-lock.json"; then :; else
    echo "→ Dépendances (package-lock.json a changé)"
    as_cms "npm ci --omit=dev"
  fi
fi

echo "→ Redémarrage de $SERVICE"
systemctl restart "$SERVICE"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "✓ CMS à jour et en ligne. Rechargez l'administration dans le navigateur."
    exit 0
  fi
done
echo "✗ Le CMS ne répond pas. Derniers messages du service :" >&2
journalctl -u "$SERVICE" -n 30 --no-pager >&2
exit 1
