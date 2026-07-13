import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/900.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";

import { createPublicClient, http, type Hex } from "viem";
import {
  KEY_DERIVATION_MESSAGE,
  decryptFulfillment,
  deriveMerchantKeyPair,
  parseStoreConfig,
  storeEscrowAbi,
} from "@freeshop/shared";
import { resolveChain } from "./lib/chain";
import { byId, errorText, hide, setSlot, show } from "./lib/dom";
import { formatAmount, truncateAddress } from "./lib/format";
import { renderContractLink } from "./lib/render";
import { ORDER_STATUS_LABELS } from "./lib/status";
import * as wallet from "./lib/wallet";
import { computeRollup, type AdminOrder } from "./lib/admin/analytics";
import { fetchAdminOrders, MAX_ORDERS } from "./lib/admin/orders";
import { renderAnalytics, renderGate, renderOrders, setOrdersBusy, type OrderAction } from "./lib/admin/render";

const PAGE_SIZE = 200;
const STATUS_CODE: Record<"fulfill" | "cancel", number> = { fulfill: 2, cancel: 3 };

function initWalletButton(): void {
  const button = byId<HTMLButtonElement>("wallet-btn");
  if (!button) return;
  show(button);

  wallet.onWalletChange(({ address }) => {
    if (!wallet.hasWallet()) {
      button.textContent = "No wallet found";
      button.disabled = true;
    } else if (address) {
      button.textContent = `${truncateAddress(address)} · disconnect`;
      button.title = address;
      button.disabled = false;
    } else {
      button.textContent = "Connect wallet";
      button.title = "";
      button.disabled = false;
    }
  });

  button.addEventListener("click", () => {
    if (wallet.getWallet().address) wallet.disconnect();
    else void wallet.connect().catch(() => {});
  });
}

