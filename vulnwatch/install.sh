#!/usr/bin/env bash
# =====================================================================
#  VulnWatch — installation / mise à jour sur Ubuntu 22.04 / 24.04
#
#  Usage :   sudo bash install.sh            (HTTPS via Nginx, recommandé)
#            sudo NO_NGINX=1 bash install.sh (accès direct HTTP sur le port 8000)
#
#  Relancer le script met à jour l'application sans toucher à la
#  configuration (/etc/vulnwatch) ni aux données (/var/lib/vulnwatch).
# =====================================================================
set -euo pipefail

APP_DIR=/opt/vulnwatch
DATA_DIR=/var/lib/vulnwatch
CONF_DIR=/etc/vulnwatch
ENV_FILE=$CONF_DIR/vulnwatch.env
SVC_USER=vulnwatch
PORT=${PORT:-8000}
NO_NGINX=${NO_NGINX:-0}
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_ok() { echo -e "\e[32m✔\e[0m $*"; }
c_info() { echo -e "\e[36m➜\e[0m $*"; }
c_warn() { echo -e "\e[33m!\e[0m $*"; }

[[ $EUID -eq 0 ]] || { echo "Lancez ce script avec sudo."; exit 1; }
grep -qi ubuntu /etc/os-release || c_warn "Système non Ubuntu détecté : on continue quand même."

c_info "Installation des paquets système…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
PKGS="python3 python3-venv python3-pip openssl curl sqlite3"
[[ $NO_NGINX == 1 ]] || PKGS="$PKGS nginx"
apt-get install -y -qq $PKGS >/dev/null
c_ok "Paquets installés"

id -u $SVC_USER &>/dev/null || useradd --system --home $DATA_DIR --shell /usr/sbin/nologin $SVC_USER
mkdir -p $APP_DIR $DATA_DIR $CONF_DIR

c_info "Copie de l'application dans $APP_DIR…"
rm -rf $APP_DIR/app
cp -r "$SRC_DIR/app" "$SRC_DIR/requirements.txt" $APP_DIR/
find $APP_DIR -name "__pycache__" -type d -prune -exec rm -rf {} +

c_info "Environnement Python…"
[[ -d $APP_DIR/venv ]] || python3 -m venv $APP_DIR/venv
$APP_DIR/venv/bin/pip install -q --upgrade pip
$APP_DIR/venv/bin/pip install -q -r $APP_DIR/requirements.txt
c_ok "Dépendances Python installées"

FIRST_INSTALL=0
if [[ ! -f $ENV_FILE ]]; then
  FIRST_INSTALL=1
  IP=$(hostname -I | awk '{print $1}')
  ADMIN_PW=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  SECRET=$(openssl rand -hex 32)
  if [[ $NO_NGINX == 1 ]]; then URL="http://$IP:$PORT"; else URL="https://$IP"; fi
  sed -e "s|^VW_ADMIN_PASSWORD=.*|VW_ADMIN_PASSWORD=$ADMIN_PW|" \
      -e "s|^VW_SECRET_KEY=.*|VW_SECRET_KEY=$SECRET|" \
      -e "s|^VW_BASE_URL=.*|VW_BASE_URL=$URL|" \
      "$SRC_DIR/vulnwatch.env.example" > $ENV_FILE
  echo "VW_DB_PATH=$DATA_DIR/vulnwatch.db" >> $ENV_FILE
  c_ok "Configuration créée : $ENV_FILE"
fi
grep -q "^VW_DB_PATH=" $ENV_FILE || echo "VW_DB_PATH=$DATA_DIR/vulnwatch.db" >> $ENV_FILE
chown -R root:$SVC_USER $CONF_DIR && chmod 750 $CONF_DIR && chmod 640 $ENV_FILE
chown -R $SVC_USER:$SVC_USER $DATA_DIR && chmod 750 $DATA_DIR
chown -R root:root $APP_DIR

if [[ $NO_NGINX == 1 ]]; then HOST=0.0.0.0; else HOST=127.0.0.1; fi

c_info "Service systemd…"
cat > /etc/systemd/system/vulnwatch.service <<EOF
[Unit]
Description=VulnWatch - veille des vulnerabilites
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/uvicorn app.main:app --host $HOST --port $PORT --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-server-header
Restart=always
RestartSec=5
# Durcissement
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vulnwatch >/dev/null 2>&1
systemctl restart vulnwatch
c_ok "Service vulnwatch démarré"

if [[ $NO_NGINX != 1 ]]; then
  c_info "Nginx + certificat TLS…"
  TLS=$CONF_DIR/tls
  mkdir -p $TLS
  if [[ ! -f $TLS/vulnwatch.crt ]]; then
    IP=$(hostname -I | awk '{print $1}')
    openssl req -x509 -nodes -newkey rsa:3072 -days 825 \
      -keyout $TLS/vulnwatch.key -out $TLS/vulnwatch.crt \
      -subj "/CN=$(hostname)/O=VulnWatch" \
      -addext "subjectAltName=DNS:$(hostname),IP:$IP" 2>/dev/null
    chmod 600 $TLS/vulnwatch.key
    c_ok "Certificat auto-signé généré (remplaçable par celui de votre PKI : $TLS/)"
  fi
  cat > /etc/nginx/sites-available/vulnwatch <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name _;
    ssl_certificate     $TLS/vulnwatch.crt;
    ssl_certificate_key $TLS/vulnwatch.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=31536000" always;
    server_tokens off;
    client_max_body_size 1m;
    gzip on;
    gzip_types text/css application/javascript application/json text/csv;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
  # "http2 on" n'existe qu'à partir de nginx 1.25 (Ubuntu 24.10+) : repli pour 22.04/24.04
  if ! nginx -V 2>&1 | grep -qE "nginx/1\.(2[5-9]|[3-9][0-9])"; then
    sed -i -e '/http2 on;/d' -e 's/listen 443 ssl default_server;/listen 443 ssl http2 default_server;/' \
           -e 's/listen \[::\]:443 ssl default_server;/listen [::]:443 ssl http2 default_server;/' /etc/nginx/sites-available/vulnwatch
  fi
  ln -sf /etc/nginx/sites-available/vulnwatch /etc/nginx/sites-enabled/vulnwatch
  rm -f /etc/nginx/sites-enabled/default
  nginx -t -q && systemctl reload nginx
  c_ok "Nginx configuré (HTTPS)"
fi

if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  if [[ $NO_NGINX == 1 ]]; then ufw allow $PORT/tcp >/dev/null; else ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
  c_ok "Pare-feu UFW ouvert"
fi

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then c_ok "VulnWatch répond"; else c_warn "Le service ne répond pas encore : journalctl -u vulnwatch -f"; fi

URL=$(grep "^VW_BASE_URL=" $ENV_FILE | cut -d= -f2-)
echo
echo "=================================================================="
echo "  VulnWatch est installé"
echo "  Accès        : $URL"
echo "  Utilisateur  : $(grep '^VW_ADMIN_USER=' $ENV_FILE | cut -d= -f2-)"
if [[ $FIRST_INSTALL == 1 ]]; then
echo "  Mot de passe : $ADMIN_PW   (à conserver, modifiable dans $ENV_FILE)"
fi
echo "  Config       : $ENV_FILE   (clés API, notifications)"
echo "  Journaux     : journalctl -u vulnwatch -f"
echo "=================================================================="
echo "  La première synchronisation démarre automatiquement (5 à 30 min"
echo "  sans clé NVD). Ajoutez NVD_API_KEY pour l'accélérer."
echo
