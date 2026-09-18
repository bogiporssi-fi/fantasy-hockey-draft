"use client";

import { t, type Copy } from "@/lib/i18n";
import {
  LUCK_YEARS,
  seasonShortLabel,
  type LuckLabel,
  type LuckReport,
  type LuckWhy,
  type TrendMetric,
} from "@/lib/luck";
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

function fmtPct(n: number | null | undefined): string {
  return n == null ? "—" : `${fmt1(n)}%`;
}

function fmtTrend(trend: (number | null)[] | undefined): string {
  if (!trend?.length) return "";
  return trend.map((v) => (v == null ? "—" : fmt1(v))).join("→");
}

function deltaClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-muted";
  return n > 0 ? "text-warn" : "text-ice";
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
        <div className="text-[11px] uppercase tracking-wide text-muted">{c.ftTitle}</div>
        <p className="mt-1 text-xs leading-snug text-white/75">{c.luckMissing}</p>
        {!compact && <p className="mt-1 text-[10px] text-muted">{c.luckSource}</p>}
      </div>
    );
  }

  const verdict = labelText(c, report.label, compact);
  const tone = labelClass(report.label);
  const yearBits = LUCK_YEARS.map(seasonShortLabel).join(" · ");

  if (compact) {
    return (
      <div className="mt-2 rounded-lg border border-line/70 bg-white/[0.03] px-2 py-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted">{c.ftTitle}</span>
          <span className={`text-xs font-medium ${tone}`}>{verdict}</span>
        </div>
        {report.kind === "goalie" ? (
          <p className="mt-0.5 text-[11px] tabular text-muted">
            {c.luckGaVsXga} {fmt1(report.goalsAgainst)} / {fmt1(report.xGoalsAgainst)} (
            {fmtSigned(
              report.goalsAgainst != null && report.xGoalsAgainst != null
                ? report.goalsAgainst - report.xGoalsAgainst
                : null,
            )}
            )
          </p>
        ) : (
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <MiniMetric label={c.ftSh5} metric={report.sh5v5} pct />
            <MiniMetric label={c.ftIpp} metric={report.ipp} pct />
            <MiniMetric label={c.ftPpIpp} metric={report.ppIpp} pct />
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-[#08141d] px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{c.ftTitle}</h3>
        <span className="text-[10px] text-muted">{c.luckSeason}</span>
      </div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{verdict}</div>
      <p className="mt-1 text-xs leading-snug text-white/80">{whyText(c, report.why)}</p>
      {report.kind === "goalie" ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label={c.luckGaVsXga}
            value={`${fmt1(report.goalsAgainst)} / ${fmt1(report.xGoalsAgainst)}`}
            hint={fmtSigned(
              report.goalsAgainst != null && report.xGoalsAgainst != null
                ? report.goalsAgainst - report.xGoalsAgainst
                : null,
            )}
          />
          <Stat
            label={c.luckSavePct}
            value={report.savePct != null ? `${fmt1(report.savePct)}%` : "—"}
            hint={
              report.expectedSavePct != null ? `${c.luckExpected} ${fmt1(report.expectedSavePct)}%` : undefined
            }
          />
          <Stat label={c.luckGp} value={String(report.gamesPlayed)} />
        </dl>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <TrendStat label={c.ftSh5} metric={report.sh5v5} vs={c.ftVsPrior} pct />
            <TrendStat label={c.ftIpp} metric={report.ipp} vs={c.ftVsPrior} pct />
            <TrendStat label={c.ftPpIpp} metric={report.ppIpp} vs={c.ftVsPrior} pct />
          </dl>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <TrendStat label={c.ftIpp5} metric={report.ipp5v5} vs={c.ftVsPrior} pct />
            <Stat
              label={c.luckGoalsVsXg}
              value={`${fmt1(report.goals)} / ${fmt1(report.xGoals)}`}
              hint={fmtSigned(report.goalsMinusXg)}
            />
            <Stat label={c.luckPdo} value={report.pdo != null ? fmt1(report.pdo) : "—"} hint="SH%+SV%" />
            <Stat
              label={c.ftOnIceSh}
              value={fmtPct(report.onIceSh5v5)}
            />
            <Stat
              label={c.ftToi5}
              value={report.toi5v5 != null ? `${fmt1(report.toi5v5)} min` : "—"}
            />
            <Stat
              label={c.ftToiPp}
              value={report.toiPp != null ? `${fmt1(report.toiPp)} min` : "—"}
            />
          </dl>
          <p className="mt-2 text-[10px] tabular text-muted">
            {c.ftTrend}: {yearBits}
            {report.sh5v5.trend.length ? ` · ${c.ftSh5} ${fmtTrend(report.sh5v5.trend)}` : ""}
            {report.ipp.trend.length ? ` · ${c.ftIpp} ${fmtTrend(report.ipp.trend)}` : ""}
            {report.ppIpp.trend.length ? ` · ${c.ftPpIpp} ${fmtTrend(report.ppIpp.trend)}` : ""}
          </p>
        </>
      )}
      <p className="mt-2 text-[10px] leading-snug text-muted">
        {report.kind === "goalie" ? `${c.luckGoalieHint} ` : `${c.ftNotDobber} `}
        {c.luckFootnote} {c.luckSource}
      </p>
    </section>
  );
}

function MiniMetric({
  label,
  metric,
  pct,
}: {
  label: string;
  metric: TrendMetric;
  pct?: boolean;
}) {
  const show = pct ? fmtPct(metric.current) : fmt1(metric.current);
  return (
    <div>
      <div className="text-[10px] leading-tight text-muted">{label}</div>
      <div className="text-sm font-semibold tabular text-white">{show}</div>
      <div className={`text-[10px] tabular ${deltaClass(metric.delta)}`}>
        {metric.delta == null ? "Δ —" : `Δ ${fmtSigned(metric.delta)}`}
      </div>
      {metric.trend.some((v) => v != null) && (
        <div className="text-[10px] tabular text-muted">{fmtTrend(metric.trend)}</div>
      )}
    </div>
  );
}

function TrendStat({
  label,
  metric,
  vs,
  pct,
}: {
  label: string;
  metric: TrendMetric;
  vs: string;
  pct?: boolean;
}) {
  const hintParts = [
    metric.delta != null ? `Δ ${fmtSigned(metric.delta)} ${vs}` : null,
    metric.delta2 != null ? `Δ2 ${fmtSigned(metric.delta2)}` : null,
  ].filter(Boolean);
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2">
      <dt className="text-[10px] leading-tight text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular text-white">
        {pct ? fmtPct(metric.current) : fmt1(metric.current)}
      </dd>
      {hintParts.length > 0 && (
        <div className={`text-[10px] tabular ${deltaClass(metric.delta)}`}>{hintParts.join(" · ")}</div>
      )}
      {metric.trend.some((v) => v != null) && (
        <div className="text-[10px] tabular text-muted">{fmtTrend(metric.trend)}</div>
      )}
    </div>
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
