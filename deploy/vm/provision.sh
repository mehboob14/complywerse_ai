#!/usr/bin/env bash
# =============================================================================
# ComplyVerse GRC — provision an Ubuntu 24.04 VM the way production runs.
#
#   nginx :80/:443 ─┬─ /grc/*  → backend  (uvicorn main:app, 127.0.0.1:4000)
#                   └─ /*      → frontend (next start,      127.0.0.1:3000)
#   PostgreSQL 16   grc_master + one grc_<tenant> database per tenant
#   Redis           Celery broker/results + job status
#   systemd         grc-backend, grc-frontend, grc-worker (Celery: policy
#                   parsing, gap analysis, auto-mapping, collectors)
#
# Run as root on the new VM:
#     bash provision.sh
# Settings are environment variables, e.g.
#     DOMAIN=grc.example.com PROD_SSH=mehboob@<prod-ip> bash provision.sh
#
#   APP_USER   Linux user that owns and runs the app       (mehboob)
#   APP_DIR    checkout location          (/home/$APP_USER/grc-final/complywerse_ai)
#   BRANCH     git branch to deploy                        (scf-control-plane)
#   REPO_URL   git remote (SSH, uses a deploy key)
#   DOMAIN     public hostname, e.g. acme.compliverse.ai; blank serves on the
#              VM's IP over HTTP. The first label is the tenant the app resolves.
#   LETSENCRYPT_EMAIL  with DOMAIN: request an HTTPS certificate (once DNS
#              points here) and redirect HTTP to HTTPS. Renewal is automatic.
#   NEW_SESSION_SECRET=1  give this VM its own SESSION_SECRET, so sessions and
#              cookies issued by another server (e.g. production on a sibling
#              subdomain) are not honoured here.
#   PROD_SSH   user@host of the production VM. When set, production's
#              backend/.env is copied across (server to server, never shown)
#              so this VM keeps the same SESSION_SECRET, AI and SMTP settings.
#   PROD_ENV_FILE  or: production's backend/.env already copied onto this VM
#              (e.g. /root/prod-backend.env). Moved into place, then deleted.
#   SWAP_GB    swap to create if the VM has none           (4)
#
# Safe to re-run: it pulls the branch, reinstalls dependencies, rebuilds the
# frontend and restarts the services — which also makes it the deploy script.
# It never prints a secret. Database passwords it generates live in
# /root/.grc-db-password (mode 600) and in backend/.env (mode 600).
# =============================================================================
set -euo pipefail

