"use client";

import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export function DraftSteps({ lang }: { lang: Lang }) {
  const c = t(lang);
  const steps = [
    { n: 1, label: c.flowStep1 },
    { n: 2, label: c.flowStep2 },
    { n: 3, label: c.flowStep3 },
    { n: 4, label: c.flowStep4 },
  ];
  return (
    <nav aria-label={c.flowLabel} className="mb-4">
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {steps.map((s) => (
          <li
            key={s.n}
            className="flex items-center gap-2 rounded-xl border border-line bg-panel/90 px-2.5 py-2"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ice/20 text-xs font-semibold text-ice">
              {s.n}
            </span>
            <span className="text-xs font-medium leading-tight text-white">{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs leading-snug text-muted">{c.flowHint}</p>
    </nav>
  );
}
