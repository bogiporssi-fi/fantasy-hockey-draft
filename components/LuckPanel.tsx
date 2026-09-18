"use client";

import { t, type Copy } from "@/lib/i18n";
import type { LuckLabel, LuckReport, LuckWhy } from "@/lib/luck";
import type { Lang } from "@/lib/types";

function whyText(c: Copy, why: LuckWhy): string {
  return c[`luckWhy_${why}`];
}

function labelText(c: Copy, label: LuckLabel, short: boolean): string {
  if (label === "lucky") return short ? c.luckLuckyShort : c.luckLucky;
  if (label === "unlucky") return short ? c.luckUnluckyShort : c.luckUnlucky;
  if (label === "thin") return short ? c.luckThinShort : c.luckThin;
  return short ? c.luckNeutralShort : c.luckNeutral;
}

function labelClass(label: LuckLabel): string {
  if (label === "lucky") return "text-warn";
  if (label === "unlucky") return "text-ice";
  if (label === "thin") return "text-muted";
  return "text-white/85";
}

function fmtSigned(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
  return v.replace(/\.0$/, "").replace(/(\.\d)0$/, "$1");
}

function fmt1(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function LuckPanel({
  lang,
  report,
  loading,
  compact = false,
}: {
  lang: Lang;
  report: LuckReport | null | undefined;
  loading?: boolean;
  compact?: boolean;
}) {
  const c = t(lang);

  if (loading && report === undefined) {
    return (
      <div className={`text-[11px] text-muted ${compact ? "mt-2" : ""}`}>{c.luckLoading}</div>
    );
  }

  if (!report) {
    return (
      <div
        className={`rounded-lg border border-line/80 bg-[#08141d] ${compact ? "mt-2 px-2 py-1.5" : "px-3 py-3"}`}
      >
        <div className="text-[11px] uppercase tracking-wide text-muted">{c.luckTitle}</div>
        <p className="mt-1 text-xs leading-snug text-white/75">{c.luckMissing}</p>
        {!compact && <p className="mt-1 text-[10px] text-muted">{c.luckSource}</p>}
      </div>
    );
  }

  const verdict = labelText(c, report.label, compact);
  const tone = labelClass(report.label);

  if (compact) {
    return (
      <div className="mt-2 rounded-lg border border-line/70 bg-white/[0.03] px-2 py-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted">
            {c.luckTitle} · {c.luckSeason}
          </span>
          <span className={`text-xs font-medium ${tone}`}>{verdict}</span>
        </div>
        <p className="mt-0.5 text-[11px] tabular text-muted">
          {report.kind === "goalie" ? (
            <>
              {c.luckGaVsXga} {fmt1(report.goalsAgainst)} / {fmt1(report.xGoalsAgainst)} (
              {fmtSigned(report.goalsAgainst != null && report.xGoalsAgainst != null
                ? report.goalsAgainst - report.xGoalsAgainst
                : null)}
              )
            </>
          ) : (
            <>
              {c.luckGoalsVsXg} {fmt1(report.goals)} / {fmt1(report.xGoals)} ({fmtSigned(report.goalsMinusXg)})
              {report.pdo != null ? ` · ${c.luckPdo} ${fmt1(report.pdo)}` : ""}
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-[#08141d] px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{c.luckTitle}</h3>
        <span className="text-[10px] text-muted">{c.luckSeason}</span>
      </div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{verdict}</div>
      <p className="mt-1 text-xs leading-snug text-white/80">{whyText(c, report.why)}</p>
      {report.kind === "goalie" ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={c.luckGaVsXga} value={`${fmt1(report.goalsAgainst)} / ${fmt1(report.xGoalsAgainst)}`} hint={fmtSigned(report.goalsAgainst != null && report.xGoalsAgainst != null ? report.goalsAgainst - report.xGoalsAgainst : null)} />
          <Stat
            label={c.luckSavePct}
            value={report.savePct != null ? `${fmt1(report.savePct)}%` : "—"}
            hint={report.expectedSavePct != null ? `${c.luckExpected} ${fmt1(report.expectedSavePct)}%` : undefined}
          />
          <Stat label={c.luckGp} value={String(report.gamesPlayed)} />
        </dl>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label={c.luckGoalsVsXg}
            value={`${fmt1(report.goals)} / ${fmt1(report.xGoals)}`}
            hint={fmtSigned(report.goalsMinusXg)}
          />
          <Stat
            label={c.luckShooting}
            value={report.shootingPct != null ? `${fmt1(report.shootingPct)}%` : "—"}
            hint={
              report.expectedShootingPct != null
                ? `${c.luckExpected} ${fmt1(report.expectedShootingPct)}%`
                : undefined
            }
          />
          <Stat label={c.luckPdo} value={report.pdo != null ? fmt1(report.pdo) : "—"} hint="SH%+SV%" />
        </dl>
      )}
      <p className="mt-2 text-[10px] leading-snug text-muted">
        {report.kind === "goalie" ? `${c.luckGoalieHint} ` : ""}
        {c.luckFootnote} {c.luckSource}
      </p>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2">
      <dt className="text-[10px] leading-tight text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular text-white">{value}</dd>
      {hint && <div className="text-[10px] tabular text-muted">{hint}</div>}
    </div>
  );
}
