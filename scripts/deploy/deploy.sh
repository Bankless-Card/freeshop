#!/usr/bin/env bash
# Idempotent one-command deploy: provisions a bare Ubuntu box on the first run, redeploys on
# every run after that.
#
#   cp scripts/deploy/deploy.env.example scripts/deploy/deploy.env   # fill it in
#   scripts/deploy/deploy.sh
#
# What it does each run:
#   1. loads scripts/deploy/deploy.env (auto-generating blank secrets and writing them back)
#   2. rsyncs this working tree to $SERVER:/opt/freeshop (build artifacts excluded)
#   3. runs remote.sh on the server, which converges infra (swap, node, pnpm, postgres, caddy,
#      systemd units, env files) and then builds + restarts the services
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$HERE/deploy.env"

[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found — copy deploy.env.example and fill it in" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

for var in SERVER DOMAIN CHAIN_ID RPC_URL PUBLIC_RPC_URL FACTORY_ADDRESS START_BLOCK USDC_ADDRESS; do
  [ -n "${!var:-}" ] || { echo "error: $var is not set in deploy.env" >&2; exit 1; }
done

# Auto-generate blank secrets once and persist them back into deploy.env, so re-runs are stable.
generate_secret() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    local value
    value="$(openssl rand -hex 32)"
    printf -v "$name" '%s' "$value"
    # Replace the "NAME=" line in place (BSD/GNU sed portable via temp file).
    sed "s|^${name}=.*|${name}=${value}|" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    echo "generated $name and saved it to deploy.env"
  fi
}
generate_secret DB_PASSWORD
generate_secret SESSION_SECRET

echo "——— syncing code to $SERVER:/opt/freeshop ———"
ssh "$SERVER" 'mkdir -p /opt/freeshop'
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude dist \
  --exclude build \
  --exclude template-dist \
  --exclude .ponder \
  --exclude .data \
  --exclude 'contracts/out' \
  --exclude 'contracts/cache' \
  --exclude 'contracts/broadcast' \
  --exclude 'scripts/deploy/deploy.env' \
  "$REPO_ROOT/" "$SERVER:/opt/freeshop/"

echo "——— pushing deploy config ———"
scp -q "$ENV_FILE" "$SERVER:/opt/freeshop/deploy.env"
ssh "$SERVER" 'chmod 600 /opt/freeshop/deploy.env'

echo "——— converging server ———"
ssh "$SERVER" 'bash /opt/freeshop/scripts/deploy/remote.sh'

echo
echo "deployed: https://$DOMAIN  (sanity check: https://$DOMAIN/technical)"
