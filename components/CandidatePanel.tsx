"use client";

import { t } from "@/lib/i18n";
import { formatDay, formatRange } from "@/lib/weeks";
import { formatEligibility } from "@/lib/positions";
import type {
  CandidateMetrics,
  FantasyPosition,
  Lang,
  NhlPlayer,
  NightOutcome,
  WeekWindow,
} from "@/lib/types";
import { MiniGames } from "./PlayerBits";
import { PlayerSearch } from "./PlayerSearch";
import { YahooEligibilityBox } from "./YahooPositionSheet";

function Heatmap({
  weeks,
  nights,
  weekStartsOn,
  lang,
}: {
  weeks: WeekWindow[];
  nights: NightOutcome[];
  weekStartsOn: 0 | 1;
  lang: Lang;
}) {
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const labels =
    weekStartsOn === 1
      ? lang === "fi"
        ? ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"]
        : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
      : lang === "fi"
        ? ["Su", "Ma", "Ti", "Ke", "To", "Pe", "La"]
        : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[3rem_repeat(7,1.55rem)] gap-1 text-[10px] text-muted">
        <div />
        {labels.map((l) => (
          <div key={l} className="text-center">
            {l}
          </div>
        ))}
        {weeks.map((w) => (
          <WeekRow key={w.start} week={w} byDate={byDate} />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  week,
  byDate,
}: {
  week: WeekWindow;
  byDate: Map<string, NightOutcome>;
}) {
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = week.start.split("-").map(Number);
    const dt = new Date(y, m - 1, d + i);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const night = byDate.get(iso);
    let cls = "bg-white/5";
    let title = iso;
    if (night?.result === "useful") {
      cls = "bg-good/80";
      title = `${iso} useful ${night.slot}`;
    } else if (night?.result === "bench") {
      cls = "bg-bad/80";
      title = `${iso} bench`;
    }
    cells.push(<div key={iso} title={title} className={`h-5 w-5 rounded-sm ${cls}`} />);
  }
  return (
    <>
      <div className="self-center text-[10px] text-muted">{week.index}</div>
      {cells}
    </>
  );
}

function WeekTable({ metrics, lang }: { metrics: CandidateMetrics; lang: Lang }) {
  const c = t(lang);
  const rows = metrics.byWeek.filter((w) => w.candidateGames > 0);
  if (rows.length === 0) return null;
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-[#0d1c28] text-[10px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-2 py-2">{c.week}</th>
            <th className="px-2 py-2">{c.games}</th>
            <th className="px-2 py-2">{c.usefulShort}</th>
            <th className="px-2 py-2">{c.benchShort}</th>
            <th className="px-2 py-2">{c.rosterGames}</th>
            <th className="px-2 py-2">{c.holes}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.week.start} className="border-t border-line/70">
              <td className="px-2 py-1.5 tabular text-muted">
                {row.week.index}{" "}
                <span className="text-white/80">{formatRange(row.week.start, row.week.end, lang)}</span>
              </td>
              <td className="px-2 py-1.5 tabular">{row.candidateGames}</td>
              <td className="px-2 py-1.5 tabular text-good">{row.useful}</td>
              <td className="px-2 py-1.5 tabular text-bad">{row.bench}</td>
              <td className="px-2 py-1.5 tabular">{row.rosterPlayerGames}</td>
              <td className="px-2 py-1.5 tabular">{row.emptyEligibleNights}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NightList({ nights, lang }: { nights: NightOutcome[]; lang: Lang }) {
  const upcoming = nights.slice(0, 12);
  return (
    <ul className="space-y-1 text-xs">
      {upcoming.map((n) => (
        <li key={n.date} className="flex items-center justify-between gap-2">
          <span className="text-muted">{formatDay(n.date, lang)}</span>
          <span className="flex-1 truncate text-white/80">
            {n.home ? "vs" : "@"} {n.opponent}
          </span>
          <span className={`font-mono ${n.result === "useful" ? "text-good" : "text-bad"}`}>
            {n.result === "useful" ? n.slot : "BN"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CandidatePanel({
  lang,
  players,
  excludeIds,
  player,
  positions,
  metrics,
  weeks,
  weekStartsOn,
  games,
  onAddToCompare,
  onTogglePos,
  onEditYahoo,
  onAddToRoster,
}: {
  lang: Lang;
  players: NhlPlayer[];
  excludeIds: Set<number>;
  player: NhlPlayer | null;
  positions: FantasyPosition[];
  metrics: CandidateMetrics | null;
  weeks: WeekWindow[];
  weekStartsOn: 0 | 1;
  games: { date: string; opponent: string; home: boolean }[];
  onAddToCompare: (p: NhlPlayer) => void;
  onTogglePos: (pos: FantasyPosition) => void;
  onEditYahoo: () => void;
  onAddToRoster: () => void;
}) {
  const c = t(lang);
  const upcoming = games.filter((g) => g.date >= new Date().toISOString().slice(0, 10));

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-panel/80">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-white">{c.candidate}</h2>
        <p className="text-xs text-muted">{c.compareHint}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
        <PlayerSearch
          lang={lang}
          players={players}
          onPick={onAddToCompare}
          placeholder={c.compareSearch}
          excludeIds={excludeIds}
        />

        {!player && <p className="text-sm text-muted">{c.noCandidate}</p>}

        {player && metrics && (
          <>
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <div className="text-lg font-semibold text-white">
                  {player.fullName}{" "}
                  <span className="font-mono text-sm text-ice/80">
                    {player.team} · {formatEligibility(positions)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onAddToRoster}
                  className="rounded-md border border-ice/40 px-2 py-0.5 text-[11px] text-ice hover:bg-ice/10"
                >
                  {c.add}
                </button>
              </div>
              <div className="mt-2">
                <YahooEligibilityBox
                  lang={lang}
                  selected={positions}
                  nhlPosition={player.position}
                  onToggle={onTogglePos}
                  onEdit={onEditYahoo}
                />
              </div>
              <MiniGames games={upcoming} lang={lang} />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-[#08141d] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">{c.usefulStarts}</div>
                <div className="mt-1 text-2xl font-semibold tabular text-good">{metrics.usefulStarts}</div>
                <div className="mt-1 text-xs text-muted">
                  {metrics.totalGames} {c.games.toLowerCase()}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-[#08141d] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">{c.forcedBench}</div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular ${metrics.forcedBenchNights > 0 ? "text-bad" : "text-white"}`}
                >
                  {metrics.forcedBenchNights}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-[#08141d] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">{c.complementarity}</div>
                <div className="mt-1 text-2xl font-semibold tabular">{metrics.complementarity}</div>
                <div className="mt-1 text-xs text-muted">0–100</div>
              </div>
              <div className="rounded-xl border border-line bg-[#08141d] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">{c.utilization}</div>
                <div className="mt-1 text-2xl font-semibold tabular">
                  {Math.round(metrics.utilization * 100)}%
                </div>
              </div>
            </div>

            <WeekTable metrics={metrics} lang={lang} />
            <div className="flex flex-wrap gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-good/80" /> {c.legendUseful}
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-bad/80" /> {c.legendBench}
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-white/5" /> {c.legendOff}
              </span>
            </div>
            <Heatmap weeks={weeks} nights={metrics.nights} weekStartsOn={weekStartsOn} lang={lang} />
            <div>
              <h3 className="mb-2 text-[11px] uppercase tracking-wide text-muted">{c.next}</h3>
              <NightList nights={metrics.nights} lang={lang} />
            </div>
            {games.length === 0 && <p className="text-sm text-bad">{c.noGames}</p>}
          </>
        )}

        <details className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
          <summary className="cursor-pointer text-white/90">{c.howTitle}</summary>
          <p className="mt-2 leading-relaxed">{c.howBody}</p>
          <p className="mt-2 leading-relaxed">{c.goalieNote}</p>
        </details>
      </div>
    </section>
  );
}
