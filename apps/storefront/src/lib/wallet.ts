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

  provider.on("accountsChanged", (accounts) => {
    state.address = (accounts as Hex[])[0];
    notify();
  });
  provider.on("chainChanged", (chainIdHex) => {
    state.chainId = Number(chainIdHex as string);
    notify();
  });

  // Restore an existing connection silently (no popup).
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as Hex[];
    state.address = accounts[0];
    state.chainId = Number(await provider.request({ method: "eth_chainId" }));
  } catch {
    /* wallet locked or unhappy — stay disconnected */
  }
  notify();
}

export async function connect(): Promise<void> {
  if (!client) throw new Error("no wallet detected — install one to continue");
  const [address] = await client.requestAddresses();
  state.address = address;
  state.chainId = Number(await provider!.request({ method: "eth_chainId" }));
  notify();
}

export function disconnect(): void {
  // Injected providers have no programmatic disconnect; forgetting locally matches wagmi.
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
