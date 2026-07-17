"use server";

import { requireCapability } from "@/lib/auth";
import { verifyChain } from "@/lib/audit-log";

export type VerifyState = { checked: boolean; intact: boolean; badSeq: number | null; error: string | null };

export async function verifyChainAction(): Promise<VerifyState> {
  const gate = await requireCapability("view_audit");
  if (!gate.allowed) return { checked: false, intact: false, badSeq: null, error: "Owner access required." };
  const { intact, badSeq } = await verifyChain();
  return { checked: true, intact, badSeq, error: null };
}
