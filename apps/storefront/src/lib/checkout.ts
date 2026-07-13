import { erc20Abi, formatUnits, parseEventLogs, type Chain, type Hex, type PublicClient } from "viem";
import { ETH_SENTINEL, encryptFulfillment, storeEscrowAbi, type FulfillmentField, type StoreConfig } from "@freeshop/shared";
import { byId, cloneTemplate, errorText, hide, setSlot, show, slot } from "./dom";
import { explorerTxUrl } from "./chain";
import { formatAmount, truncateAddress } from "./format";
import * as wallet from "./wallet";

export interface StoreFacts {
  price: bigint;
  paymentToken: Hex;
  merchantPubKey: Hex;
}

export interface CheckoutContext {
  config: StoreConfig;
  chain: Chain;
  publicClient: PublicClient;
  /** Authoritative on-chain facts; undefined until the reads land (payment stays disabled). */
  getFacts: () => StoreFacts | undefined;
  /** True when payment must stay off (RPC down, schema mismatch). */
  isBlocked: () => boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generates the order form inputs from the merchant's fulfillment schema, using the
 * <template id="tpl-field-*"> markup so merchants control what a field row looks like.
 */
export function buildOrderForm(fields: FulfillmentField[]): void {
  const container = byId("order-fields");
  if (!container) return;
  container.textContent = "";

  for (const field of fields) {
    const fragment = cloneTemplate(field.type === "textarea" ? "tpl-field-textarea" : "tpl-field-text");
    if (!fragment) continue;
    const label = fragment.querySelector("label");
    const input = fragment.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (!label || !input) continue;

    const inputId = `f-${field.name}`;
    label.textContent = field.required ? `${field.label} *` : field.label;
    label.setAttribute("for", inputId);
    input.id = inputId;
    input.name = field.name;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (input instanceof HTMLInputElement) input.type = field.type === "email" ? "email" : "text";
    container.appendChild(fragment);
  }
}

/** Validates + collects the form; marks per-field errors. Returns undefined when invalid. */
export function collectOrderForm(fields: FulfillmentField[]): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  let valid = true;

  for (const field of fields) {
    const input = byId<HTMLInputElement | HTMLTextAreaElement>(`f-${field.name}`);
    const errorEl = input?.closest(".field")?.querySelector<HTMLElement>(".field__error") ?? null;
    const value = (input?.value ?? "").trim();
    let error = "";
    if (field.required && !value) error = "Required";
    else if (field.type === "email" && value && !EMAIL_RE.test(value)) error = "Not a valid email address";

    if (errorEl) {
      errorEl.textContent = error;
      errorEl.hidden = !error;
    }
    if (error) valid = false;
    else if (value) values[field.name] = value;
  }
  return valid ? values : undefined;
}

/** Fills and reveals the confirmation receipt. */
export function showReceipt(params: {
  orderId: bigint;
  txHash: Hex;
  amountLabel: string;
  storeAddress: Hex;
  chain: Chain;
}): void {
  const receipt = byId("receipt");
  setSlot("receipt-ordernum", `№ ${params.orderId}`);
  setSlot("receipt-amount", params.amountLabel);
  setSlot("receipt-escrow", truncateAddress(params.storeAddress));

  const txLink = slot<HTMLAnchorElement>("receipt-tx");
  if (txLink) {
    txLink.textContent = truncateAddress(params.txHash);
    const url = explorerTxUrl(params.chain, params.txHash);
    if (url) txLink.href = url;
  }
  const orderUrl = `${location.origin}${location.pathname}?order=${params.orderId}`;
  const orderLink = slot<HTMLAnchorElement>("receipt-order-link");
  if (orderLink) {
    orderLink.textContent = orderUrl;
    orderLink.href = orderUrl;
  }

  hide(byId("order-form"));
  show(receipt);
  history.replaceState(null, "", `?order=${params.orderId}`);
}

type StepId = "encrypt" | "approve" | "pay" | "confirm";

function renderProgress(steps: { id: StepId; label: string }[], active: StepId, failed: boolean): void {
  const list = byId("progress");
  if (!list) return;
  show(list);
  list.textContent = "";
  const order = steps.map((s) => s.id);
  for (const step of steps) {
    const fragment = cloneTemplate("tpl-progress-line");
    if (!fragment) return;
    const li = fragment.querySelector("li");
    const label = fragment.querySelector<HTMLElement>('[data-slot="label"]');
    if (label) label.textContent = step.label;
    if (li) {
      li.dataset.state =
        step.id === active ? (failed ? "error" : "active") : order.indexOf(step.id) < order.indexOf(active) ? "done" : "todo";
    }
    list.appendChild(fragment);
  }
}

