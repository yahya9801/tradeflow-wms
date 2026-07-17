import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AlertToggles = { overdue_invoices: boolean; over_capacity: boolean; missing_bl: boolean };
export type Preferences = {
  default_currency: string; date_format: string; low_stock_threshold_pct: number; alerts: AlertToggles;
};

const DEFAULTS: Preferences = {
  default_currency: "USD", date_format: "DD MMM YYYY", low_stock_threshold_pct: 80,
  alerts: { overdue_invoices: true, over_capacity: true, missing_bl: true },
};

export async function getPreferences(): Promise<Preferences> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value")
    .in("key", ["default_currency", "date_format", "low_stock_threshold_pct", "alerts"]);
  const map = new Map((data ?? []).map((r) => [r.key as string, (r as { value: unknown }).value]));
  const alerts = (map.get("alerts") ?? {}) as Partial<AlertToggles>;
  return {
    default_currency: (map.get("default_currency") as string) ?? DEFAULTS.default_currency,
    date_format: (map.get("date_format") as string) ?? DEFAULTS.date_format,
    low_stock_threshold_pct: Number(map.get("low_stock_threshold_pct") ?? DEFAULTS.low_stock_threshold_pct),
    alerts: { ...DEFAULTS.alerts, ...alerts },
  };
}

/** Lightweight read for the exceptions filter (avoids pulling currency/date). */
export async function getAlertToggles(): Promise<AlertToggles> {
  return (await getPreferences()).alerts;
}
