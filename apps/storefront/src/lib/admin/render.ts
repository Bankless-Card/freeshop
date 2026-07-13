import type { Hex } from "viem";
import type { StoreConfig } from "@freeshop/shared";
import { byId, cloneTemplate, setSlot, slot } from "../dom";
import { formatAmount, truncateAddress } from "../format";
import { STAMP_CLASS } from "../status";
import type { AdminOrder, Rollup } from "./analytics";

/**
 * DOM rendering for admin.html. Wallet-free by design (the decrypt function is injected)
 * so everything here runs under happy-dom in tests. All helpers are null-tolerant: the
 * merchant may delete any section and the rest keeps working.
 */

export type GateState = "connect" | "wrong-chain" | "wrong-wallet" | "open";

export function renderGate(state: GateState, info?: { connected?: string; merchant?: string }): void {
  const blocks: Array<[string, GateState]> = [
    ["gate-connect", "connect"],
    ["gate-wrong-chain", "wrong-chain"],
    ["gate-wrong-wallet", "wrong-wallet"],
  ];
  for (const [id, blockState] of blocks) {
    const el = byId(id);
    if (el) el.hidden = state !== blockState;
  }
  const gate = byId("gate");
  if (gate) gate.hidden = state === "open";
  const panel = byId("panel");
  if (panel) panel.hidden = state !== "open";
  if (info?.connected) setSlot("gate-connected", info.connected);
  if (info?.merchant) setSlot("gate-merchant", info.merchant);
}

export function renderAnalytics(rollup: Rollup, config: StoreConfig): void {
  const { decimals, symbol } = config.payment;
  setSlot("stat-sales", String(rollup.sales));
  setSlot("stat-buyers", String(rollup.uniqueBuyers));
  setSlot("stat-unfulfilled", String(rollup.unfulfilled));
  setSlot("stat-refunds", String(rollup.refunds));
  setSlot("stat-gross", formatAmount(rollup.gross, decimals, symbol));
  setSlot("stat-refunded", formatAmount(rollup.refunded, decimals, symbol));
}

export type OrderAction = "fulfill" | "cancel" | "refund";

export interface OrdersRenderContext {
  config: StoreConfig;
  /** Absent while locked; renderOrders shows 🔒 rows until it exists. Must throw on bad key. */
  decrypt?: (payload: Hex) => Record<string, string>;
  /** True when the OrderPlaced log scan failed — details cells say so instead of 🔒. */
  logsUnavailable: boolean;
  onAction: (orderId: bigint, action: OrderAction) => void;
  /** How many rows (newest first) to render; the rest sit behind "Show older". */
  shown: number;
}

function detailsCell(container: HTMLElement, order: AdminOrder, ctx: OrdersRenderContext): void {
  container.textContent = "";
  if (!order.encryptedFulfillment) {
    container.textContent = ctx.logsUnavailable
      ? "details unavailable — order events could not be scanned"
      : "details unavailable for this order";
    container.classList.add("order-row__details--muted");
    return;
  }
  if (!ctx.decrypt) {
    container.textContent = "🔒 locked — sign above to read buyer details";
    container.classList.add("order-row__details--muted");
    return;
  }
  try {
    const fields = ctx.decrypt(order.encryptedFulfillment);
    const list = document.createElement("dl");
    for (const [label, value] of Object.entries(fields)) {
      const row = cloneTemplate("tpl-detail-row");
      if (!row) return;
      const labelEl = slot(("detail-label"), row);
      const valueEl = slot(("detail-value"), row);
      if (labelEl) labelEl.textContent = label;
      if (valueEl) valueEl.textContent = value;
      list.appendChild(row);
    }
    container.classList.remove("order-row__details--muted");
    container.appendChild(list);
  } catch {
    container.textContent = "cannot decrypt — was the key created with a different wallet?";
    container.classList.add("order-row__details--muted");
  }
}

function formatDate(paidAt: number | undefined): string {
  if (paidAt === undefined) return "";
  return new Date(paidAt * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function renderOrders(orders: AdminOrder[], ctx: OrdersRenderContext): void {
  const list = byId("orders-list");
  if (!list) return;
  list.textContent = "";

  const empty = byId("orders-empty");
  if (empty) empty.hidden = orders.length > 0;
  const older = byId<HTMLButtonElement>("show-older-btn");
  if (older) older.hidden = orders.length <= ctx.shown;

  for (const order of orders.slice(0, ctx.shown)) {
    const fragment = cloneTemplate("tpl-order-row");
    if (!fragment) return;

    setSlot("order-num", `№ ${order.orderId}`, fragment);
    setSlot("order-date", formatDate(order.paidAt), fragment);
    setSlot("order-buyer", truncateAddress(order.buyer), fragment);
    setSlot("order-amount", formatAmount(order.amount, ctx.config.payment.decimals, ctx.config.payment.symbol), fragment);
    const buyer = slot(("order-buyer"), fragment);
    if (buyer) buyer.title = order.buyer;
    const stamp = slot(("order-stamp"), fragment);
    if (stamp) {
      stamp.textContent = order.status;
      stamp.className = `stamp ${STAMP_CLASS[order.status] ?? "stamp--cancelled"}`;
    }

    const details = slot<HTMLElement>("order-details", fragment);
    if (details) detailsCell(details, order, ctx);

    const buttons: Array<[string, OrderAction, boolean]> = [
      ["btn-fulfill", "fulfill", order.status === "PAID"],
      ["btn-cancel", "cancel", order.status === "PAID"],
      ["btn-refund", "refund", order.status !== "REFUNDED"],
    ];
    for (const [name, action, visible] of buttons) {
      const button = slot<HTMLButtonElement>(name, fragment);
      if (!button) continue;
      button.hidden = !visible;
      if (visible) button.addEventListener("click", () => ctx.onAction(order.orderId, action));
    }

    list.appendChild(fragment);
  }
}

/** Disables/enables every action button in the orders list while a transaction is in flight. */
export function setOrdersBusy(busy: boolean): void {
  const list = byId("orders-list");
  if (!list) return;
  for (const button of list.querySelectorAll("button")) button.disabled = busy;
}
