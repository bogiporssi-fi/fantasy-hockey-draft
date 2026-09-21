"use client";

import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import Link from "next/link";

export function LuistinLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="34" height="34" rx="10" fill="#0c1a24" stroke="#2a6f6a" />
      <path
        d="M8 22c6-1 10-8 14-8 2 0 3 1 6 1"
        fill="none"
        stroke="#8ef0e6"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M10 24h12" stroke="#8ef0e6" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="14" r="2" fill="#8ef0e6" />
    </svg>
  );
}

export function AppNav({ lang, active }: { lang: Lang; active: "helper" | "mock" }) {
  const c = t(lang);
  const linkClass = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm ${
      on ? "bg-ice/20 text-ice" : "text-muted hover:bg-white/5 hover:text-white"
    }`;
  return (
    <nav className="flex rounded-lg border border-line text-sm" aria-label={c.appTitle}>
      <Link href="/" className={linkClass(active === "helper")}>
        {c.helperNav}
      </Link>
      <Link href="/mock" className={linkClass(active === "mock")}>
        {c.mockNav}
      </Link>
    </nav>
  );
}