export function initCheckout(ctx: CheckoutContext): void {
  const form = byId<HTMLFormElement>("order-form");
  const payBtn = byId<HTMLButtonElement>("pay-btn");
  if (!form || !payBtn) return; // checkout section removed — rest of the page still works

  buildOrderForm(ctx.config.fulfillment.fields);

  let busy = false;

  const priceLabel = () => {
    const facts = ctx.getFacts();
    return formatAmount(
      facts?.price ?? BigInt(ctx.config.payment.price),
      ctx.config.payment.decimals,
      ctx.config.payment.symbol,
    );
  };

  const refreshButton = () => {
    const { address } = wallet.getWallet();
    const isEth = (ctx.getFacts()?.paymentToken ?? ctx.config.payment.token) === ETH_SENTINEL;
    const erc20Note = byId("erc20-note");
    if (erc20Note) erc20Note.hidden = isEth || !address || wallet.onWrongChain();
    const noWalletHint = byId("no-wallet-hint");
    if (noWalletHint) noWalletHint.hidden = wallet.hasWallet();

    if (busy) {
      payBtn.disabled = true;
      payBtn.textContent = "Processing…";
    } else if (!wallet.hasWallet()) {
      payBtn.disabled = true;
      payBtn.textContent = "No wallet detected — install one to pay";
    } else if (!address) {
      payBtn.disabled = false;
      payBtn.textContent = "Connect wallet to pay";
    } else if (wallet.onWrongChain()) {
      payBtn.disabled = false;
      payBtn.textContent = `Switch wallet to ${ctx.chain.name}`;
    } else {
      payBtn.disabled = ctx.isBlocked() || !ctx.getFacts();
      payBtn.textContent = `Pay ${priceLabel()}`;
    }
  };

  wallet.onWalletChange(refreshButton);
  // Facts land async; the caller pokes us via this custom event after reads finish.
  document.addEventListener("freeshop:facts", refreshButton);

  // Companion to #no-wallet-hint: lets mobile users carry this URL into their wallet's browser.
  const copyBtn = byId<HTMLButtonElement>("copy-link-btn");
  copyBtn?.addEventListener("click", () => {
    navigator.clipboard.writeText(location.href).then(
      () => {
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy link"), 2000);
      },
      () => {
        copyBtn.textContent = "Copy failed — use the address bar";
      },
    );
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onSubmit();
  });

  async function onSubmit(): Promise<void> {
    const errorBox = byId("checkout-error");
    hide(errorBox);

    const { address } = wallet.getWallet();
    if (!address) {
      try {
        await wallet.connect();
      } catch (error) {
        if (errorBox) {
          errorBox.textContent = errorText(error);
          show(errorBox);
        }
      }
      return;
    }
    if (wallet.onWrongChain()) {
      try {
        await wallet.switchToTargetChain();
      } catch (error) {
        if (errorBox) {
          errorBox.textContent = errorText(error);
          show(errorBox);
        }
      }
      return;
    }

    const facts = ctx.getFacts();
    if (!facts || ctx.isBlocked()) return;
    const values = collectOrderForm(ctx.config.fulfillment.fields);
    if (!values) return;

    const isEth = facts.paymentToken === ETH_SENTINEL;
    const steps: { id: StepId; label: string }[] = [
      { id: "encrypt", label: "Encrypting your details in this browser" },
      ...(isEth ? [] : [{ id: "approve" as const, label: "Approving token spend" }]),
      { id: "pay", label: "Sending payment to escrow" },
      { id: "confirm", label: "Waiting for on-chain confirmation" },
    ];

    busy = true;
    refreshButton();
    let active: StepId = "encrypt";
    try {
      renderProgress(steps, active, false);
      const payload = encryptFulfillment(values, facts.merchantPubKey);

      if (!isEth) {
        active = "approve";
        renderProgress(steps, active, false);
        const allowance = await ctx.publicClient.readContract({
          address: facts.paymentToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, ctx.config.storeAddress],
        });
        if (allowance < facts.price) {
          const approveHash = await wallet.walletClient().writeContract({
            account: address,
            chain: ctx.chain,
            address: facts.paymentToken,
            abi: erc20Abi,
            functionName: "approve",
            args: [ctx.config.storeAddress, facts.price],
          });
          await ctx.publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
        }
      }

      active = "pay";
      renderProgress(steps, active, false);
      const txHash = await wallet.walletClient().writeContract({
        account: address,
        chain: ctx.chain,
        address: ctx.config.storeAddress,
        abi: storeEscrowAbi,
        functionName: "pay",
        args: [payload],
        value: isEth ? facts.price : 0n,
      });

      active = "confirm";
      renderProgress(steps, active, false);
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
      const [placed] = parseEventLogs({ abi: storeEscrowAbi, eventName: "OrderPlaced", logs: receipt.logs });
      if (!placed) throw new Error("transaction confirmed but no OrderPlaced event found");

      renderProgress(steps, "confirm", false);
      showReceipt({
        orderId: placed.args.orderId,
        txHash,
        amountLabel: formatAmount(facts.price, ctx.config.payment.decimals, ctx.config.payment.symbol),
        storeAddress: ctx.config.storeAddress,
        chain: ctx.chain,
      });
    } catch (error) {
      renderProgress(steps, active, true);
      const errorBox2 = byId("checkout-error");
      if (errorBox2) {
        errorBox2.textContent = errorText(error);
        show(errorBox2);
      }
    } finally {
      busy = false;
      refreshButton();
    }
  }

  refreshButton();
}

/** Re-exported for main.ts to keep the price label formatting in one place. */
export function formatPrice(config: StoreConfig, price: bigint): string {
  return `${formatUnits(price, config.payment.decimals)} ${config.payment.symbol}`;
}
