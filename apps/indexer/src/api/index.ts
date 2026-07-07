import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { and, count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { isAddress } from "viem";

/**
 * Read-only analytics over indexed (public) chain data. No auth: everything here is already
 * public on-chain, and fulfillment blobs are ciphertext only the merchant can open.
 */
const app = new Hono();

const DAY = 86400n;

function lower(address: string): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

/** Rollup used for both the merchant-wide and per-store views. */
async function rollup(where: ReturnType<typeof eq>) {
  const [totals] = await db
    .select({
      sales: count(),
      uniqueBuyers: countDistinct(schema.orders.buyer),
      refunds: sql<number>`count(*) filter (where ${schema.orders.status} = 'REFUNDED')`,
      unfulfilled: sql<number>`count(*) filter (where ${schema.orders.status} = 'PAID')`,
    })
    .from(schema.orders)
    .where(where);

  const revenue = await db
    .select({
      token: schema.orders.token,
      gross: sql<string>`coalesce(sum(${schema.orders.amount}), 0)`,
      refunded: sql<string>`coalesce(sum(${schema.orders.amount}) filter (where ${schema.orders.status} = 'REFUNDED'), 0)`,
    })
    .from(schema.orders)
    .where(where)
    .groupBy(schema.orders.token);

  const cutoff = BigInt(Math.floor(Date.now() / 1000)) - 60n * DAY;
  const salesByDay = await db
    .select({
      day: sql<string>`(${schema.orders.paidAt} / 86400) * 86400`,
      sales: count(),
    })
    .from(schema.orders)
    .where(and(where, gte(schema.orders.paidAt, cutoff)))
    .groupBy(sql`(${schema.orders.paidAt} / 86400) * 86400`)
    .orderBy(sql`(${schema.orders.paidAt} / 86400) * 86400`);

  return {
    sales: totals?.sales ?? 0,
    uniqueBuyers: totals?.uniqueBuyers ?? 0,
    refunds: Number(totals?.refunds ?? 0),
    unfulfilled: Number(totals?.unfulfilled ?? 0),
    revenue: revenue.map((r) => ({ token: r.token, gross: String(r.gross), refunded: String(r.refunded) })),
    salesByDay: salesByDay.map((d) => ({ day: Number(d.day), sales: d.sales })),
  };
}

/**
 * Merchant-wide analytics. Unique buyers are deduped across the merchant's whole store set
 * (COUNT(DISTINCT buyer) over all their orders) — never the sum of per-store uniques, which
 * would double-count a wallet buying at two stores.
 */
app.get("/merchants/:address/analytics", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "bad address" }, 400);
  const merchant = lower(address);

  const storeRows = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.merchant, merchant))
    .orderBy(desc(schema.stores.deployedAt));

  const aggregate = await rollup(eq(schema.orders.merchant, merchant));

  const perStore = await db
    .select({
      store: schema.orders.store,
      sales: count(),
      uniqueBuyers: countDistinct(schema.orders.buyer),
      refunds: sql<number>`count(*) filter (where ${schema.orders.status} = 'REFUNDED')`,
    })
    .from(schema.orders)
    .where(eq(schema.orders.merchant, merchant))
    .groupBy(schema.orders.store);

  return c.json({
    aggregate,
    stores: storeRows.map((s) => {
      const stats = perStore.find((p) => p.store === s.address);
      return {
        address: s.address,
        paymentToken: s.paymentToken,
        price: s.price.toString(),
        deployedAt: Number(s.deployedAt),
        sales: stats?.sales ?? 0,
        uniqueBuyers: stats?.uniqueBuyers ?? 0,
        refunds: Number(stats?.refunds ?? 0),
      };
    }),
  });
});

app.get("/stores/:address/analytics", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "bad address" }, 400);
  return c.json(await rollup(eq(schema.orders.store, lower(address))));
});

app.get("/stores/:address/orders", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "bad address" }, 400);
  const limit = Math.min(Number(c.req.query("limit") ?? 200), 500);

  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.store, lower(address)))
    .orderBy(desc(schema.orders.orderId))
    .limit(limit);

  return c.json({
    orders: rows.map((o) => ({
      orderId: o.orderId.toString(),
      buyer: o.buyer,
      amount: o.amount.toString(),
      token: o.token,
      status: o.status,
      encryptedFulfillment: o.encryptedFulfillment,
      paidAt: Number(o.paidAt),
      updatedAt: Number(o.updatedAt),
      txHash: o.txHash,
    })),
  });
});

export default app;
