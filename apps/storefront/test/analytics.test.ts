import { describe, expect, it } from "vitest";
import { computeRollup, type AdminOrder } from "../src/lib/admin/analytics";

const order = (overrides: Partial<AdminOrder>): AdminOrder => ({
  orderId: 1n,
  buyer: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  amount: 100n,
  status: "PAID",
  ...overrides,
});

describe("computeRollup", () => {
  it("returns zeros for an empty store", () => {
    expect(computeRollup([])).toEqual({
      sales: 0,
      uniqueBuyers: 0,
      unfulfilled: 0,
      refunds: 0,
      gross: 0n,
      refunded: 0n,
    });
  });

  it("counts statuses and sums amounts, gross including refunded orders", () => {
    const rollup = computeRollup([
      order({ orderId: 1n, status: "PAID", amount: 100n }),
      order({ orderId: 2n, status: "FULFILLED", amount: 200n }),
      order({ orderId: 3n, status: "CANCELLED", amount: 300n }),
      order({ orderId: 4n, status: "REFUNDED", amount: 400n }),
      order({ orderId: 5n, status: "REFUNDED", amount: 500n }),
    ]);
    expect(rollup.sales).toBe(5);
    expect(rollup.unfulfilled).toBe(1);
    expect(rollup.refunds).toBe(2);
    expect(rollup.gross).toBe(1500n); // includes the refunded 900
    expect(rollup.refunded).toBe(900n);
  });

  it("dedupes buyers case-insensitively", () => {
    const rollup = computeRollup([
      order({ orderId: 1n, buyer: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
      order({ orderId: 2n, buyer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      order({ orderId: 3n, buyer: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }),
    ]);
    expect(rollup.uniqueBuyers).toBe(2);
  });
});
