#!/usr/bin/env bash
# Installation du thème et des fonctions ANSIE sur un JumpServer v5 installé
# avec l'installateur officiel (conteneurs jms_core, jms_celery, jms_web).
#
#   sudo ./install.sh            installer (sauvegarde automatique avant)
#   sudo ./install.sh rollback   revenir à la version d'avant l'installation
#   sudo ./install.sh check      vérifier sans rien modifier
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CORE=jms_core
CELERY=jms_celery
WEB=jms_web
APP_DIR=/opt/jumpserver
BACKUP_SUFFIX=avant-ansie
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m OK\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m !!\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31mERREUR\033[0m %s\n' "$*" >&2; exit 1; }

running()   { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }
image_of()  { docker inspect -f '{{.Config.Image}}' "$1"; }
has_image() { docker image inspect "$1" >/dev/null 2>&1; }

find_jmsctl() {
  for d in /opt/jumpserver-installer* /opt/jumpserver-ce* /opt/installer* /opt/jumpserver*; do
    [ -x "$d/jmsctl.sh" ] && { echo "$d"; return; }
  done
  return 0
}

wait_healthy() {
  local name=$1 i
  for i in $(seq 1 60); do
    case "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null)" in
      healthy|none) running "$name" && { ok "$name est démarré"; return 0; } ;;
    esac
    sleep 5
  done
  warn "$name n'est pas encore « healthy » après 5 minutes : vérifiez avec  docker logs $name"
}

# ---------------------------------------------------------------- vérifications
preflight() {
  info "Vérifications"
  [ "$(id -u)" = 0 ] || fail "lancez le script avec sudo (ou en root)."
  command -v docker >/dev/null || fail "docker est introuvable."
  command -v patch  >/dev/null || fail "la commande « patch » est introuvable (apt install patch / yum install patch)."
  for f in core/ansie-core.patch core/django.mo web/lina/index.html web/luna/index.html; do
    [ -e "$HERE/$f" ] || fail "fichier manquant dans le paquet : $f"
  done
  running "$CORE" || fail "le conteneur $CORE n'est pas démarré. Ce script vise l'installateur officiel de JumpServer."
  running "$WEB"  || fail "le conteneur $WEB n'est pas démarré."
  docker exec "$WEB" test -d /opt/lina || fail "$WEB ne contient pas /opt/lina : version de JumpServer non prise en charge."
  docker exec "$WEB" test -d /opt/luna || fail "$WEB ne contient pas /opt/luna : version de JumpServer non prise en charge."

  VERSION_LINE="$(docker exec "$CORE" grep -E "^VERSION = " "$APP_DIR/apps/jumpserver/const.py" || true)"
  ok "JumpServer détecté : ${VERSION_LINE:-version inconnue}"
  case "$VERSION_LINE" in
    *"'v5."*|*"'dev"*) ;;
    *) [ "${FORCE:-0}" = 1 ] || fail "ce paquet est fait pour JumpServer v5. Version trouvée : ${VERSION_LINE:-inconnue}. (FORCE=1 pour forcer, déconseillé)" ;;
  esac

  # Le code du serveur doit correspondre exactement à celui pour lequel le patch a été fait.
  docker cp "$CORE:$APP_DIR/apps" "$WORK/apps" >/dev/null
  if ! (cd "$WORK" && patch -p1 --dry-run -s -f < "$HERE/core/ansie-core.patch" >/dev/null); then
    if (cd "$WORK" && patch -p1 -R --dry-run -s -f < "$HERE/core/ansie-core.patch" >/dev/null); then
      fail "le thème ANSIE semble déjà installé. Pour le retirer : sudo ./install.sh rollback"
    fi
    fail "le code de votre JumpServer ne correspond pas à la version prévue : rien n'a été modifié. Envoyez la ligne de version ci-dessus pour obtenir un paquet adapté."
  fi
  ok "le patch du serveur s'applique sans conflit"
}

# ---------------------------------------------------------------- 1. sauvegarde
backup() {
  info "Étape 1/3 : sauvegarde"
  local jmsctl_dir
  jmsctl_dir="$(find_jmsctl)"
  if [ -n "$jmsctl_dir" ]; then
    info "Sauvegarde de la base de données avec $jmsctl_dir/jmsctl.sh backup_db"
    (cd "$jmsctl_dir" && ./jmsctl.sh backup_db) || fail "la sauvegarde de la base a échoué : installation annulée."
    ok "base de données sauvegardée (voir le dossier de sauvegarde indiqué ci-dessus)"
  else
    warn "jmsctl.sh introuvable : la base de données n'a PAS été sauvegardée automatiquement."
    read -r -p "Avez-vous fait vous-même une sauvegarde de la base ? Tapez « oui » pour continuer : " answer
    [ "$answer" = "oui" ] || fail "installation annulée."
  fi

  for c in "$CORE" "$WEB"; do
    local img backup_img
    img="$(image_of "$c")"
    backup_img="${img%%:*}:${img##*:}-$BACKUP_SUFFIX"
    if has_image "$backup_img"; then
      ok "image d'origine déjà conservée : $backup_img"
    else
      docker tag "$img" "$backup_img"
      ok "image d'origine conservée : $backup_img"
    fi
  done
}

