import { z } from "zod";

/** Shared by the client Dialog and the Server Actions — one source of truth. */
export const clientSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  type: z.enum(["buyer", "supplier", "both"]),
  country: z.string().trim().max(80).optional().default(""),
  contact_name: z.string().trim().max(120).optional().default(""),
  // A real email or blank — never a malformed one.
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  // The form is a fixed select, so the value is always one of these.
  currency: z.enum(["USD", "EUR", "GBP", "AED"]).optional().default("USD"),
});

export type ClientInput = z.infer<typeof clientSchema>;
