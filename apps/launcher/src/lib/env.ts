/**
 * Environment configuration. The Launcher has a real backend (unlike the Storefront), so
 * server-only secrets are allowed here — but never in NEXT_PUBLIC_* values.
 */

export const publicEnv = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || undefined,
  factoryAddress: (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "") as `0x${string}`,
  usdcAddress: (process.env.NEXT_PUBLIC_USDC_ADDRESS || undefined) as `0x${string}` | undefined,
  /** Public template repo merchants can "use this template" from (set once it exists). */
  templateRepoUrl: process.env.NEXT_PUBLIC_TEMPLATE_REPO_URL || undefined,
};

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (>= 32 chars) is required in production");
  }
  // Stable dev-only fallback so local sessions survive restarts.
  return "freeshop-dev-session-secret-not-for-production";
}

export const databaseUrl = process.env.DATABASE_URL || undefined;
