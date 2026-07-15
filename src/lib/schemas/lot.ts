import { z } from "zod";

import { statusIndex, type LotStatus } from "@/lib/lot-status";

const optionalText = z.string().trim().max(240).optional().default("");

/**
 * Shared by the form and the Server Actions. The conditional rules encode
 * CLAUDE.md's business rules: a B/L is required once an import is actually in
 * transit (not before — the paperwork doesn't exist until it sails), and an
 * export always needs agreed payment terms.
 */
export const lotSchema = z
  .object({
    direction: z.enum(["import", "export"]),
    commodity_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Select a commodity"),
    client_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Select a counterparty"),
    quantity_mt: z.coerce
      .number({ message: "Quantity must be a number" })
      .positive("Quantity must be greater than 0")
      .max(1_000_000, "Quantity looks too large"),
    status: z.enum([
      "pending", "in_transit", "received", "stored", "dispatched", "delivered",
    ]),
    origin_country: optionalText,
    destination_country: optionalText,
    vessel_name: optionalText,
    bl_number: optionalText,
    export_ref: optionalText,
    payment_terms: z.enum(["LC", "TT", "CAD", "DA"]).or(z.literal("")).optional().default(""),
    eta: z.string().trim().optional().default(""),
    notes: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.direction === "import" && statusIndex(v.status as LotStatus) >= statusIndex("in_transit")) {
      if (!v.bl_number) {
        ctx.addIssue({
          code: "custom",
          path: ["bl_number"],
          message: "B/L number is required once an import is in transit",
        });
      }
    }
    if (v.direction === "export" && !v.payment_terms) {
      ctx.addIssue({
        code: "custom",
        path: ["payment_terms"],
        message: "Payment terms are required for exports",
      });
    }
  });

export type LotInput = z.infer<typeof lotSchema>;
