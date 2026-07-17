import { z } from "zod";

/** Shared by the invoice Dialog and the Server Actions — one source of truth. */
export const invoiceSchema = z.object({
  type: z.enum(["receivable", "payable"]),
  client_id: z.string().uuid("Select a client"),
  // A real lot id or blank ("" → null in the action).
  lot_id: z.string().uuid().or(z.literal("")).optional().default(""),
  currency: z.enum(["USD", "EUR", "GBP", "AED"]).optional().default("USD"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  // ISO date or blank ("" → null in the action).
  due_date: z.string().or(z.literal("")).optional().default(""),
  description: z.string().trim().max(500).optional().default(""),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;