APP_USER=${APP_USER:-mehboob}
APP_HOME=/home/$APP_USER
APP_DIR=${APP_DIR:-$APP_HOME/grc-final/complywerse_ai}
BRANCH=${BRANCH:-scf-control-plane}
REPO_URL=${REPO_URL:-git@github.com:mehboob14/complywerse_ai.git}
DOMAIN=${DOMAIN:-}
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL:-}
NEW_SESSION_SECRET=${NEW_SESSION_SECRET:-0}
PROD_SSH=${PROD_SSH:-}
PROD_ENV_FILE=${PROD_ENV_FILE:-}
PROD_APP_DIR=${PROD_APP_DIR:-grc-final/complywerse_ai}   # relative to the prod user's home
NODE_MAJOR=${NODE_MAJOR:-20}
SWAP_GB=${SWAP_GB:-4}
DB_USER=${DB_USER:-grc}
UVICORN_WORKERS=${UVICORN_WORKERS:-2}
PUBLIC_IP=${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
as_app() { sudo -u "$APP_USER" -H "$@"; }

# Set KEY=VALUE in a dotenv file: replace the existing line or append one.
# Python, not sed, so passwords and URLs never need escaping.
set_env() {
  python3 - "$1" "$2" "$3" <<'PY'
import pathlib, re, sys
path, key, value = sys.argv[1:4]
p = pathlib.Path(path)
lines = p.read_text().splitlines() if p.exists() else []
out, done = [], False
for line in lines:
    if re.match(rf"^\s*(export\s+)?{re.escape(key)}\s*=", line):
        if not done:
            out.append(f"{key}={value}")
            done = True
        continue
    out.append(line)
if not done:
    out.append(f"{key}={value}")
p.write_text("\n".join(out) + "\n")
PY
}

[[ $EUID -eq 0 ]] || die "run as root (sudo -i, then bash provision.sh)"
. /etc/os-release
[[ ${VERSION_ID:-} == "24.04" ]] || note "Tested on Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}. Continuing."
export DEBIAN_FRONTEND=noninteractive

# -----------------------------------------------------------------------------
step "System packages"
apt-get update -q
APT_OPTS=(-y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
apt-get "${APT_OPTS[@]}" upgrade
apt-get "${APT_OPTS[@]}" install \
  git curl ca-certificates gnupg openssl rsync build-essential pkg-config \
  python3 python3-venv python3-dev libpq-dev \
  postgresql postgresql-contrib redis-server nginx ufw fail2ban \
  tesseract-ocr unattended-upgrades

if ! command -v node >/dev/null || [[ $(node -v | sed 's/^v//;s/\..*//') != "$NODE_MAJOR" ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q && apt-get "${APT_OPTS[@]}" install nodejs
fi
note "node $(node -v), npm $(npm -v), $(python3 --version), $(psql --version | awk '{print "PostgreSQL",$3}')"

# -----------------------------------------------------------------------------
step "Swap (a Next.js production build needs ~2.5 GB)"
if [[ -z $(swapon --show --noheadings) ]]; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-grc-swap.conf && sysctl -q -p /etc/sysctl.d/99-grc-swap.conf
  note "created ${SWAP_GB} GB swap"
else
  note "swap already present"
fi

# -----------------------------------------------------------------------------
step "App user: $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
  usermod -aG sudo "$APP_USER"
  note "set a password for $APP_USER (needed for sudo) — type it below, it is not stored anywhere else:"
  passwd "$APP_USER"
fi
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"

# -----------------------------------------------------------------------------
step "PostgreSQL and Redis"
systemctl enable --now postgresql redis-server >/dev/null
DB_PASS_FILE=/root/.grc-db-password
if [[ ! -s $DB_PASS_FILE ]]; then
  (umask 077 && openssl rand -hex 24 > "$DB_PASS_FILE")
fi
DB_PASS=$(<"$DB_PASS_FILE")
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "CREATE ROLE $DB_USER LOGIN CREATEDB"
fi
# CREATEDB, not superuser: the app creates one database per tenant, nothing more.
sudo -u postgres psql -q -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE $DB_USER WITH LOGIN CREATEDB PASSWORD '$DB_PASS'"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='grc_master'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" grc_master
fi
note "role $DB_USER + database grc_master ready; Redis on 127.0.0.1:6379"

# -----------------------------------------------------------------------------
step "Code: $REPO_URL ($BRANCH) → $APP_DIR"
KEY=$APP_HOME/.ssh/id_ed25519
[[ -f $KEY ]] || as_app ssh-keygen -q -t ed25519 -N "" -C "grc-deploy@$(hostname)" -f "$KEY"
as_app bash -c 'ssh-keyscan -t ed25519 github.com 2>/dev/null >> ~/.ssh/known_hosts; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts'
if ! as_app git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; then
  REPO_PATH=${REPO_URL#*:}; REPO_PATH=${REPO_PATH%.git}
  echo
  echo "  GitHub does not know this VM yet. Add its deploy key (read-only is enough):"
  echo "    https://github.com/${REPO_PATH}/settings/keys  →  Add deploy key"
  echo
  cat "$KEY.pub"
  echo
  until as_app git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; do
    read -rp "  Press Enter once the key is saved on GitHub (q to stop)… " answer
    [[ ${answer:-} == q ]] && die "stopped before cloning; re-run this script once the key is added"
    # GitHub's own answer, so "Permission denied" is not a guess.
    as_app ssh -T -o BatchMode=yes git@github.com 2>&1 | sed 's/^/    github: /' || true
  done
fi
if [[ -d $APP_DIR/.git ]]; then
  as_app git -C "$APP_DIR" fetch -q origin "$BRANCH"
  as_app git -C "$APP_DIR" checkout -q "$BRANCH"
  as_app git -C "$APP_DIR" pull -q --ff-only origin "$BRANCH"
else
  as_app mkdir -p "$(dirname "$APP_DIR")"
  as_app git clone -q -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
note "at $(as_app git -C "$APP_DIR" log -1 --format='%h %s')"

# -----------------------------------------------------------------------------
step "Backend configuration (backend/.env)"
ENV_FILE=$APP_DIR/backend/.env
if [[ -n $PROD_ENV_FILE && ! -f $ENV_FILE ]]; then
  [[ -s $PROD_ENV_FILE ]] || die "PROD_ENV_FILE=$PROD_ENV_FILE is missing or empty"
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$PROD_ENV_FILE" "$ENV_FILE"
  rm -f "$PROD_ENV_FILE"       # the only other copy of production's secrets on this VM
  FROM_PROD=1
fi
if [[ -n $PROD_SSH && ! -f $ENV_FILE ]]; then
  note "copying production's backend/.env from $PROD_SSH (you may be asked for its password)"
  scp -q "$PROD_SSH:$PROD_APP_DIR/backend/.env" "$ENV_FILE" \
    || die "could not copy $PROD_SSH:$PROD_APP_DIR/backend/.env"
  FROM_PROD=1
fi
if [[ ! -f $ENV_FILE ]]; then
  cp "$APP_DIR/backend/.env.example" "$ENV_FILE"
  set_env "$ENV_FILE" SESSION_SECRET "$(openssl rand -hex 32)"
  FRESH_ENV=1
fi
cp -p "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
if [[ $NEW_SESSION_SECRET == 1 ]]; then
  # Stored credentials are encrypted with SESSION_SECRET (grc/crypto.py) and
  # cannot be read after a change, so only rotate while no organisation exists.
  # (The table appears on the backend's first start; a failing query stops the script.)
  has_table=$(sudo -u postgres psql -d grc_master -Atc "SELECT to_regclass('public.grc_tenants') IS NOT NULL")
  tenants=0
  if [[ $has_table == t ]]; then
    tenants=$(sudo -u postgres psql -d grc_master -Atc 'SELECT count(*) FROM grc_tenants')
  fi
  if [[ $tenants == 0 ]]; then
    set_env "$ENV_FILE" SESSION_SECRET "$(openssl rand -hex 32)"
    note "new SESSION_SECRET: tokens from any other server are no longer accepted here"
  else
    note "SESSION_SECRET kept: $tenants organisation(s) already exist, and credentials they saved are encrypted with it"
  fi
fi
# Infrastructure is this VM's own; everything else (AI keys, SMTP, secrets) is kept.
set_env "$ENV_FILE" MASTER_DATABASE_URL    "postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/grc_master"
set_env "$ENV_FILE" TENANT_DB_URL_TEMPLATE "postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/grc_{slug}"
set_env "$ENV_FILE" POSTGRES_ADMIN_URL     "postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/postgres"
set_env "$ENV_FILE" REDIS_URL              "redis://127.0.0.1:6379/0"
set_env "$ENV_FILE" CELERY_BROKER_URL      "redis://127.0.0.1:6379/1"
set_env "$ENV_FILE" CELERY_RESULT_BACKEND  "redis://127.0.0.1:6379/2"
set_env "$ENV_FILE" TESSERACT_CMD          "/usr/bin/tesseract"
if [[ -n $DOMAIN ]]; then
  PUBLIC_URL="https://$DOMAIN"
  set_env "$ENV_FILE" AUTH_COOKIE_DOMAIN   ".$DOMAIN"
  set_env "$ENV_FILE" ALLOWED_ORIGIN_REGEX "^https?://([a-z0-9-]+\\.)?${DOMAIN//./\\.}\$"
  set_env "$ENV_FILE" ALLOWED_ORIGINS      ""
  # REPL_DEPLOYMENT (Secure cookies) is set after the HTTPS step below.
else
  PUBLIC_URL="http://$PUBLIC_IP"
  set_env "$ENV_FILE" AUTH_COOKIE_DOMAIN   ""
  set_env "$ENV_FILE" ALLOWED_ORIGIN_REGEX ""
  set_env "$ENV_FILE" ALLOWED_ORIGINS      "$PUBLIC_URL"
  set_env "$ENV_FILE" REPL_DEPLOYMENT      "0"     # no HTTPS yet: Secure cookies would never be sent
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE" "$ENV_FILE".bak.* && chmod 600 "$ENV_FILE" "$ENV_FILE".bak.*
as_app mkdir -p "$APP_DIR/backend/uploads" "$APP_DIR/backend/static"

# -----------------------------------------------------------------------------
step "Backend dependencies (Python venv)"
[[ -x $APP_DIR/backend/venv/bin/python ]] || as_app python3 -m venv "$APP_DIR/backend/venv"
as_app "$APP_DIR/backend/venv/bin/pip" install -q --upgrade pip wheel
as_app "$APP_DIR/backend/venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"

# -----------------------------------------------------------------------------
step "Frontend build (Next.js)"
FENV=$APP_DIR/grc-frontend/.env.local
# Rewrites to the backend are resolved at build time, so this must exist before `npm run build`.
set_env "$FENV" BACKEND_URL              "http://127.0.0.1:4000/grc"
set_env "$FENV" NEXT_PUBLIC_API_BASE_URL "/api"
# Blank: the connect wizard then uses the page's own origin, which stays right
# whether the site is reached by IP, over HTTP, or over HTTPS once the
# certificate lands later in this run (a value baked in here could not follow).
set_env "$FENV" NEXT_PUBLIC_BACKEND_URL  ""
chown "$APP_USER:$APP_USER" "$FENV"
as_app bash -c "cd '$APP_DIR/grc-frontend' && npm ci --no-audit --no-fund --loglevel=error"
systemctl stop grc-frontend 2>/dev/null || true     # free its memory for the build
# next/font downloads Google Fonts during the build. Node races IPv4/IPv6 with a
# 250 ms deadline per attempt; on a busy 2-CPU build the deadline passes before
# the connection is seen, and the download fails ("failed, reason:" and retries).
NET_OPT=$(node -p "process.allowedNodeEnvironmentFlags.has('--network-family-autoselection-attempt-timeout') ? '--network-family-autoselection-attempt-timeout=10000' : ''")
as_app bash -c "cd '$APP_DIR/grc-frontend' && NODE_OPTIONS='$NET_OPT' NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_CPUS=1 NEXT_MAX_OLD_SPACE_MB=3072 npm run build"

# -----------------------------------------------------------------------------
step "systemd services"
cat > /etc/systemd/system/grc-backend.service <<EOF
[Unit]
Description=ComplyVerse GRC backend (FastAPI)
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target postgresql.service redis-server.service

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=$APP_DIR/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 4000 --workers $UVICORN_WORKERS --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/grc-worker.service <<EOF
[Unit]
Description=ComplyVerse GRC Celery worker (parsing, gap analysis, auto-mapping, collectors)
After=network-online.target redis-server.service postgresql.service
Wants=redis-server.service postgresql.service

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
# Threads: the jobs wait on AI and HTTP calls, and one process holds one copy
# of the app in memory instead of one per child.
ExecStart=$APP_DIR/backend/venv/bin/python -m celery -A grc.celery_app:celery_app worker -Q parsing,default --pool=threads --concurrency=4 --loglevel=info -n parsing@%%h
Restart=always
RestartSec=5
# Let a running parse finish on stop/restart.
TimeoutStopSec=600
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/grc-frontend.service <<EOF
[Unit]
Description=ComplyVerse GRC frontend (Next.js)
After=network-online.target grc-backend.service
Wants=grc-backend.service

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/grc-frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start -- -p 3000 -H 127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

# -----------------------------------------------------------------------------
step "nginx${DOMAIN:+ and HTTPS for $DOMAIN}"
ACME_ROOT=/var/www/letsencrypt
install -d -m 755 "$ACME_ROOT"
CERT_DIR=/etc/letsencrypt/live/${DOMAIN:-none}
have_cert() { [[ -n $DOMAIN && -f $CERT_DIR/fullchain.pem ]]; }

# The whole site file is generated here, TLS included, so re-running this
# script never drops HTTPS the way re-writing a certbot-edited file would.
write_nginx() {
  {
    cat <<EOF
# ComplyVerse GRC — generated by provision.sh. Edit the script, not this file:
# a re-run rewrites it.
map \$http_upgrade \$grc_connection_upgrade {
    default upgrade;
    ''      close;
}
EOF
    if have_cert; then
      cat <<EOF

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root $ACME_ROOT; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name $DOMAIN;
    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:grc_ssl:10m;
    ssl_session_timeout 1d;
    # This host only (no includeSubDomains): sibling subdomains are untouched.
    add_header Strict-Transport-Security "max-age=31536000" always;
EOF
    else
      cat <<EOF

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN:-_};
    location /.well-known/acme-challenge/ { root $ACME_ROOT; }
EOF
    fi
    cat <<EOF

    client_max_body_size 100m;        # evidence uploads, policy documents
    proxy_read_timeout 900s;          # policy parsing and AI calls run long
    proxy_send_timeout 900s;

    # All headers at server level: a location that sets any proxy_set_header
    # stops inheriting these, so none of the locations below set their own.
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$grc_connection_upgrade;

    # Backend directly: API docs, health, OAuth callbacks.
    location /grc/ {
        proxy_pass http://127.0.0.1:4000;
    }

    # Everything else: the Next.js app, which proxies /api/* to the backend.
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
EOF
  } > /etc/nginx/sites-available/grc
}

write_nginx
ln -sf /etc/nginx/sites-available/grc /etc/nginx/sites-enabled/grc
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl enable --now nginx >/dev/null && systemctl reload nginx

if [[ -n $DOMAIN ]] && ! have_cert; then
  resolved=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')
  if [[ -z $LETSENCRYPT_EMAIL ]]; then
    note "HTTPS: re-run with LETSENCRYPT_EMAIL=you@yourdomain once $DOMAIN points at $PUBLIC_IP"
  elif [[ $resolved != "$PUBLIC_IP" ]]; then
    note "HTTPS skipped: $DOMAIN resolves to ${resolved:-nothing yet}, not $PUBLIC_IP."
    note "Re-run this script once the DNS record has propagated."
  else
    apt-get "${APT_OPTS[@]}" install certbot
    certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
      --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" \
      --deploy-hook "systemctl reload nginx"
    write_nginx
    nginx -t -q && systemctl reload nginx
    note "certificate issued for $DOMAIN; renewals run automatically (certbot.timer)"
  fi
fi
if [[ -n $DOMAIN ]]; then
  if have_cert; then
    PUBLIC_URL="https://$DOMAIN"
    set_env "$ENV_FILE" REPL_DEPLOYMENT "1"     # Secure cookies: HTTPS is live
  else
    PUBLIC_URL="http://$DOMAIN"
    set_env "$ENV_FILE" REPL_DEPLOYMENT "0"     # no HTTPS yet: Secure cookies would never be sent
  fi
fi

# -----------------------------------------------------------------------------
step "Firewall (SSH, HTTP, HTTPS only)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null
note "$(ufw status | head -1)"

# -----------------------------------------------------------------------------
step "Start services"
systemctl enable grc-backend grc-worker grc-frontend >/dev/null
systemctl restart grc-backend grc-worker
systemctl restart grc-frontend

wait_for() {  # wait_for NAME URL
  for _ in $(seq 1 90); do
    curl -fsS -o /dev/null "$2" && { note "$1 is up"; return 0; }
    sleep 2
  done
  echo "    $1 did not answer at $2 — see: journalctl -u grc-${1} -n 80 --no-pager"
  return 1
}
ok=1
wait_for backend  "http://127.0.0.1:4000/grc/health" || ok=0
wait_for frontend "http://127.0.0.1:3000/login"      || ok=0
systemctl is-active --quiet grc-worker && note "worker is up" || { echo "    worker is not running — journalctl -u grc-worker -n 80 --no-pager"; ok=0; }

# -----------------------------------------------------------------------------
step "Done"
echo "  App:      $PUBLIC_URL"
echo "  Services: systemctl status grc-backend grc-frontend grc-worker"
echo "  Logs:     journalctl -u grc-backend -f     (or grc-frontend / grc-worker)"
echo "  Update:   re-run this script (pulls $BRANCH, rebuilds, restarts)"
if [[ ${FROM_PROD:-0} == 1 ]]; then
  echo
  echo "  backend/.env came from production (same SESSION_SECRET, AI and SMTP settings);"
  echo "  only the database, Redis and domain settings were pointed at this VM."
fi
if [[ ${FRESH_ENV:-0} == 1 ]]; then
  echo
  echo "  backend/.env was created from the template with a new SESSION_SECRET."
  echo "  Fill in the external keys (OPENAI_API_KEY, SMTP_*, …) with:"
  echo "    sudo -u $APP_USER nano $ENV_FILE && systemctl restart grc-backend grc-worker"
fi
if [[ -n $DOMAIN ]] && ! have_cert; then
  echo
  echo "  HTTPS is not on yet. Once $DOMAIN points at $PUBLIC_IP, re-run with:"
  echo "    DOMAIN=$DOMAIN LETSENCRYPT_EMAIL=you@yourdomain bash $0"
fi
[[ $ok == 1 ]] || exit 1
