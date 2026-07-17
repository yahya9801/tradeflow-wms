import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AuditEntry = {
  seq: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  created_at: string;
  hash: string;
};

export type AuditStats = {
  total: number;
  actors: number;
  byAction: { action: string; count: number }[];
};

async function actorNames(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id as string, p.full_name as string]));
}

export async function listAuditEntries(
  opts: { actor?: string; action?: string } = {},
  limit = 100,
): Promise<AuditEntry[]> {
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("seq, user_id, action, entity_type, entity_id, hash, created_at")
    .order("seq", { ascending: false })
    .limit(limit);
  if (opts.actor) query = query.eq("user_id", opts.actor);
  if (opts.action) query = query.eq("action", opts.action);

  const { data, error } = await query;
  if (error) throw new Error(`listAuditEntries: ${error.message}`);

  type Row = {
    seq: number; user_id: string | null; action: string; entity_type: string;
    entity_id: string | null; hash: string; created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const names = await actorNames(supabase, rows.map((r) => r.user_id ?? ""));
  return rows.map((r) => ({
    seq: r.seq,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    actor: r.user_id ? names.get(r.user_id) ?? null : null,
    created_at: r.created_at,
    hash: r.hash,
  }));
}

export async function getAuditStats(): Promise<AuditStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("audit_log").select("action, user_id");
  const rows = (data ?? []) as { action: string; user_id: string | null }[];
  const byAction = new Map<string, number>();
  const actors = new Set<string>();
  for (const r of rows) {
    byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
    if (r.user_id) actors.add(r.user_id);
  }
  return {
    total: rows.length,
    actors: actors.size,
    byAction: [...byAction.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
  };
}

export async function listActors(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("audit_log").select("user_id");
  const ids = [...new Set((data ?? []).map((r) => (r as { user_id: string | null }).user_id).filter(Boolean) as string[])];
  const names = await actorNames(supabase, ids);
  return ids.map((id) => ({ id, name: names.get(id) ?? "Unknown" })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function verifyChain(): Promise<{ intact: boolean; badSeq: number | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_audit_chain");
  if (error) throw new Error(`verifyChain: ${error.message}`);
  const badSeq = data == null ? null : Number(data);
  return { intact: badSeq == null, badSeq };
}
