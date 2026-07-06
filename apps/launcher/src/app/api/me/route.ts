import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { merchants } from "@/db/schema";
import { getSession, sessionAddress } from "@/lib/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who am I + onboarding state. */
export async function GET() {
  const address = await sessionAddress();
  if (!address) return NextResponse.json({ authenticated: false }, { status: 200 });
  const db = await getDb();
  const [row] = await db.select().from(merchants).where(eq(merchants.address, address));
  return NextResponse.json({ authenticated: true, address, email: row?.email ?? null });
}

/** Create/update the merchant account (required email — the only PII the platform stores). */
export async function PUT(request: NextRequest) {
  const address = await sessionAddress();
  if (!address) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  if (!email || !EMAIL_RE.test(email) || email.length > 320) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 400 });
  }

  const db = await getDb();
  await db
    .insert(merchants)
    .values({ address, email })
    .onConflictDoUpdate({ target: merchants.address, set: { email, updatedAt: new Date() } });
  return NextResponse.json({ address, email });
}

/** Delete the merchant account (removes the stored email; stores/orders live on-chain, untouched). */
export async function DELETE() {
  const session = await getSession();
  if (!session.address) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const db = await getDb();
  await db.delete(merchants).where(eq(merchants.address, session.address));
  session.destroy();
  return NextResponse.json({ ok: true });
}
