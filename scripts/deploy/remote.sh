#!/usr/bin/env bash
# Server-side converger, run by deploy.sh over ssh (also fine to run manually on the box).
# Every step checks before it changes: a fully provisioned server skips straight to build+restart.
set -euo pipefail

APP=/opt/freeshop
# shellcheck disable=SC1091
source "$APP/deploy.env"

log()  { echo "——— $*"; }
ok()   { echo "  ok: $*"; }

export DEBIAN_FRONTEND=noninteractive

# ——— 1. swap (only when RAM < 2 GB and no swap exists — next build needs the headroom) ———
log "swap"
ram_kb="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
if [ "$ram_kb" -lt 1900000 ] && [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "created 2G swapfile"
else
  ok "sufficient RAM or swap already present"
fi

# ——— 2. node >= 22.12 (installs 24.x from nodesource when missing/too old) ———
log "node"
node_ok() { command -v node >/dev/null && node -e 'process.exit(process.versions.node.localeCompare("22.12.0", undefined, {numeric:true}) < 0 ? 1 : 0)'; }
if node_ok; then
  ok "node $(node --version)"
else
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
  ok "installed node $(node --version)"
fi

# ——— 3. pnpm ———
log "pnpm"
if command -v pnpm >/dev/null; then
  ok "pnpm $(pnpm --version)"
else
  corepack enable && corepack prepare pnpm@latest --activate
  ok "installed pnpm $(pnpm --version)"
fi
PNPM="$(command -v pnpm)"

# ——— 4. base packages ———
log "packages (postgresql, caddy, rsync, git)"
missing=""
for pkg in postgresql caddy rsync git; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing="$missing $pkg"
done
if [ -n "$missing" ]; then
  apt-get update -qq && apt-get install -y $missing
  ok "installed:$missing"
else
  ok "all present"
fi
systemctl enable --now postgresql >/dev/null

# ——— 5. postgres role + databases (password kept in sync with deploy.env) ———
log "postgres"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='freeshop'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE USER freeshop;"
sudo -u postgres psql -qc "ALTER USER freeshop WITH PASSWORD '$DB_PASSWORD';"
for db in freeshop_launcher freeshop_indexer; do
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || sudo -u postgres createdb -O freeshop "$db"
done
ok "role + freeshop_launcher + freeshop_indexer"

# ——— 6. env files (regenerated every deploy — deploy.env is the source of truth) ———
log "env files"
cat > "$APP/apps/indexer/.env.production" <<EOF
INDEXER_CHAIN_ID=$CHAIN_ID
INDEXER_RPC_URL=$RPC_URL
FACTORY_ADDRESS=$FACTORY_ADDRESS
START_BLOCK=$START_BLOCK
DATABASE_URL=postgres://freeshop:$DB_PASSWORD@localhost/freeshop_indexer
DATABASE_SCHEMA=freeshop
EOF
cat > "$APP/apps/launcher/.env.production" <<EOF
NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID
NEXT_PUBLIC_RPC_URL=$PUBLIC_RPC_URL
NEXT_PUBLIC_FACTORY_ADDRESS=$FACTORY_ADDRESS
NEXT_PUBLIC_USDC_ADDRESS=$USDC_ADDRESS
SESSION_SECRET=$SESSION_SECRET
DATABASE_URL=postgres://freeshop:$DB_PASSWORD@localhost/freeshop_launcher
PONDER_URL=http://127.0.0.1:42069
${TEMPLATE_REPO_URL:+NEXT_PUBLIC_TEMPLATE_REPO_URL=$TEMPLATE_REPO_URL}
EOF
chmod 600 "$APP"/apps/*/.env.production
ok "written"

# ——— 7. install deps + build (NEXT_PUBLIC_* bake at build time, so source env first) ———
log "install + build"
cd "$APP"
"$PNPM" install --frozen-lockfile
cd "$APP/apps/launcher"
set -a; source .env.production; set +a
# Node caps its heap at ~half of RAM, which OOMs next build's TypeScript pass on small boxes;
# raise the ceiling and let the swapfile absorb the difference.
NODE_OPTIONS="--max-old-space-size=1536" "$PNPM" build
ok "built (storefront template + launcher)"

# ——— 8. systemd units (rewritten each run; daemon-reload picks up changes) ———
log "systemd units"
cat > /etc/systemd/system/freeshop-launcher.service <<EOF
[Unit]
Description=freeshop launcher
After=network-online.target postgresql.service

[Service]
WorkingDirectory=$APP/apps/launcher
EnvironmentFile=$APP/apps/launcher/.env.production
ExecStart=$PNPM start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/freeshop-indexer.service <<EOF
[Unit]
Description=freeshop indexer (ponder)
After=network-online.target postgresql.service

[Service]
WorkingDirectory=$APP/apps/indexer
EnvironmentFile=$APP/apps/indexer/.env.production
ExecStart=$PNPM start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable freeshop-launcher freeshop-indexer >/dev/null 2>&1
ok "written + enabled"

# ——— 9. caddy (TLS reverse proxy; only rewritten when the config actually changed) ———
log "caddy"
caddyfile="$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}"
if [ "$(cat /etc/caddy/Caddyfile 2>/dev/null)" != "$caddyfile" ]; then
  printf '%s\n' "$caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy
  ok "Caddyfile updated for $DOMAIN"
else
  ok "unchanged"
fi

# ——— 10. restart + health checks ———
log "restart"
systemctl restart freeshop-indexer freeshop-launcher
sleep 5
for target in "launcher http://127.0.0.1:3000" "indexer http://127.0.0.1:42069/ready"; do
  name="${target%% *}" url="${target#* }"
  if curl -sf -o /dev/null --max-time 10 --retry 5 --retry-delay 3 --retry-all-errors "$url"; then
    ok "$name responding"
  else
    echo "  WARNING: $name not responding yet — check: journalctl -u freeshop-$name -n 50" >&2
  fi
done

log "done"
