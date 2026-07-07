# Indexer

Ponder app that indexes the factory and — via the factory pattern — every `StoreEscrow` it
deploys. Everything here is **derived state rebuildable from chain**; the chain stays the source
of truth for all commerce data. It powers the launcher dashboard through a small read-only API.

## Endpoints

| Route | What |
| --- | --- |
| `GET /merchants/:address/analytics` | aggregate rollup (sales, refunds, revenue per asset, sales-by-day, **unique buyers deduped across the merchant's whole store set**) + per-store stats |
| `GET /stores/:address/analytics` | the same rollup for one store |
| `GET /stores/:address/orders` | orders incl. status and the encrypted fulfillment blob (ciphertext — only the merchant's key opens it) |

No auth: it serves only public chain data. The launcher proxies it at `/api/indexer/*`.

## Run

```sh
cp .env.example .env.local   # set FACTORY_ADDRESS
pnpm dev                     # PGlite under .ponder/, API on :42069
```

Production: `ponder start` with `DATABASE_URL` (Postgres).

## Test

```sh
node scripts/e2e-indexer.mjs   # seeds anvil (2 stores, 4 orders, refund, withdrawal),
                               # runs ponder over it, asserts analytics + blob decryption
```
