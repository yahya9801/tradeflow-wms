"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/dashboard";

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // One message for both unknown email and wrong password — no user enumeration.
  if (error) return { error: "Invalid email or password." };

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Dev-only: sign in as a seeded test user to exercise RBAC quickly.
 * Hard-fails in production so it can never become a login bypass.
 */
export async function devSignInAs(email: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("devSignInAs is disabled in production");
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: "TradeFlow!2026",
  });
  if (error) throw new Error(`dev sign-in failed: ${error.message}`);

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
