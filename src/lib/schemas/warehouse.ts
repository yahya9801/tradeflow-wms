import { z } from "zod";

/** Shared by the Dialog forms and the Server Actions — one source of truth. */
export const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  address: z.string().trim().max(240).optional().default(""),
  capacity_mt: z.coerce
    .number({ message: "Rated capacity must be a number" })
    .positive("Rated capacity must be greater than 0")
    .max(1_000_000, "Rated capacity looks too large"),
});

export const shedSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  capacity_mt: z.coerce
    .number({ message: "Capacity must be a number" })
    .positive("Capacity must be greater than 0")
    .max(1_000_000, "Capacity looks too large"),
});

export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type ShedInput = z.infer<typeof shedSchema>;
