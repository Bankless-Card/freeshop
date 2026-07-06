import { NextResponse, type NextRequest } from "next/server";
import { parseSiweMessage } from "viem/siwe";
import { serverPublicClient } from "@/lib/chains";
import { getSession } from "@/lib/session";

/**
 * Sign-In with Ethereum: verifies the signed SIWE message against the nonce we issued.
 * The verified wallet address *is* the merchant identity — no passwords anywhere.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  const { message, signature } = (await request.json().catch(() => ({}))) as {
    message?: string;
    signature?: `0x${string}`;
  };
  if (!message || !signature) {
    return NextResponse.json({ error: "message and signature are required" }, { status: 400 });
  }
  if (!session.nonce) {
    return NextResponse.json({ error: "no nonce issued — request one first" }, { status: 422 });
  }

  const client = serverPublicClient();
  // verifySiweMessage also handles smart-contract wallets (ERC-1271/6492), not just EOAs.
  const valid = await client
    .verifySiweMessage({ message, signature, nonce: session.nonce })
    .catch(() => false);
  if (!valid) {
    return NextResponse.json({ error: "invalid SIWE signature" }, { status: 401 });
  }

  const parsed = parseSiweMessage(message);
  if (!parsed.address || parsed.chainId !== client.chain!.id) {
    return NextResponse.json({ error: "wrong chain or malformed message" }, { status: 401 });
  }

  session.nonce = undefined; // single use
  session.address = parsed.address.toLowerCase() as `0x${string}`;
  await session.save();
  return NextResponse.json({ address: session.address });
}
