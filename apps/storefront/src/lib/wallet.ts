import {
  createWalletClient,
  custom,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from "viem";

/**
 * Minimal injected-wallet layer (MetaMask-class, same scope the wagmi injected connector
 * covered). Tracks the active account + chain and notifies subscribers on changes.
 */

export interface WalletState {
  address?: Hex;
  chainId?: number;
}

type Listener = (state: WalletState) => void;

let provider: EIP1193Provider | undefined;
let client: WalletClient | undefined;
let chain: Chain;
const state: WalletState = {};
const listeners = new Set<Listener>();

/**
 * Injected providers have no reliable programmatic disconnect, so an explicit disconnect is
 * remembered here — otherwise the silent eth_accounts restore on the next load would undo it.
 */
const DISCONNECT_FLAG = "freeshop:wallet-disconnected";
let explicitlyDisconnected = false;

function readDisconnectFlag(): boolean {
  try {
    return localStorage.getItem(DISCONNECT_FLAG) !== null;
  } catch {
    return false; // storage unavailable (privacy mode) — fall back to session-only behavior
  }
}

function writeDisconnectFlag(disconnected: boolean): void {
  try {
    if (disconnected) localStorage.setItem(DISCONNECT_FLAG, "1");
    else localStorage.removeItem(DISCONNECT_FLAG);
  } catch {
    /* storage unavailable — the in-memory flag still covers this page's lifetime */
  }
}

function notify() {
  for (const listener of listeners) listener({ ...state });
}

export function onWalletChange(listener: Listener): void {
  listeners.add(listener);
  listener({ ...state });
}

export function getWallet(): WalletState {
  return { ...state };
}

export function hasWallet(): boolean {
  return !!provider;
}

export function walletClient(): WalletClient {
  if (!client) throw new Error("no wallet available");
  return client;
}

export async function initWallet(targetChain: Chain): Promise<void> {
  chain = targetChain;
  provider = (window as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) return;
  client = createWalletClient({ chain, transport: custom(provider) });
  explicitlyDisconnected = readDisconnectFlag();

  provider.on("accountsChanged", (accounts) => {
    // Some wallets emit this on their own initialization; honor an explicit disconnect until
    // the user presses connect again.
    if (explicitlyDisconnected) return;
    state.address = (accounts as Hex[])[0];
    notify();
  });
  provider.on("chainChanged", (chainIdHex) => {
    state.chainId = Number(chainIdHex as string);
    notify();
  });

  // Restore an existing connection silently (no popup) — unless the user explicitly
  // disconnected last visit.
  try {
    if (!explicitlyDisconnected) {
      const accounts = (await provider.request({ method: "eth_accounts" })) as Hex[];
      state.address = accounts[0];
    }
    state.chainId = Number(await provider.request({ method: "eth_chainId" }));
  } catch {
    /* wallet locked or unhappy — stay disconnected */
  }
  notify();
}

export async function connect(): Promise<void> {
  if (!client) throw new Error("no wallet detected — install one to continue");
  explicitlyDisconnected = false;
  writeDisconnectFlag(false);
  const [address] = await client.requestAddresses();
  state.address = address;
  state.chainId = Number(await provider!.request({ method: "eth_chainId" }));
  notify();
}

export function disconnect(): void {
  // Remember the choice so the silent restore on the next load doesn't undo it, and ask the
  // wallet to revoke the site's permission where supported (MetaMask) — best-effort.
  explicitlyDisconnected = true;
  writeDisconnectFlag(true);
  void provider
    ?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never)
    .catch(() => {});
  state.address = undefined;
  notify();
}

export function onTargetChain(): boolean {
  return state.chainId === chain.id;
}

/** Wrong-chain is only certain when the wallet has reported a different id. */
export function onWrongChain(): boolean {
  return !!state.address && state.chainId !== undefined && state.chainId !== chain.id;
}

export async function switchToTargetChain(): Promise<void> {
  if (!client) return;
  try {
    await client.switchChain({ id: chain.id });
  } catch (error) {
    // 4902: chain not added to the wallet yet.
    if ((error as { code?: number }).code === 4902) {
      await client.addChain({ chain });
      await client.switchChain({ id: chain.id });
    } else {
      throw error;
    }
  }
}