# ---------------------------------------------------------------- 2. installation
install_core() {
  info "Étape 2/3 : installation"
  (cd "$WORK" && patch -p1 -s -f < "$HERE/core/ansie-core.patch")
  cp -r "$HERE/core/new/apps/." "$WORK/apps/"
  cp "$HERE/core/django.mo" "$WORK/apps/i18n/core/fr/LC_MESSAGES/django.mo"
  find "$WORK/apps" -name '*.orig' -delete

  for c in "$CORE" "$CELERY"; do
    running "$c" || { warn "$c absent ou arrêté : ignoré"; continue; }
    docker cp "$WORK/apps/." "$c:$APP_DIR/apps/"
    ok "serveur mis à jour dans $c"
  done
}

install_web() {
  docker exec "$WEB" sh -c "rm -rf /opt/lina.$BACKUP_SUFFIX /opt/luna.$BACKUP_SUFFIX && cp -a /opt/lina /opt/lina.$BACKUP_SUFFIX && cp -a /opt/luna /opt/luna.$BACKUP_SUFFIX && rm -rf /opt/lina/* /opt/luna/*"
  docker cp "$HERE/web/lina/." "$WEB:/opt/lina/"
  docker cp "$HERE/web/luna/." "$WEB:/opt/luna/"
  ok "console (Lina) et terminal web (Luna) mis à jour dans $WEB"
}

# ---------------------------------------------------------------- 3. redémarrage
persist_and_restart() {
  info "Étape 3/3 : enregistrement et redémarrage"
  # Les fichiers copiés dans un conteneur disparaissent s'il est recréé : on les fige dans l'image.
  docker commit -m "ANSIE $STAMP" "$CORE" "$(image_of "$CORE")" >/dev/null
  docker commit -m "ANSIE $STAMP" "$WEB" "$(image_of "$WEB")" >/dev/null
  ok "modifications enregistrées dans les images (elles survivent à un redémarrage complet)"

  docker restart "$CORE" >/dev/null
  running "$CELERY" && docker restart "$CELERY" >/dev/null
  docker restart "$WEB" >/dev/null
  wait_healthy "$CORE"
  wait_healthy "$WEB"
}

# ---------------------------------------------------------------- retour arrière
rollback() {
  info "Retour à la version d'avant l'installation"
  [ "$(id -u)" = 0 ] || fail "lancez le script avec sudo (ou en root)."
  local restored=0
  for c in "$CORE" "$WEB"; do
    local img backup_img
    img="$(image_of "$c")"
    backup_img="${img%%:*}:${img##*:}-$BACKUP_SUFFIX"
    if has_image "$backup_img"; then
      docker tag "$backup_img" "$img"
      ok "image d'origine restaurée : $img"
      restored=1
    else
      warn "aucune sauvegarde trouvée pour $img"
    fi
  done
  [ "$restored" = 1 ] || fail "rien à restaurer."
  local jmsctl_dir
  jmsctl_dir="$(find_jmsctl)"
  if [ -n "$jmsctl_dir" ]; then
    (cd "$jmsctl_dir" && ./jmsctl.sh down && ./jmsctl.sh start)
    ok "JumpServer redémarré avec les images d'origine"
  else
    warn "Recréez les conteneurs pour terminer : dans le dossier de l'installateur, lancez  ./jmsctl.sh down && ./jmsctl.sh start"
  fi
  info "Les paramètres ANSIE enregistrés en base sont ignorés par la version d'origine. La base n'a pas besoin d'être restaurée."
}

case "${1:-install}" in
  install)
    preflight
    backup
    install_core
    install_web
    persist_and_restart
    echo
    ok "Installation terminée. Ouvrez JumpServer et videz le cache du navigateur (Ctrl+F5)."
    echo "   Nouveaux menus : Paramètres → Personnalisation / Restrictions de connexion,"
    echo "                    Audits → Rapports d'activité, Console → Sécurité des comptes."
    echo "   Pour revenir en arrière :  sudo ./install.sh rollback"
    ;;
  check)    preflight; ok "Tout est prêt : lancez  sudo ./install.sh" ;;
  rollback) rollback ;;
  *)        echo "Usage : sudo $0 [install|check|rollback]"; exit 1 ;;
esac
