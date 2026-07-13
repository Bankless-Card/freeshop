import type { Hex } from "viem";

/**
 * One order as the admin page sees it: authoritative fields from orders(id) contract reads,
 * plus optional decoration from the OrderPlaced event log (blob + timestamp).
 */
export interface AdminOrder {
  orderId: bigint;
  buyer: Hex;
  amount: bigint;
  status: "PAID" | "FULFILLED" | "CANCELLED" | "REFUNDED";
  /** Ciphertext from the OrderPlaced event; absent when the log scan failed or missed it. */
  encryptedFulfillment?: Hex;
  /** Unix seconds of the order's block; absent when unknown. */
  paidAt?: number;
}

export interface Rollup {
  sales: number;
  uniqueBuyers: number;
  unfulfilled: number;
  refunds: number;
  /** Sum of all order amounts, including later-refunded ones (matches the indexer rollup). */
  gross: bigint;
  refunded: bigint;
}

export function computeRollup(orders: AdminOrder[]): Rollup {
  const buyers = new Set<string>();
  let unfulfilled = 0;
  let refunds = 0;
  let gross = 0n;
  let refunded = 0n;
  for (const order of orders) {
    buyers.add(order.buyer.toLowerCase());
    gross += order.amount;
    if (order.status === "PAID") unfulfilled += 1;
    if (order.status === "REFUNDED") {
      refunds += 1;
      refunded += order.amount;
    }
  }
  return { sales: orders.length, uniqueBuyers: buyers.size, unfulfilled, refunds, gross, refunded };
}
