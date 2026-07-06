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
