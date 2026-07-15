import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const email = `trigger-test-${Date.now()}@tradeflow.example`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: "Throwaway!2026",
    email_confirm: true,
  });
  if (error) throw error;

  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", data.user.id)
    .single();
  console.log("profile created:", profile);

  const ok = profile?.role === "management";
  await db.auth.admin.deleteUser(data.user.id); // cleanup
  console.log(ok ? "PASS: trigger created profile with default role management" : "FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
