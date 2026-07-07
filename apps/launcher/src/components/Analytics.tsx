"use client";

import { formatUnits } from "viem";
import { ETH_SENTINEL } from "@freeshop/shared";
import { publicEnv } from "@/lib/env";
import type { Rollup } from "@/lib/useIndexer";

function assetLabel(token: `0x${string}`): { symbol: string; decimals: number } {
  if (token === ETH_SENTINEL) return { symbol: "ETH", decimals: 18 };
  if (publicEnv.usdcAddress && token.toLowerCase() === publicEnv.usdcAddress.toLowerCase()) {
    return { symbol: "USDC", decimals: 6 };
  }
  return { symbol: "tokens", decimals: 18 };
}

export function AnalyticsPanel({ rollup }: { rollup: Rollup }) {
  return (
    <>
      <dl className="rows">
        <div>
          <dt>sales</dt>
          <dd>{rollup.sales}</dd>
        </div>
        <div>
          <dt>unique customers</dt>
          <dd>{rollup.uniqueBuyers}</dd>
        </div>
        <div>
          <dt>refunds</dt>
          <dd>{rollup.refunds}</dd>
        </div>
        <div>
          <dt>awaiting fulfilment</dt>
          <dd>{rollup.unfulfilled}</dd>
        </div>
        {rollup.revenue.map((r) => {
          const { symbol, decimals } = assetLabel(r.token);
          return (
            <div key={r.token}>
              <dt>gross · refunded ({symbol})</dt>
              <dd>
                {formatUnits(BigInt(r.gross), decimals)} · {formatUnits(BigInt(r.refunded), decimals)}
              </dd>
            </div>
          );
        })}
      </dl>
      <SalesChart salesByDay={rollup.salesByDay} />
    </>
  );
}

/** Last 30 days of sales as printed ledger bars — no chart library needed. */
export function SalesChart({ salesByDay }: { salesByDay: { day: number; sales: number }[] }) {
  const DAY = 86400;
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const byDay = new Map(salesByDay.map((d) => [d.day, d.sales]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = today - (29 - i) * DAY;
    return { day, sales: byDay.get(day) ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.sales));

  return (
    <div style={{ marginTop: 20 }}>
      <p className="eyebrow">Sales — last 30 days</p>
      <div className="chart" role="img" aria-label="Sales per day, last 30 days">
        {days.map(({ day, sales }) => (
          <div
            key={day}
            className="chart__bar"
            title={`${new Date(day * 1000).toISOString().slice(0, 10)}: ${sales} sale${sales === 1 ? "" : "s"}`}
          >
            <div
              className="chart__fill"
              style={{ height: `${(sales / max) * 100}%` }}
              data-empty={sales === 0 || undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
