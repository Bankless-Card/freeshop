# Your storefront

A fully static, self-hosted storefront for one product, paid for in crypto and settled by your
own escrow contract. **No backend, no database, no secrets** — host it anywhere static files
can live, for free. There is no framework: the page is plain HTML, the styling is one plain
CSS file, and a small readable script wires them to the blockchain.

- The page structure lives in `index.html` — real markup you can reorder, edit, or delete.
- The whole visual design lives in `public/styles.css` — design tokens (colors, fonts,
  spacing) at the top of the file.
- Product copy lives in `public/store.config.json`.
- Buyers' order details (email, shipping address, …) are **encrypted in their browser** with
  your public key and ride along inside the payment transaction. Only you can read them, from
  your dashboard. No server is involved, including ours.

## Edit your store

| File | What it is |
| --- | --- |
| `index.html` | Page structure. Reorder/delete whole `<section>`s, add your own HTML. Keep `id`/`data-slot` attributes on elements you keep — that's how the app finds them. `<template>` tags define repeated bits (form fields, progress lines). |
| `public/styles.css` | Every color, font, and spacing value. Edit the `:root` tokens to retheme the whole store. |
| `public/store.config.json` | Product name, description, price display, image list. **Never edit `fulfillment.fields`** — the form is committed on-chain and checkout disables itself on a mismatch, by design. |
| `public/product.svg` | Replace with your product photo (update `product.images` to match). |
| `src/` | The app's behavior (TypeScript + viem, no framework). Wallet, checkout, status lookup, refunds — each module no-ops if you deleted its section. |

Deleting a section removes that feature and nothing else breaks — the code binds to whatever
markup it finds.

## Run locally

```sh
pnpm install
pnpm dev        # local dev server
pnpm test       # DOM tests against index.html's markup contract
pnpm build      # static site in dist/ (unminified on purpose — the output is meant to be readable)
pnpm preview    # serve the built site
```

## Deploy for free

**Cloudflare Pages** — fastest: Workers & Pages → Create → Upload assets → drag the `dist/`
folder in. Or connect the repo with build command `pnpm build`, output `dist`.

**GitHub Pages** — push this repo to GitHub, then Settings → Pages → Source: *GitHub Actions*.
The included workflow (`.github/workflows/deploy-pages.yml`) builds and publishes on push.

Any other static host works the same way: upload `dist/`.

## Trust properties (what buyers can verify)

- The page shows the escrow contract address; buyers can inspect its verified source on a block
  explorer.
- The checkout form is hashed and committed on-chain at deploy; if this site's form ever
  disagrees with that commitment, the storefront warns buyers and disables payment.
- Live facts — price, payment asset, the merchant's encryption key — are read from the
  contract at load; the config file is cosmetic. Payments go to the contract, not to us and
  not to a server.
