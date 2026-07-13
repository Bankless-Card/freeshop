/**
 * Produces the standalone public storefront template repo in build/storefront-template/:
 * the storefront app with @freeshop/shared vendored in (file: dependency, so no import
 * rewrites), installable and buildable with plain `pnpm install && pnpm build` outside the
 * monorepo.
 *
 * Release steps after running this (owner):
 *   1. Create a public GitHub repo, push the directory's contents, enable "Template repository".
 *   2. Settings → Pages → Source: GitHub Actions (the deploy workflow ships inside).
 *   3. Set NEXT_PUBLIC_TEMPLATE_REPO_URL on the launcher.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storefront = join(root, "apps", "storefront");
const shared = join(root, "packages", "shared");
const out = join(root, "build", "storefront-template");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ——— storefront app files ———
for (const entry of ["src", "public", "test", "index.html", "admin.html", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "README.md", ".github"]) {
  cpSync(join(storefront, entry), join(out, entry), { recursive: true });
}

// ——— vendored shared package (runtime pieces only) ———
const vendor = join(out, "vendor", "shared");
mkdirSync(vendor, { recursive: true });
for (const entry of ["src", "abis", "store-config.schema.json"]) {
  cpSync(join(shared, entry), join(vendor, entry), { recursive: true });
}
const sharedPkg = JSON.parse(readFileSync(join(shared, "package.json"), "utf8"));
writeFileSync(
  join(vendor, "package.json"),
  JSON.stringify(
    {
      name: "@freeshop/shared",
      version: sharedPkg.version,
      private: true,
      type: "module",
      exports: sharedPkg.exports,
      dependencies: sharedPkg.dependencies,
    },
    null,
    2,
  ) + "\n",
);

// ——— standalone package.json (workspace dep → vendored file dep) ———
const appPkg = JSON.parse(readFileSync(join(storefront, "package.json"), "utf8"));
appPkg.name = "freeshop-storefront";
appPkg.version = "1.0.0";
appPkg.dependencies["@freeshop/shared"] = "file:./vendor/shared";
writeFileSync(join(out, "package.json"), JSON.stringify(appPkg, null, 2) + "\n");

writeFileSync(
  join(out, ".gitignore"),
  ["node_modules/", "dist/", ".DS_Store", ""].join("\n"),
);

console.log(`standalone template written to ${out}`);
console.log("verify with: cd build/storefront-template && pnpm install && pnpm build");
