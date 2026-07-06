# Launcher

The platform web app: merchants sign in with their wallet, define a product, deploy their own
`StoreEscrow` through the factory (paying the launch fee), and download a ready-to-host
storefront. This is the one component with a backend — but it is never in the path of merchant
funds, refunds, or buyer data.

**What the backend stores:** merchant accounts only (wallet address ↔ required-but-unverified
email). Orders, sales, and fulfillment data live on-chain. Buyer plaintext never exists
server-side anywhere in the system.

## Run

```sh
cp .env.example .env.local   # fill in NEXT_PUBLIC_FACTORY_ADDRESS at minimum
pnpm --filter @freeshop/storefront build && pnpm prepare-template   # for zip downloads
pnpm dev
```

Without `DATABASE_URL` the app uses embedded Postgres (PGlite) under `.data/` — zero infra for
local dev. Set `DATABASE_URL` (and `SESSION_SECRET`, required in production) to use a real
Postgres.

Local end-to-end (anvil):

```sh
anvil                                            # terminal 1
forge script contracts/script/Deploy.s.sol \
  --rpc-url http://localhost:8545 --broadcast \
  --private-key <anvil key>                      # deploy the factory, note its address
NEXT_PUBLIC_FACTORY_ADDRESS=0x… pnpm dev         # terminal 2
```

## Auth

Sign-In with Ethereum (viem/siwe): nonce → wallet signature → session cookie (iron-session).
The wallet address *is* the merchant identity; there are no passwords. Smart-contract wallets
verify via ERC-1271/6492.

## API

| Route | What |
| --- | --- |
| `GET /api/auth/nonce` | issue SIWE nonce |
| `POST /api/auth/verify` | verify SIWE signature, start session |
| `POST /api/auth/logout` | end session |
| `GET · PUT · DELETE /api/me` | merchant account (email) — PUT validates, DELETE erases the stored email |
| `POST /api/storefront-package` | zip of the prebuilt storefront with the posted `store.config.json` injected |

## Tests

```sh
pnpm build && pnpm prepare-template
node scripts/e2e-api.mjs   # spawns anvil + the production server; SIWE, CRUD, zip assertions
```
