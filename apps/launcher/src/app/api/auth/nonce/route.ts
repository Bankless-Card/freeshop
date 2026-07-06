import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  session.nonce = generateSiweNonce();
  await session.save();
  return NextResponse.json({ nonce: session.nonce });
}
