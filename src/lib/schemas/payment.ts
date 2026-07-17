import { z } from "zod";

/** Shared by the payment Dialog and the Server Action. */
export const paymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  paid_on: z.string().min(1, "Date required"),
  method: z.string().trim().max(60).optional().default(""),
  note: z.string().trim().max(300).optional().default(""),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
