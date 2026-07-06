# freeshop — decentralized storefront launcher

Infrastructure that lets a solo merchant sell online for crypto with no backend of their own:

- **`contracts/`** — Foundry project: `StorefrontFactory` (platform-deployed, charges the launch
  fee, registry of merchant stores) and `StoreEscrow` (one per product: payment, on-chain order
  status, encrypted fulfillment blobs emitted in the pay tx, merchant refunds/withdrawals).
- **`apps/storefront/`** *(milestone 2)* — static, self-hostable storefront template (zero backend).
- **`apps/launcher/`** *(milestones 3–4)* — the platform web app: SIWE auth, store deployment,
  storefront package generation, merchant dashboard + indexer.
- **`packages/shared/`** — contract ABIs, config schemas, and crypto helpers shared across apps.

Execution state and per-milestone checklists live in [TASKS.md](TASKS.md).

## Quick start

```sh
pnpm contracts:build
pnpm contracts:test
```

See [contracts/README.md](contracts/README.md) for deploy/smoke-test instructions.
