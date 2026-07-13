import type { Chain, PublicClient } from "viem";
import { storeEscrowAbi, type StoreConfig } from "@freeshop/shared";
import { byId, hide, setSlot, show, slot } from "./dom";
import { formatAmount, truncateAddress } from "./format";

export const ORDER_STATUS_LABELS = ["NONE", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"] as const;

export const STAMP_CLASS: Record<string, string> = {
  PAID: "stamp--paid",
  FULFILLED: "stamp--fulfilled",
  CANCELLED: "stamp--cancelled",
  REFUNDED: "stamp--refunded",
};

/** Fills the lookup receipt block for a found order. Exported for DOM tests. */
export function showLookupResult(params: {
  orderId: bigint;
  buyer: string;
  amount: bigint;
  status: string;
  config: StoreConfig;
}): void {
  setSlot("lookup-ordernum", `№ ${params.orderId}`);
  setSlot("lookup-buyer", truncateAddress(params.buyer));
  setSlot("lookup-amount", formatAmount(params.amount, params.config.payment.decimals, params.config.payment.symbol));
  const stamp = slot<HTMLElement>("lookup-stamp");
  if (stamp) {
    stamp.textContent = params.status;
    stamp.className = `stamp ${STAMP_CLASS[params.status] ?? "stamp--cancelled"}`;
  }
  hide(byId("lookup-missing"));
  hide(byId("lookup-error"));
  show(byId("lookup-receipt"));
}

export function initStatusLookup(config: StoreConfig, publicClient: PublicClient, _chain: Chain): void {
  const form = byId<HTMLFormElement>("lookup-form");
  const input = byId<HTMLInputElement>("lookup-input");
  if (!form || !input) return;

  async function lookup(orderId: bigint): Promise<void> {
    const button = byId<HTMLButtonElement>("lookup-btn");
    if (button) button.disabled = true;
    try {
      const [buyer, amount, statusCode] = await publicClient.readContract({
        address: config.storeAddress,
        abi: storeEscrowAbi,
        functionName: "orders",
        args: [orderId],
      });
      const status = ORDER_STATUS_LABELS[statusCode] ?? "NONE";
      if (status === "NONE") {
        hide(byId("lookup-receipt"));
        hide(byId("lookup-error"));
        const missing = byId("lookup-missing");
        if (missing) {
          missing.textContent = `No order № ${orderId} exists on this store.`;
          show(missing);
        }
      } else {
        showLookupResult({ orderId, buyer, amount, status, config });
      }
    } catch {
      hide(byId("lookup-receipt"));
      hide(byId("lookup-missing"));
      show(byId("lookup-error"));
    } finally {
      if (button) button.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = input.value.trim();
    if (!/^\d+$/.test(raw)) return;
    history.replaceState(null, "", `?order=${raw}`);
    void lookup(BigInt(raw));
  });

  // Deep link: ?order=N
  const param = new URLSearchParams(location.search).get("order");
  if (param && /^\d+$/.test(param)) {
    input.value = param;
    void lookup(BigInt(param));
  }
}
