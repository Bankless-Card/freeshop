import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS merchants (
    address    text PRIMARY KEY,
    email      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

// Singleton across HMR / route invocations.
const globalStore = globalThis as unknown as { __freeshopDb?: Promise<Db> };

async function createDb(): Promise<Db> {
  if (databaseUrl) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(BOOTSTRAP_SQL);
    return drizzle(pool, { schema });
  }
  // Zero-infra dev default: embedded Postgres (PGlite) persisted under .data/.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data/pglite", { recursive: true });
  const { drizzle } = await import("drizzle-orm/pglite");
  const db = drizzle(".data/pglite", { schema });
  await db.$client.exec(BOOTSTRAP_SQL);
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  globalStore.__freeshopDb ??= createDb();
  return globalStore.__freeshopDb;
}
