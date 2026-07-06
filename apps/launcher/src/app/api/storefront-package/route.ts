import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import { NextResponse, type NextRequest } from "next/server";
import { parseStoreConfig } from "@freeshop/shared";
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
  const zipped = zipSync(files, { level: 6 });

  return new NextResponse(Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="storefront.zip"',
    },
  });
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
