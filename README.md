# freeshop — decentralized storefront launcher

Infrastructure that lets a solo merchant sell online for crypto with no backend of their own:

- **`contracts/`** — Foundry project: `StorefrontFactory` (platform-deployed, charges the launch
  fee, registry of merchant stores) and `StoreEscrow` (one per product: payment, on-chain order
  status, encrypted fulfillment blobs emitted in the pay tx, merchant refunds/withdrawals).
- **`apps/storefront/`** — static, self-hostable storefront template (zero backend): product page,
  wallet connect, in-browser encryption of order details, pay/status/claim-refund flows.
- **`apps/launcher/`** — the platform web app (the only component with a backend): SIWE auth,
  merchant accounts, store deployment wizard, storefront package generation, and the merchant
  dashboard (analytics, orders with in-browser decryption, fulfil/refund/withdraw).
- **`apps/indexer/`** — Ponder indexer over the factory + all deployed stores; serves the
  read-only analytics API the dashboard uses. Derived state, rebuildable from chain.
- **`packages/shared/`** — contract ABIs, config schemas, and crypto helpers shared across apps.

Execution state and per-milestone checklists live in [TASKS.md](TASKS.md).

## Quick start

```sh
pnpm contracts:build     # forge build
pnpm contracts:test      # forge test (58 tests)
pnpm --filter @freeshop/shared test        # crypto/config units + anvil e2e
pnpm --filter @freeshop/storefront build   # static storefront in apps/storefront/dist
pnpm --filter @freeshop/storefront dev     # storefront dev server
```

Node >= 22.12 (see `.nvmrc`), pnpm, and Foundry are required.

See [contracts/README.md](contracts/README.md) for deploy/smoke-test instructions.

## Deploying to production (Sepolia + a small VPS)

Two services run on the server: the **launcher** (Next.js, the only app with a backend) and the
**indexer** (Ponder). Contracts are deployed once from your own machine. Merchants' storefronts
are self-hosted and never touch this server.

### Automated setup & deploy (recommended)

After deploying the contracts (step 1 below), everything else is one idempotent command against
a bare Ubuntu box:

```sh
cp scripts/deploy/deploy.env.example scripts/deploy/deploy.env   # fill in server, domain, RPC, factory
scripts/deploy/deploy.sh
```

The first run provisions the machine — swap if RAM is low, Node 24, pnpm, Postgres (role + both
databases), Caddy with TLS for your domain, systemd units, env files generated from
`deploy.env` — then builds and starts both services with health checks. Every later run rsyncs
the current working tree, converges anything that drifted, rebuilds, and restarts. Blank
secrets (`DB_PASSWORD`, `SESSION_SECRET`) are generated on first run and written back into your
gitignored `deploy.env`, which is the single source of truth pushed to the server.

The manual steps below do the same thing piece by piece, and double as documentation for what
the script manages.

A 2 GB DigitalOcean/Hetzner box (1 shared vCPU) is plenty; on 1 GB add swap first —
`next build` is the only memory-hungry step:

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 0. Prerequisites

- A Sepolia RPC URL from a free tier (Alchemy/Infura/dRPC). Public endpoints are too
  rate-limited for the indexer's backfill.
- A funded Sepolia deployer wallet ([faucets](https://sepoliafaucet.com)) and an Etherscan API
  key (for source verification).
- A domain pointed at the server (for TLS).

### 1. Deploy the contracts (from your machine, needs Foundry)

```sh
cd contracts
export SEPOLIA_RPC_URL=https://...
export ETHERSCAN_API_KEY=...
export TREASURY=0x...              # optional, defaults to deployer
export LAUNCH_FEE=5000000000000000 # optional, defaults to 0.005 ether

forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify \
  --private-key $DEPLOYER_KEY
```

Note two things from the output/explorer: the **factory address** and the **block it was
deployed in** — both are needed below. Sepolia USDC
(`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) is allowlisted by the script.

### 2. Server setup (Ubuntu 22.04/24.04)

```sh
# Node 24 + pnpm + Postgres + Caddy (TLS reverse proxy)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs postgresql caddy git
corepack enable && corepack prepare pnpm@latest --activate

# One Postgres instance, separate databases per service
sudo -u postgres psql -c "CREATE USER freeshop WITH PASSWORD '...';"
sudo -u postgres psql -c "CREATE DATABASE freeshop_launcher OWNER freeshop;"
sudo -u postgres psql -c "CREATE DATABASE freeshop_indexer OWNER freeshop;"

git clone <this repo> /opt/freeshop && cd /opt/freeshop && pnpm install
```

### 3. Configure

`/opt/freeshop/apps/indexer/.env.production`:

```sh
INDEXER_CHAIN_ID=11155111
INDEXER_RPC_URL=https://...              # your keyed RPC
FACTORY_ADDRESS=0x...                    # from step 1
START_BLOCK=...                          # factory deploy block from step 1
DATABASE_URL=postgres://freeshop:...@localhost/freeshop_indexer
DATABASE_SCHEMA=freeshop                 # required when Ponder runs on Postgres
```

`/opt/freeshop/apps/launcher/.env.production` — note that `NEXT_PUBLIC_*` values are **baked in
at build time** (rebuild after changing them), and are visible to browsers (don't put a private
RPC key in `NEXT_PUBLIC_RPC_URL` unless you accept that):

```sh
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_RPC_URL=https://...
NEXT_PUBLIC_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
SESSION_SECRET=<random, 32+ chars>       # required in production; openssl rand -hex 32
DATABASE_URL=postgres://freeshop:...@localhost/freeshop_launcher
PONDER_URL=http://127.0.0.1:42069
# NEXT_PUBLIC_TEMPLATE_REPO_URL=...      # optional, once the template repo is published
```

### 4. Build & run

```sh
cd /opt/freeshop/apps/launcher
set -a && . .env.production && set +a && pnpm build   # also rebuilds the storefront zip template
```

Two systemd units (`/etc/systemd/system/freeshop-launcher.service`, `…-indexer.service`),
adjusting the pnpm path to `which pnpm`:

```ini
[Unit]
Description=freeshop launcher            # or: freeshop indexer
After=network-online.target postgresql.service

[Service]
WorkingDirectory=/opt/freeshop/apps/launcher   # or: apps/indexer
EnvironmentFile=/opt/freeshop/apps/launcher/.env.production   # or: apps/indexer/...
ExecStart=/usr/local/bin/pnpm start
Restart=always
User=root                                # or a dedicated user that owns /opt/freeshop

[Install]
WantedBy=multi-user.target
```

```sh
systemctl enable --now freeshop-indexer freeshop-launcher
```

The indexer stays on localhost:42069 — the launcher proxies it at `/api/indexer`, so it is
never exposed. `/etc/caddy/Caddyfile` (Caddy provisions TLS automatically):

```
yourdomain.example {
    reverse_proxy 127.0.0.1:3000
}
```

### 5. Verify

- `https://yourdomain.example/technical` shows the factory address and live launch fee.
- `curl http://127.0.0.1:42069/ready` on the server confirms the indexer is serving (note:
  it can report ready before the backfill completes — trust the dashboard data, not this flag).
- Launch a test shop end-to-end with a Sepolia-funded wallet, place a test order, and check it
  appears under "Needs your attention" on `/stores`.
