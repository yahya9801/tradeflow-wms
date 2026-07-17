"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

/** Theme-aware toaster, mounted once in the app layout. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={(resolvedTheme as "light" | "dark" | undefined) ?? "system"}
      position="bottom-right"
      richColors
      closeButton
    />
  );
}
