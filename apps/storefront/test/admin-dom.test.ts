/**
 * DOM tests against the real admin.html: gate states, analytics slots, order rows in every
 * details state (locked / decrypted / wrong key / unavailable), and the null-tolerance rule.
 * Decryption uses the real shared crypto round-trip — no wallet or RPC involved.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptFulfillment,
  deriveMerchantKeyPair,
  encryptFulfillment,
  type StoreConfig,
} from "@freeshop/shared";
import type { AdminOrder } from "../src/lib/admin/analytics";
import { computeRollup } from "../src/lib/admin/analytics";
import { renderAnalytics, renderGate, renderOrders, type OrdersRenderContext } from "../src/lib/admin/render";

const html = readFileSync(join(process.cwd(), "admin.html"), "utf8");
const bodyHtml = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

const CONFIG: StoreConfig = {
  version: 1,
  chainId: 31337,
  storeAddress: "0x1111111111111111111111111111111111111111",
  deployBlock: 1,
  product: { name: "Test Notebook", description: "A very testable notebook.", images: [] },
  payment: {
    token: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    decimals: 18,
    price: "50000000000000000",
  },
  fulfillment: { fields: [{ name: "email", label: "Email", type: "email", required: true }] },
};

// A real merchant keypair (any 65-byte hex works as the seed signature).
const keys = deriveMerchantKeyPair(`0x${"11".repeat(65)}`);
const BLOB = encryptFulfillment({ email: "buyer@example.com", note: "gift wrap" }, keys.publicKey);

const order = (overrides: Partial<AdminOrder>): AdminOrder => ({
  orderId: 1n,
  buyer: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  amount: 50000000000000000n,
  status: "PAID",
  encryptedFulfillment: BLOB,
  paidAt: 1_760_000_000,
  ...overrides,
});

const ctx = (overrides: Partial<OrdersRenderContext> = {}): OrdersRenderContext => ({
  config: CONFIG,
  decrypt: undefined,
  logsUnavailable: false,
  onAction: () => {},
  shown: 200,
  ...overrides,
});

beforeEach(() => {
  document.body.innerHTML = bodyHtml;
});

describe("renderGate", () => {
  it("shows exactly one gate state and hides the panel", () => {
    for (const state of ["connect", "wrong-chain", "wrong-wallet"] as const) {
      renderGate(state, { connected: "0xabc", merchant: "0xdef" });
      const visible = ["gate-connect", "gate-wrong-chain", "gate-wrong-wallet"].filter(
        (id) => document.getElementById(id)?.hidden === false,
      );
      expect(visible).toEqual([`gate-${state === "connect" ? "connect" : state}`]);
      expect(document.getElementById("panel")?.hidden).toBe(true);
    }
  });

  it("opens the panel and hides the gate", () => {
    renderGate("open");
    expect(document.getElementById("panel")?.hidden).toBe(false);
    expect(document.getElementById("gate")?.hidden).toBe(true);
  });
});

describe("renderAnalytics", () => {
  it("fills every stat slot", () => {
    const rollup = computeRollup([
      order({ orderId: 1n, status: "PAID" }),
      order({ orderId: 2n, status: "REFUNDED" }),
    ]);
    renderAnalytics(rollup, CONFIG);
    const text = (name: string) => document.querySelector(`[data-slot="${name}"]`)?.textContent;
    expect(text("stat-sales")).toBe("2");
    expect(text("stat-buyers")).toBe("1");
    expect(text("stat-unfulfilled")).toBe("1");
    expect(text("stat-refunds")).toBe("1");
    expect(text("stat-gross")).toBe("0.1 ETH");
    expect(text("stat-refunded")).toBe("0.05 ETH");
  });
});

describe("renderOrders", () => {
  it("renders rows with stamp and per-status action buttons", () => {
    renderOrders(
      [order({ orderId: 2n, status: "PAID" }), order({ orderId: 1n, status: "REFUNDED" })],
      ctx(),
    );
    const rows = document.querySelectorAll(".order-row");
    expect(rows).toHaveLength(2);

    const paid = rows[0];
    expect(paid.querySelector('[data-slot="order-num"]')?.textContent).toBe("№ 2");
    expect(paid.querySelector('[data-slot="order-stamp"]')?.className).toContain("stamp--paid");
    expect(paid.querySelector<HTMLElement>('[data-slot="btn-fulfill"]')?.hidden).toBe(false);
    expect(paid.querySelector<HTMLElement>('[data-slot="btn-cancel"]')?.hidden).toBe(false);
    expect(paid.querySelector<HTMLElement>('[data-slot="btn-refund"]')?.hidden).toBe(false);

    const refunded = rows[1];
    expect(refunded.querySelector<HTMLElement>('[data-slot="btn-fulfill"]')?.hidden).toBe(true);
    expect(refunded.querySelector<HTMLElement>('[data-slot="btn-cancel"]')?.hidden).toBe(true);
    expect(refunded.querySelector<HTMLElement>('[data-slot="btn-refund"]')?.hidden).toBe(true);

    expect(document.getElementById("orders-empty")?.hidden).toBe(true);
  });

  it("routes button clicks to onAction with the order id", () => {
    const onAction = vi.fn();
    renderOrders([order({ orderId: 7n, status: "PAID" })], ctx({ onAction }));
    document.querySelector<HTMLButtonElement>('[data-slot="btn-fulfill"]')?.click();
    expect(onAction).toHaveBeenCalledWith(7n, "fulfill");
  });

  it("shows locked details before unlock and decrypts after", () => {
    renderOrders([order({})], ctx());
    expect(document.querySelector('[data-slot="order-details"]')?.textContent).toContain("locked");

    renderOrders([order({})], ctx({ decrypt: (payload) => decryptFulfillment(payload, keys.secretKey) }));
    const details = document.querySelector('[data-slot="order-details"]');
    expect(details?.textContent).toContain("buyer@example.com");
    expect(details?.textContent).toContain("gift wrap");
  });

  it("degrades to 'cannot decrypt' with the wrong key", () => {
    const wrongKeys = deriveMerchantKeyPair(`0x${"22".repeat(65)}`);
    renderOrders(
      [order({})],
      ctx({ decrypt: (payload) => decryptFulfillment(payload, wrongKeys.secretKey) }),
    );
    expect(document.querySelector('[data-slot="order-details"]')?.textContent).toContain("cannot decrypt");
  });

  it("marks details unavailable when the log scan failed", () => {
    renderOrders([order({ encryptedFulfillment: undefined })], ctx({ logsUnavailable: true }));
    expect(document.querySelector('[data-slot="order-details"]')?.textContent).toContain(
      "could not be scanned",
    );
  });

  it("paginates behind the show-older button", () => {
    const many = Array.from({ length: 5 }, (_, i) => order({ orderId: BigInt(5 - i) }));
    renderOrders(many, ctx({ shown: 2 }));
    expect(document.querySelectorAll(".order-row")).toHaveLength(2);
    expect(document.getElementById("show-older-btn")?.hidden).toBe(false);
  });

  it("shows the empty state for a store with no orders", () => {
    renderOrders([], ctx());
    expect(document.getElementById("orders-empty")?.hidden).toBe(false);
  });
});

describe("null tolerance (merchant deletes sections)", () => {
  it("survives with the orders section removed", () => {
    document.getElementById("orders")?.remove();
    expect(() => {
      renderGate("open");
      renderOrders([order({})], ctx());
      renderAnalytics(computeRollup([order({})]), CONFIG);
    }).not.toThrow();
  });

  it("survives with the analytics and withdraw sections removed", () => {
    document.getElementById("analytics")?.remove();
    document.getElementById("withdraw")?.remove();
    expect(() => {
      renderGate("open");
      renderAnalytics(computeRollup([]), CONFIG);
      renderOrders([order({})], ctx());
    }).not.toThrow();
  });

  it("survives with every id and slot stripped", () => {
    document.body.innerHTML = "<main><p>my totally custom page</p></main>";
    expect(() => {
      renderGate("connect");
      renderAnalytics(computeRollup([]), CONFIG);
      renderOrders([order({})], ctx());
    }).not.toThrow();
  });
});
