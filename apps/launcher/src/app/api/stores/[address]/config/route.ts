import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { parseStoreConfig, storeEscrowAbi } from "@freeshop/shared";
import { getDb } from "@/db";
import { storeConfigs } from "@/db/schema";
import { serverPublicClient } from "@/lib/chains";
import { sessionAddress } from "@/lib/session";

type Params = { params: Promise<{ address: string }> };

/**
 * Ownership is decided by the chain, not the database: the caller must be the store's
 * immutable on-chain `merchant`. This keeps the saved config readable after account
 * deletion/re-creation and impossible to claim by anyone else.
 */
async function authorize(rawAddress: string): Promise<{ store: `0x${string}` } | NextResponse> {
  const session = await sessionAddress();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isAddress(rawAddress)) return NextResponse.json({ error: "bad store address" }, { status: 400 });
  const store = rawAddress.toLowerCase() as `0x${string}`;

  let merchant: string;
  try {
    merchant = await serverPublicClient().readContract({
      address: store,
      abi: storeEscrowAbi,
      functionName: "merchant",
    });
  } catch {
    return NextResponse.json({ error: "no store contract at this address" }, { status: 404 });
  }
  if (merchant.toLowerCase() !== session) {
    return NextResponse.json({ error: "you are not this store's merchant" }, { status: 403 });
  }
  return { store };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await authorize((await params).address);
  if (auth instanceof NextResponse) return auth;

  const db = await getDb();
  const [row] = await db.select().from(storeConfigs).where(eq(storeConfigs.storeAddress, auth.store));
  if (!row) return NextResponse.json({ error: "no saved config for this store" }, { status: 404 });
  return NextResponse.json({ config: JSON.parse(row.config), updatedAt: row.updatedAt });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await authorize((await params).address);
  if (auth instanceof NextResponse) return auth;

  let config;
  try {
    config = parseStoreConfig(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "bad config" }, { status: 400 });
  }
  if (config.storeAddress.toLowerCase() !== auth.store) {
    return NextResponse.json({ error: "config.storeAddress does not match the URL" }, { status: 400 });
  }

  const session = (await sessionAddress())!;
  const db = await getDb();
  const serialized = JSON.stringify(config);
  await db
    .insert(storeConfigs)
    .values({ storeAddress: auth.store, merchantAddress: session, config: serialized })
    .onConflictDoUpdate({
      target: storeConfigs.storeAddress,
      set: { config: serialized, merchantAddress: session, updatedAt: new Date() },
    });
  return NextResponse.json({ ok: true });
}
