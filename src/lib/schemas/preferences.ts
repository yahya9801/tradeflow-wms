import { z } from "zod";

export const CURRENCIES = ["USD", "EUR", "GBP", "AED"] as const;
export const DATE_FORMATS = ["DD MMM YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;

/** Booleans come pre-converted from checkbox presence in the action. */
export const preferencesSchema = z.object({
  default_currency: z.enum(CURRENCIES),
  date_format: z.enum(DATE_FORMATS),
  low_stock_threshold_pct: z.coerce.number().int().min(1).max(100),
  overdue_invoices: z.boolean(),
  over_capacity: z.boolean(),
  missing_bl: z.boolean(),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;
