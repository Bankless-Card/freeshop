import { ETH_SENTINEL } from "@freeshop/shared";
import { publicEnv } from "./env";

export interface PaymentAsset {
  key: "ETH" | "USDC";
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  hint: string;
}

/** The single payment asset choices this launcher offers (per store, fixed at launch). */
export function paymentAssets(): PaymentAsset[] {
  const assets: PaymentAsset[] = [
    {
      key: "ETH",
      token: ETH_SENTINEL,
      symbol: "ETH",
      decimals: 18,
      hint: "native ether — one-transaction checkout",
    },
  ];
  if (publicEnv.usdcAddress) {
    assets.push({
      key: "USDC",
      token: publicEnv.usdcAddress,
      symbol: "USDC",
      decimals: 6,
      hint: "stable pricing — buyers approve, then pay",
    });
  }
  return assets;
}
