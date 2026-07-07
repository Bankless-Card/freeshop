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
  CREATE TABLE IF NOT EXISTS store_configs (
    store_address    text PRIMARY KEY,
    merchant_address text NOT NULL,
    config           text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
  );
`;

// Singleton across HMR / route invocations. The applied bootstrap SQL is tracked alongside the
// connection: in dev, HMR swaps this module's code while globalThis (and the connection) live
// on, so a bootstrap that only runs at connection time would silently skip tables added later.
interface DbEntry {
  db: Promise<Db>;
  appliedSql?: string;
}

const globalStore = globalThis as unknown as { __freeshopDb?: DbEntry };

async function createDb(): Promise<Db> {
  if (databaseUrl) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
  }
  // Zero-infra dev default: embedded Postgres (PGlite) persisted under .data/.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data/pglite", { recursive: true });
  const { drizzle } = await import("drizzle-orm/pglite");
  return drizzle(".data/pglite", { schema }) as unknown as Db;
}

async function applyBootstrap(db: Db): Promise<void> {
  // Both drivers expose their client on $client: PGlite has exec(), node-postgres Pool has query().
  const client = (db as unknown as {
    $client: { exec?: (sql: string) => Promise<unknown>; query?: (sql: string) => Promise<unknown> };
  }).$client;
  if (client.exec) await client.exec(BOOTSTRAP_SQL);
  else await client.query!(BOOTSTRAP_SQL);
}

export async function getDb(): Promise<Db> {
  let entry = globalStore.__freeshopDb;
  if (!entry || !("db" in entry)) {
    entry = { db: createDb() };
    globalStore.__freeshopDb = entry;
  }
  const db = await entry.db;
  if (entry.appliedSql !== BOOTSTRAP_SQL) {
    await applyBootstrap(db); // idempotent (IF NOT EXISTS), so a concurrent double-run is fine
    entry.appliedSql = BOOTSTRAP_SQL;
  }
  return db;
}
