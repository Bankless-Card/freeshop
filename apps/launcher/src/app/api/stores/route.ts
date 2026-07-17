import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { storeConfigs } from "@/db/schema";
import { sessionAddress } from "@/lib/session";

/**
 * Product names for the signed-in merchant's shops, keyed by (lowercased) store address.
 * Names live only in the saved configs — never on-chain — so the shop list fetches them
 * here in one query instead of hitting the per-store config route N times.
 */
export async function GET() {
  const session = await sessionAddress();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const db = await getDb();
  const rows = await db.select().from(storeConfigs).where(eq(storeConfigs.merchantAddress, session));
  const names: Record<string, string | null> = {};
  for (const row of rows) {
    try {
      names[row.storeAddress] = (JSON.parse(row.config) as { product?: { name?: string } }).product?.name ?? null;
    } catch {
      names[row.storeAddress] = null;
    }
  }
  return NextResponse.json({ names });
}