async function boot(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}store.config.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`could not load store.config.json (HTTP ${response.status})`);
  const config = parseStoreConfig(await response.json());
  const chain = resolveChain(config);
  // Dedicated client with request batching: the orders view coalesces its many small
  // reads (orders(id), getBlock) into JSON-RPC batch calls.
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { batch: { wait: 16 } }),
  });

  document.title = `${config.product.name} — merchant dashboard`;
  setSlot("chain-line", `${chain.name} · ${truncateAddress(config.storeAddress)}`);
  setSlot("gate-chain", chain.name);
  setSlot("colophon-note", `self-hosted · no backend · settled on ${chain.name}`);
  renderContractLink(config, chain);
  byId("boot")?.remove();
  show(byId("admin"));

  await wallet.initWallet(chain);
  initWalletButton();
  const noWalletHint = byId("no-wallet-hint");
  if (noWalletHint) noWalletHint.hidden = wallet.hasWallet();
  const gateConnectBtn = byId<HTMLButtonElement>("gate-connect-btn");
  if (gateConnectBtn) {
    gateConnectBtn.disabled = !wallet.hasWallet();
    gateConnectBtn.addEventListener("click", () => void wallet.connect().catch(() => {}));
  }
  byId("switch-chain-btn")?.addEventListener("click", () => {
    void wallet.switchToTargetChain().catch((error) => {
      const errorBox = byId("gate-error");
      if (errorBox) {
        errorBox.textContent = errorText(error);
        show(errorBox);
      }
    });
  });

  const contract = { address: config.storeAddress, abi: storeEscrowAbi } as const;
  const merchant = await publicClient.readContract({ ...contract, functionName: "merchant" });

  // ——— panel state ———
  let orders: AdminOrder[] = [];
  let logsUnavailable = false;
  let secretKey: Uint8Array | undefined; // memory only; cleared on account change
  let shown = PAGE_SIZE;
  let actionBusy = false;
  let panelLoaded = false;
  let unlockedBy: Hex | undefined;

  const renderContext = () => ({
    config,
    decrypt: secretKey ? (payload: Hex) => decryptFulfillment(payload, secretKey!) : undefined,
    logsUnavailable,
    onAction: (orderId: bigint, action: OrderAction) => void act(orderId, action),
    shown,
  });
  const rerenderOrders = () => renderOrders(orders, renderContext());

  async function refreshBalance(): Promise<void> {
    try {
      const available = await publicClient.readContract({ ...contract, functionName: "availableBalance" });
      setSlot("available-balance", formatAmount(available, config.payment.decimals, config.payment.symbol));
      const withdrawBtn = byId<HTMLButtonElement>("withdraw-btn");
      if (withdrawBtn) withdrawBtn.disabled = available === 0n || actionBusy;
    } catch {
      /* transient RPC trouble; the poll retries */
    }
  }

  function refreshUnfulfilledWarning(): void {
    const warning = byId("withdraw-warning");
    if (warning) warning.hidden = computeRollup(orders).unfulfilled === 0;
  }

  async function loadPanel(): Promise<void> {
    hide(byId("orders-error"));
    try {
      const result = await fetchAdminOrders(publicClient, config);
      orders = result.orders;
      logsUnavailable = result.logsUnavailable;
      const banner = byId("scan-warning");
      if (banner) {
        if (result.logsUnavailable) {
          banner.textContent =
            "COULD NOT SCAN ORDER EVENTS — statuses and actions still work, but buyer details " +
            "and dates are unavailable. Add \"deployBlock\" to store.config.json (the block the " +
            "store was deployed in) or set an rpcUrl with full log support.";
          show(banner);
        } else if (result.scanIncomplete) {
          banner.textContent = `SHOWING THE LATEST ${MAX_ORDERS} ORDERS — analytics cover these only.`;
          show(banner);
        } else {
          hide(banner);
        }
      }
      renderAnalytics(computeRollup(orders), config);
      rerenderOrders();
      refreshUnfulfilledWarning();
    } catch (error) {
      const errorBox = byId("orders-error");
      if (errorBox) {
        errorBox.textContent = errorText(error);
        show(errorBox);
      }
    }
    await refreshBalance();
  }

  async function act(orderId: bigint, action: OrderAction): Promise<void> {
    const { address } = wallet.getWallet();
    if (!address || actionBusy) return;
    actionBusy = true;
    setOrdersBusy(true);
    hide(byId("admin-error"));
    try {
      const hash = await wallet.walletClient().writeContract(
        action === "refund"
          ? { account: address, chain, ...contract, functionName: "refund", args: [orderId] }
          : { account: address, chain, ...contract, functionName: "setStatus", args: [orderId, STATUS_CODE[action]] },
      );
      await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      // Patch just the acted-on order; a full rescan is never needed for a status change.
      const [, , statusCode] = await publicClient.readContract({ ...contract, functionName: "orders", args: [orderId] });
      const order = orders.find((candidate) => candidate.orderId === orderId);
      if (order) order.status = (ORDER_STATUS_LABELS[statusCode] ?? order.status) as AdminOrder["status"];
      renderAnalytics(computeRollup(orders), config);
      refreshUnfulfilledWarning();
    } catch (error) {
      const errorBox = byId("admin-error");
      if (errorBox) {
        errorBox.textContent = errorText(error);
        show(errorBox);
      }
    } finally {
      actionBusy = false;
      rerenderOrders();
      await refreshBalance();
    }
  }

  byId("unlock-btn")?.addEventListener("click", () => {
    void (async () => {
      const { address } = wallet.getWallet();
      if (!address) return;
      hide(byId("admin-error"));
      try {
        const signature = await wallet.walletClient().signMessage({ account: address, message: KEY_DERIVATION_MESSAGE });
        secretKey = deriveMerchantKeyPair(signature).secretKey;
        unlockedBy = address;
        const unlockBtn = byId<HTMLButtonElement>("unlock-btn");
        if (unlockBtn) unlockBtn.hidden = true;
        rerenderOrders();
      } catch (error) {
        const errorBox = byId("admin-error");
        if (errorBox) {
          errorBox.textContent = errorText(error);
          show(errorBox);
        }
      }
    })();
  });

  byId("withdraw-btn")?.addEventListener("click", () => {
    void (async () => {
      const { address } = wallet.getWallet();
      if (!address) return;
      const withdrawBtn = byId<HTMLButtonElement>("withdraw-btn");
      if (withdrawBtn) withdrawBtn.disabled = true;
      hide(byId("withdraw-error"));
      try {
        const hash = await wallet.walletClient().writeContract({
          account: address,
          chain,
          ...contract,
          functionName: "withdraw",
        });
        await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      } catch (error) {
        const errorBox = byId("withdraw-error");
        if (errorBox) {
          errorBox.textContent = errorText(error);
          show(errorBox);
        }
      }
      await refreshBalance();
    })();
  });

  byId("show-older-btn")?.addEventListener("click", () => {
    shown += PAGE_SIZE;
    rerenderOrders();
  });

  setInterval(() => {
    if (document.visibilityState === "visible" && panelLoaded) void refreshBalance();
  }, 15_000);

  // ——— the gate ———
  wallet.onWalletChange(({ address }) => {
    // The reading key belongs to whichever wallet signed; drop it when accounts change.
    if (secretKey && address !== unlockedBy) {
      secretKey = undefined;
      unlockedBy = undefined;
      const unlockBtn = byId<HTMLButtonElement>("unlock-btn");
      if (unlockBtn) unlockBtn.hidden = false;
      rerenderOrders();
    }
    if (!address) {
      renderGate("connect");
    } else if (wallet.onWrongChain()) {
      renderGate("wrong-chain");
    } else if (address.toLowerCase() !== merchant.toLowerCase()) {
      renderGate("wrong-wallet", { connected: address, merchant });
    } else {
      renderGate("open");
      if (!panelLoaded) {
        panelLoaded = true;
        void loadPanel();
      }
    }
  });
}

boot().catch((error) => {
  const boot = byId("boot");
  if (boot) {
    boot.classList.add("boot--error");
    boot.textContent =
      "THIS DASHBOARD FAILED TO LOAD\n\n" +
      (error instanceof Error ? error.message : String(error)) +
      "\n\nIf you are the merchant: check store.config.json.";
  }
});
