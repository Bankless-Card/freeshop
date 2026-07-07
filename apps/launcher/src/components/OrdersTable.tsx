"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, type Hex } from "viem";
import { usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import {
  KEY_DERIVATION_MESSAGE,
  decryptFulfillment,
  deriveMerchantKeyPair,
  storeEscrowAbi,
} from "@freeshop/shared";
import { useStoreOrders, type IndexedOrder } from "@/lib/useIndexer";
import { truncate } from "@/lib/format";

const STATUS_CODE = { FULFILLED: 2, CANCELLED: 3 } as const;

interface OrdersTableProps {
  store: Hex;
  symbol: string;
  decimals: number;
  isOwner: boolean;
}

export function OrdersTable({ store, symbol, decimals, isOwner }: OrdersTableProps) {
  const queryClient = useQueryClient();
  const { signMessageAsync, isPending: isUnlocking } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const orders = useStoreOrders(store);
  // Decryption key lives in component state only — it never leaves the browser.
  const [secretKey, setSecretKey] = useState<Uint8Array>();
  const [actionBusy, setActionBusy] = useState<string>();
  const [error, setError] = useState<string>();

  async function unlock() {
    setError(undefined);
    try {
      const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE });
      setSecretKey(deriveMerchantKeyPair(signature).secretKey);
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
  }

  async function act(order: IndexedOrder, action: "FULFILLED" | "CANCELLED" | "REFUND") {
    setActionBusy(`${order.orderId}-${action}`);
    setError(undefined);
    try {
      const hash = await writeContractAsync(
        action === "REFUND"
          ? { address: store, abi: storeEscrowAbi, functionName: "refund", args: [BigInt(order.orderId)] }
          : {
              address: store,
              abi: storeEscrowAbi,
              functionName: "setStatus",
              args: [BigInt(order.orderId), STATUS_CODE[action]],
            },
      );
      await publicClient?.waitForTransactionReceipt({ hash, timeout: 120_000 });
      // Give the indexer a beat to pick up the block, then refresh everything derived from it.
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["indexer"] }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0] : String(err));
    } finally {
      setActionBusy(undefined);
    }
  }

  function details(order: IndexedOrder) {
    if (!secretKey) return <span className="ink-soft">🔒 locked</span>;
    try {
      const fields = decryptFulfillment(order.encryptedFulfillment, secretKey);
      return (
        <dl className="order-details">
          {Object.entries(fields).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      );
    } catch {
      return <span className="ink-soft">⚠ cannot decrypt (different key?)</span>;
    }
  }

  if (orders.isError) {
    return <div className="error-box">Orders unavailable — is the indexer running? ({orders.error.message})</div>;
  }
  if (orders.isPending) return <p className="mono" style={{ fontSize: 13 }}>Reading indexer…</p>;
  if (orders.data.orders.length === 0) return <p className="mono" style={{ fontSize: 13 }}>No orders yet.</p>;

  return (
    <>
      {!secretKey && (
        <div className="note" style={{ alignItems: "center" }}>
          <span>🔒</span>
          <span style={{ flex: 1 }}>
            Order details are encrypted. Sign the key message to decrypt them here, in your
            browser — plaintext never touches any server.
          </span>
          <button type="button" className="btn" disabled={isUnlocking || !isOwner} onClick={unlock}>
            {isUnlocking ? "Check wallet…" : "Unlock"}
          </button>
        </div>
      )}

      <div className="orders">
        {orders.data.orders.map((order) => (
          <div className="order-row" key={order.orderId}>
            <div className="order-row__head">
              <span className="mono">№ {order.orderId}</span>
              <span className={`badge badge--${order.status.toLowerCase()}`}>{order.status}</span>
              <span className="mono">{formatUnits(BigInt(order.amount), decimals)} {symbol}</span>
              <span className="mono" title={order.buyer}>
                {truncate(order.buyer)}
              </span>
              <span className="mono ink-soft">{new Date(order.paidAt * 1000).toLocaleString()}</span>
            </div>
            <div className="order-row__body">{details(order)}</div>
            {isOwner && (
              <div className="order-row__actions">
                {order.status === "PAID" && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!actionBusy}
                      onClick={() => act(order, "FULFILLED")}
                    >
                      {actionBusy === `${order.orderId}-FULFILLED` ? "…" : "Mark fulfilled"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={!!actionBusy}
                      onClick={() => act(order, "CANCELLED")}
                    >
                      {actionBusy === `${order.orderId}-CANCELLED` ? "…" : "Cancel"}
                    </button>
                  </>
                )}
                {order.status !== "REFUNDED" && (
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={!!actionBusy}
                    onClick={() => act(order, "REFUND")}
                  >
                    {actionBusy === `${order.orderId}-REFUND` ? "…" : "Refund"}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <div className="error-box">{error}</div>}
    </>
  );
}
