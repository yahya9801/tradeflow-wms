import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

let failed = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failed++;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function asUser(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "TradeFlow!2026" });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

async function main() {
  const owner = await asUser("owner@tradeflow.example");
  const mgmt = await asUser("management@tradeflow.example");
  const svc = createClient(url, service, { auth: { persistSession: false } });

  // 1. Phase 3-8 mutations are logged (read-only: expected action types present).
  const { data: actionsData } = await owner.from("audit_log").select("action");
  const actions = new Set((actionsData ?? []).map((r) => r.action));
  check("log contains create/update actions", actions.has("create") && actions.has("update"), [...actions].join(","));

  // 2. Chain is intact.
  const { data: v0 } = await owner.rpc("verify_audit_chain");
  check("verify_audit_chain reports intact", v0 == null, `badSeq=${v0}`);

  // 3. Tamper test — mutate one row's details (service role), detect, restore.
  const { data: last } = await svc.from("audit_log").select("seq, details").order("seq", { ascending: false }).limit(1).single();
  const original = last!.details;
  await svc.from("audit_log").update({ details: { tampered: true } }).eq("seq", last!.seq);
  const { data: v1 } = await owner.rpc("verify_audit_chain");
  check("tampering is detected at the altered seq", Number(v1) === Number(last!.seq), `badSeq=${v1}`);
  await svc.from("audit_log").update({ details: original }).eq("seq", last!.seq);
  const { data: v2 } = await owner.rpc("verify_audit_chain");
  check("chain intact again after restore", v2 == null, `badSeq=${v2}`);

  // 4. RLS: Management cannot read the log or write profiles.
  const { data: mAudit } = await mgmt.from("audit_log").select("seq").limit(1);
  check("Management cannot read audit_log", (mAudit?.length ?? 0) === 0);
  const { data: pUpd } = await mgmt.from("profiles").update({ department: "hax" }).neq("id", "00000000-0000-0000-0000-000000000000").select();
  check("Management cannot update profiles", (pUpd?.length ?? 0) === 0);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
