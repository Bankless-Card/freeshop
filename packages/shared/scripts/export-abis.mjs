// Copies contract ABIs from the Foundry build output into packages/shared/abis/.
// Run `forge build --root contracts` first (or `pnpm contracts:build` at the repo root).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outDir = join(repoRoot, "contracts", "out");
const abiDir = join(repoRoot, "packages", "shared", "abis");

const contracts = ["StoreEscrow", "StorefrontFactory"];

await mkdir(abiDir, { recursive: true });
for (const name of contracts) {
  const artifact = JSON.parse(await readFile(join(outDir, `${name}.sol`, `${name}.json`), "utf8"));
  await writeFile(join(abiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`exported ${name} (${artifact.abi.length} entries)`);
}
