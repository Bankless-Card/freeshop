import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import { NextResponse, type NextRequest } from "next/server";
import { parseStoreConfig, type StoreConfig } from "@freeshop/shared";
import { publicEnv } from "@/lib/env";
import { sessionAddress } from "@/lib/session";

/**
 * Builds the merchant's downloadable storefront: the prebuilt static template with their
 * store.config.json injected. The result is a ready-to-upload site — no build step needed.
 *
 * The template comes from `template-dist/` (see scripts/prepare-template.mjs), which is a
 * `vite build` of apps/storefront. Config is fetched at runtime by the storefront, so
 * swapping the JSON inside the built output is fully supported.
 */
export async function POST(request: NextRequest) {
  if (!(await sessionAddress())) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let config;
  try {
    config = parseStoreConfig(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "bad config" }, { status: 400 });
  }

  const templateDir = join(process.cwd(), "template-dist");
  let files: Zippable;
  try {
    files = readTree(templateDir);
  } catch {
    return NextResponse.json(
      { error: "storefront template not prepared on this server — run `pnpm prepare-template`" },
      { status: 503 },
    );
  }

  files["store.config.json"] = strToU8(JSON.stringify(config, null, 2) + "\n");
  files["README.txt"] = strToU8(readmeFor(config));
  const zipped = zipSync(files, { level: 6 });

  return new NextResponse(Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="storefront.zip"',
    },
  });
}

function readmeFor(config: StoreConfig): string {
  const templateRepo = publicEnv.templateRepoUrl
    ? `\nWant to change how the app itself behaves? The full source lives at:\n  ${publicEnv.templateRepoUrl}\n("Use this template" on GitHub; it rebuilds and deploys itself via GitHub Actions.)\n`
    : "";
  return `YOUR STOREFRONT — ${config.product.name}
================================================================
Store contract: ${config.storeAddress} (chain id ${config.chainId})

This folder is a complete, ready-to-host website. No build step, no server,
no database. Payments go to your escrow contract, never through anyone else.

PUT IT ONLINE (free)
--------------------
· Cloudflare Pages: dash.cloudflare.com → Workers & Pages → Create → Upload
  assets → drag this folder in. Done.
· GitHub Pages: push this folder to a repo → Settings → Pages.
· Or any static host / web server — upload the folder as-is.

EDIT IT (no tools needed — any text editor)
-------------------------------------------
· index.html        The page structure. Reorder or delete whole <section>s,
                    add your own HTML anywhere. Keep the id="…" and
                    data-slot="…" attributes on elements you keep — that is
                    how the app finds them. <template> tags define repeated
                    bits like form fields.
· styles.css        Every color, font, and spacing value. The design tokens
                    at the top of the file change the whole look.
· store.config.json Product name, description, price display, image list.
· product.svg       Replace with your product photo (update "images" in
                    store.config.json to match the filename).
· assets/app.js     The app's behavior (readable, unminified). You normally
                    won't need to touch it — the page markup lives in
                    index.html, not here.

ONE WARNING
-----------
Do NOT edit the "fulfillment" fields in store.config.json. Your order form
was cryptographically committed on-chain when the store launched; if the
form no longer matches, the storefront warns buyers and disables checkout
on purpose. Product name/description/images are safe to change freely.
${templateRepo}
Live facts (price, payment token, your encryption key) are always read from
the contract itself — a typo here can never redirect anyone's money.
`;
}

function readTree(root: string): Zippable {
  const files: Zippable = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path).split("\\").join("/")] = readFileSync(path);
    }
  };
  walk(root);
  return files;
}
