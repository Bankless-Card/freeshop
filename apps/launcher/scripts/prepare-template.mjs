// Copies the built storefront (apps/storefront/dist) into template-dist/ so the
// /api/storefront-package route can serve configured zips. Run after building the storefront:
//   pnpm --filter @freeshop/storefront build && pnpm --filter @freeshop/launcher prepare-template
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const launcherDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(launcherDir, "..", "storefront", "dist");
const targetDir = join(launcherDir, "template-dist");

if (!existsSync(join(distDir, "index.html"))) {
  console.error("apps/storefront/dist not found — run `pnpm --filter @freeshop/storefront build` first");
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
cpSync(distDir, targetDir, { recursive: true });
console.log(`copied storefront build to ${targetDir}`);
