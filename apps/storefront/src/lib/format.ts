import { formatUnits } from "viem";

export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAmount(baseUnits: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(baseUnits, decimals)} ${symbol}`;
}

/** Human message for wallet/RPC errors without dumping a full revert trace on the buyer. */
export function shortenError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0];
  return firstLine.length > 220 ? `${firstLine.slice(0, 220)}…` : firstLine;
}
