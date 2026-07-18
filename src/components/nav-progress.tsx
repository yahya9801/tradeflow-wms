"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { isTrackableNavigation } from "@/lib/nav-progress";

/**
 * A thin top progress bar that gives immediate feedback on in-app navigation.
 * A capture-phase click listener starts it; a pathname/searchParams effect
 * completes it when the new route commits. No dependencies.
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopTrickle() {
    if (trickle.current) {
      clearInterval(trickle.current);
      trickle.current = null;
    }
  }

  function start() {
    if (trickle.current) return; // already running
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setVisible(true);
    setProgress(8);
    trickle.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? 90 : p + Math.max(0.5, (90 - p) * 0.12)));
    }, 200);
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const modifier = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
      const ok = isTrackableNavigation(
        {
          href: anchor.getAttribute("href") ?? "",
          target: anchor.getAttribute("target"),
          hasDownload: anchor.hasAttribute("download"),
        },
        { origin: window.location.origin, url: window.location.href },
        modifier,
      );
      if (ok) start();
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Route committed → finish and fade out.
  useEffect(() => {
    if (!visible) return;
    stopTrickle();
    setProgress(100);
    fadeTimer.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => () => { stopTrickle(); if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms ease" }}
    >
      <div
        className="h-full bg-primary"
        style={{ width: `${progress}%`, transition: "width 200ms ease" }}
      />
    </div>
  );
}
