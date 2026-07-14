import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (Client Components).
 * Reads the public env vars; paste real values into `.env.local`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
