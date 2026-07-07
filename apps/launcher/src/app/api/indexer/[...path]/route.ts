import { NextResponse, type NextRequest } from "next/server";
import { ponderUrl } from "@/lib/env";
import { sessionAddress } from "@/lib/session";

/**
 * Read-only proxy to the Ponder indexer so the browser stays same-origin. The indexer holds
 * only public chain data (blobs are ciphertext); the sign-in requirement is rate-limiting
 * politeness, not a secrecy boundary.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await sessionAddress())) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const { path } = await params;
  const target = `${ponderUrl}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  try {
    const response = await fetch(target, { cache: "no-store" });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          `indexer unreachable at ${ponderUrl} — start it with ` +
          `\`FACTORY_ADDRESS=<factory> pnpm dev\` in apps/indexer, and check its startup banner: ` +
          `if the port differs (auto-increments when busy), set PONDER_URL in the launcher env`,
      },
      { status: 502 },
    );
  }
}
