import { z } from "zod";

/** Manual "Flag issue" — only the two non-derivable types are raisable by hand. */
export const flagSchema = z.object({
  lot_id: z.string().uuid(),
  type: z.enum(["weight_shortage", "compliance_block"]),
  severity: z.enum(["critical", "warning", "notice"]),
  description: z.string().trim().min(5, "Describe the issue").max(300),
});

export type FlagInput = z.infer<typeof flagSchema>;
