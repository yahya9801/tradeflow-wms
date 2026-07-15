import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

/**
 * Appends an audit entry. The DB trigger hash-chains it; audit_log is
 * insert-only (UPDATE/DELETE are revoked for authenticated).
 */
export async function writeAudit(
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient();
  const session = await getSession();

  const { error } = await supabase.from("audit_log").insert({
    user_id: session?.user.id ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });

  // An audit failure must not silently pass — it would break the Phase 9 chain.
  if (error) throw new Error(`audit write failed: ${error.message}`);
}
