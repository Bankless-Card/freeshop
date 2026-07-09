/**
 * DOM tests against the real index.html: the markup contract (ids, data-slots, templates)
 * that merchants may edit, and the null-tolerance rule that deleting a section must not
 * break the rest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { StoreConfig } from "@freeshop/shared";
import { buildOrderForm, collectOrderForm } from "../src/lib/checkout";
import { renderStatic } from "../src/lib/render";
import { showLookupResult } from "../src/lib/status";

// vitest cwd is the package root; import.meta.url is rewritten under happy-dom.
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const bodyHtml = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

const CONFIG: StoreConfig = {
  version: 1,
  chainId: 31337,
  storeAddress: "0x1111111111111111111111111111111111111111",
  product: { name: "Test Notebook", description: "A very testable notebook.", images: ["./product.svg"] },
  payment: {
    token: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    decimals: 18,
    price: "50000000000000000",
  },
  fulfillment: {
    fields: [
      { name: "email", label: "Email", type: "email", required: true, placeholder: "you@example.com" },
      { name: "note", label: "Note", type: "textarea", required: false },
    ],
  },
};

beforeEach(() => {
  document.body.innerHTML = bodyHtml;
});

describe("renderStatic", () => {
  it("fills the config-driven slots", () => {
    renderStatic(CONFIG, "Anvil");
    expect(document.querySelector('[data-slot="product-name"]')?.textContent).toBe("Test Notebook");
    expect(document.querySelector('[data-slot="price"]')?.textContent).toBe("0.05 ETH");
    expect(document.querySelector('[data-slot="chain-line"]')?.textContent).toContain("Anvil");
    expect(document.querySelector<HTMLImageElement>('[data-slot="product-image"]')?.getAttribute("src")).toBe(
      "./product.svg",
    );
  });

  it("hides the figure when the config has no image", () => {
    renderStatic({ ...CONFIG, product: { ...CONFIG.product, images: [] } }, "Anvil");
    expect(document.querySelector<HTMLElement>('[data-slot="product-figure"]')?.hidden).toBe(true);
  });
});

describe("buildOrderForm", () => {
  it("generates inputs from the schema via the templates", () => {
    buildOrderForm(CONFIG.fulfillment.fields);
    const email = document.getElementById("f-email") as HTMLInputElement;
    const note = document.getElementById("f-note") as HTMLTextAreaElement;
    expect(email.type).toBe("email");
    expect(email.placeholder).toBe("you@example.com");
    expect(email.closest(".field")?.querySelector("label")?.textContent).toBe("Email *");
    expect(note.tagName).toBe("TEXTAREA");
    expect(note.closest(".field")?.querySelector("label")?.textContent).toBe("Note");
  });

  it("validates required and email fields, collects values", () => {
    buildOrderForm(CONFIG.fulfillment.fields);
    expect(collectOrderForm(CONFIG.fulfillment.fields)).toBeUndefined(); // required email empty

    const email = document.getElementById("f-email") as HTMLInputElement;
    email.value = "not-an-email";
    expect(collectOrderForm(CONFIG.fulfillment.fields)).toBeUndefined();
    expect(email.closest(".field")?.querySelector<HTMLElement>(".field__error")?.hidden).toBe(false);

    email.value = "buyer@example.com";
    (document.getElementById("f-note") as HTMLTextAreaElement).value = "  gift wrap  ";
    expect(collectOrderForm(CONFIG.fulfillment.fields)).toEqual({
      email: "buyer@example.com",
      note: "gift wrap",
    });
  });
});

describe("showLookupResult", () => {
  it("fills the lookup receipt and stamps the status", () => {
    showLookupResult({
      orderId: 7n,
      buyer: "0x2222222222222222222222222222222222222222",
      amount: 50000000000000000n,
      status: "REFUNDED",
      config: CONFIG,
    });
    expect(document.querySelector('[data-slot="lookup-ordernum"]')?.textContent).toBe("№ 7");
    expect(document.querySelector('[data-slot="lookup-amount"]')?.textContent).toBe("0.05 ETH");
    const stamp = document.querySelector<HTMLElement>('[data-slot="lookup-stamp"]');
    expect(stamp?.textContent).toBe("REFUNDED");
    expect(stamp?.className).toContain("stamp--refunded");
    expect(document.getElementById("lookup-receipt")?.hidden).toBe(false);
  });
});

describe("null tolerance (merchant deletes sections)", () => {
  it("survives with the checkout section removed", () => {
    document.getElementById("checkout")?.remove();
    expect(() => {
      renderStatic(CONFIG, "Anvil");
      buildOrderForm(CONFIG.fulfillment.fields);
      collectOrderForm(CONFIG.fulfillment.fields);
    }).not.toThrow();
  });

  it("survives with the lookup section removed", () => {
    document.getElementById("lookup")?.remove();
    expect(() => {
      renderStatic(CONFIG, "Anvil");
      showLookupResult({ orderId: 1n, buyer: "0x0", amount: 1n, status: "PAID", config: CONFIG });
    }).not.toThrow();
  });

  it("survives with every id and slot stripped", () => {
    document.body.innerHTML = "<main><p>my totally custom page</p></main>";
    expect(() => {
      renderStatic(CONFIG, "Anvil");
      buildOrderForm(CONFIG.fulfillment.fields);
      showLookupResult({ orderId: 1n, buyer: "0x0", amount: 1n, status: "PAID", config: CONFIG });
    }).not.toThrow();
  });
});
