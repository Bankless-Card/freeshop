import type { Hex, PublicClient } from "viem";
import { storeEscrowAbi, type StoreConfig } from "@freeshop/shared";
import { ORDER_STATUS_LABELS } from "../status";
import type { AdminOrder } from "./analytics";

/**
 * Data layer for admin.html. Contract reads are the source of truth (buyer/amount/status);
 * one OrderPlaced event scan merely decorates orders with the encrypted blob and a date.
 * If the scan fails the page still works — details/dates just show as unavailable.
 */

/** Above this, only the newest orders are read and analytics cover just those. */
export const MAX_ORDERS = 1000n;
const READ_CHUNK = 25;
/** Window size for the retry scan when a full-range getLogs is rejected by the RPC. */
const LOG_WINDOW = 50_000n;

export interface AdminOrdersResult {
  orders: AdminOrder[]; // newest first
  /** True when orderCount exceeded MAX_ORDERS and older orders were skipped. */
  scanIncomplete: boolean;
  /** True when the OrderPlaced log scan failed — no blobs or dates available. */
  logsUnavailable: boolean;
}

async function inChunks<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += READ_CHUNK) {
    results.push(...(await Promise.all(items.slice(i, i + READ_CHUNK).map(run))));
  }
  return results;
}

type OrderPlacedLog = {
  args: { orderId?: bigint; encryptedFulfillment?: Hex };
  blockNumber: bigint | null;
};

async function scanOrderPlaced(publicClient: PublicClient, config: StoreConfig): Promise<OrderPlacedLog[]> {
  const base = {
    address: config.storeAddress,
    abi: storeEscrowAbi,
    eventName: "OrderPlaced",
  } as const;
  const fromBlock = config.deployBlock !== undefined ? BigInt(config.deployBlock) : 0n;
  try {
    return await publicClient.getContractEvents({ ...base, fromBlock, toBlock: "latest" });
  } catch (error) {
    // Public RPCs often reject wide getLogs ranges. With a known deploy block we can walk
    // fixed windows; without one there is no sane bound, so give up and degrade.
    if (config.deployBlock === undefined) throw error;
    const latest = await publicClient.getBlockNumber();
    const logs: OrderPlacedLog[] = [];
    for (let start = fromBlock; start <= latest; start += LOG_WINDOW) {
      const end = start + LOG_WINDOW - 1n > latest ? latest : start + LOG_WINDOW - 1n;
      logs.push(...(await publicClient.getContractEvents({ ...base, fromBlock: start, toBlock: end })));
    }
    return logs;
  }
}

export async function fetchAdminOrders(
  publicClient: PublicClient,
  config: StoreConfig,
): Promise<AdminOrdersResult> {
  const contract = { address: config.storeAddress, abi: storeEscrowAbi } as const;
  const orderCount = await publicClient.readContract({ ...contract, functionName: "orderCount" });

  const scanIncomplete = orderCount > MAX_ORDERS;
  const firstId = scanIncomplete ? orderCount - MAX_ORDERS + 1n : 1n;
  const ids: bigint[] = [];
  for (let id = orderCount; id >= firstId; id--) ids.push(id); // newest first

  const orders: AdminOrder[] = await inChunks(ids, async (orderId) => {
    const [buyer, amount, statusCode] = await publicClient.readContract({
      ...contract,
      functionName: "orders",
      args: [orderId],
    });
    const status = ORDER_STATUS_LABELS[statusCode] ?? "NONE";
    return { orderId, buyer, amount, status: status as AdminOrder["status"] };
  });

  let logsUnavailable = false;
  try {
    const logs = await scanOrderPlaced(publicClient, config);
    const byId = new Map(orders.map((o) => [o.orderId, o]));
    const blockOf = new Map<bigint, bigint>();
    for (const log of logs) {
      const order = log.args.orderId !== undefined ? byId.get(log.args.orderId) : undefined;
      if (!order) continue;
      order.encryptedFulfillment = log.args.encryptedFulfillment;
      if (log.blockNumber !== null) blockOf.set(order.orderId, log.blockNumber);
    }
    // Dates: one getBlock per unique block (batched by the transport); best-effort.
    const uniqueBlocks = [...new Set(blockOf.values())];
    try {
      const stamps = await inChunks(uniqueBlocks, async (blockNumber) => {
        const block = await publicClient.getBlock({ blockNumber });
        return [blockNumber, Number(block.timestamp)] as const;
      });
      const timeOf = new Map(stamps);
      for (const order of orders) {
        const blockNumber = blockOf.get(order.orderId);
        if (blockNumber !== undefined) order.paidAt = timeOf.get(blockNumber);
      }
    } catch {
      /* dates are decoration; rows render without them */
    }
  } catch {
    logsUnavailable = true;
  }

  return { orders, scanIncomplete, logsUnavailable };
}
