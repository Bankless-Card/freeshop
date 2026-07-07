import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The Launcher's only authoritative data: merchant accounts. Orders, sales, and fulfillment
 * data live on-chain — never here.
 */
export const merchants = pgTable("merchants", {
  /** Lowercased 0x wallet address — the merchant identity (SIWE). */
  address: text("address").primaryKey(),
  /** Required at onboarding, not verified in v1 (verification arrives with the notification service). */
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Merchant = typeof merchants.$inferSelect;

/**
 * Saved store.config.json per deployed store, so merchants can re-download their storefront
 * package any time. Product copy and the fulfillment schema exist nowhere on-chain (only the
 * schema's hash does), so without this copy a lost config could only be reconstructed by hand.
 * The content is public by nature — it ships verbatim on the merchant's own storefront.
 */
export const storeConfigs = pgTable("store_configs", {
  /** Lowercased StoreEscrow address. */
  storeAddress: text("store_address").primaryKey(),
  /** Lowercased owner (the store's on-chain `merchant`) — checked against the session on access. */
  merchantAddress: text("merchant_address").notNull(),
  /** The store.config.json, as a JSON string (validated by parseStoreConfig on write). */
  config: text("config").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
