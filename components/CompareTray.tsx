"use client";

import { MiniGames } from "./PlayerBits";
import { PlayerSearch } from "./PlayerSearch";
import { YahooEligibilityBox } from "./YahooPositionSheet";
import { LuckPanel } from "./LuckPanel";
import { t } from "@/lib/i18n";
import { formatEligibility } from "@/lib/positions";
import type { LuckReport } from "@/lib/luck";
import type {
  CandidateMetrics,
  FantasyPosition,
  Lang,
  NhlGame,
  NhlPlayer,
} from "@/lib/types";

export interface CompareEntryView {
  id: number;
  positions: FantasyPosition[];
  player: NhlPlayer | undefined;
  metrics: CandidateMetrics | null;
  games: NhlGame[];
  luck?: LuckReport | null;
}

export function CompareTray({
  lang,
  players,
  entries,
  focusedId,
  luckLoading,
  onAdd,
  onFocus,
  onRemove,
  onClear,
  onTogglePos,
  onEditYahoo,
  onAddToRoster,
}: {
  lang: Lang;
  players: NhlPlayer[];
  entries: CompareEntryView[];
  focusedId: number | null;
  luckLoading?: boolean;
  onAdd: (player: NhlPlayer) => void;
  onFocus: (id: number) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onTogglePos: (id: number, pos: FantasyPosition) => void;
  onEditYahoo: (id: number) => void;
  onAddToRoster: (id: number) => void;
}) {
  const c = t(lang);
  const inTray = new Set(entries.map((e) => e.id));
  const bestUseful =
    entries.length > 0
      ? Math.max(...entries.map((e) => e.metrics?.usefulStarts ?? -1))
      : -1;

  return (
    <section className="rounded-2xl border-2 border-ice/35 bg-[#0b1822] pb-[env(safe-area-inset-bottom)] shadow-[0_12px_40px_rgba(0,0,0,0.35)] lg:bg-panel/90">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-3 sm:px-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">{c.compareStep}</h2>
          <p className="text-xs text-muted">
            {entries.length} {c.candidatesCount} · {c.compareHint}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={entries.length === 0}
          className="min-h-10 rounded-md px-3 text-sm text-muted hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          {c.clearCompare}
        </button>
      </header>
      <div className="space-y-3 px-3 py-3 sm:px-4">
        <PlayerSearch
          lang={lang}
          players={players}
          onPick={onAdd}
          placeholder={c.compareSearch}
          excludeIds={inTray}
          size="lg"
        />
        {entries.length === 0 ? (
          <p className="pb-3 text-sm leading-relaxed text-white/80">{c.compareEmpty}</p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-3 overflow-auto lg:max-h-none lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => {
              const name = entry.player?.fullName ?? `#${entry.id}`;
              const m = entry.metrics;
              const selected = focusedId === entry.id;
              const isBest =
                m != null && bestUseful >= 0 && m.usefulStarts === bestUseful && entries.length > 1;
              return (
                <li key={entry.id}>
                  <div
                    className={`w-full rounded-xl border px-3 py-2.5 text-left ${
                      selected ? "border-ice/70 bg-ice/10" : "border-line bg-[#08141d]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onFocus(entry.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium text-white">{name}</div>
                        <div className="font-mono text-[11px] text-ice/80">
                          {entry.player?.team ?? "?"} · {formatEligibility(entry.positions)}
                          {isBest && (
                            <span className="ml-2 text-[10px] uppercase text-good">{c.bestFit}</span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(entry.id)}
                        className="min-h-9 min-w-9 text-lg text-muted hover:text-bad"
                        aria-label={c.remove}
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2">
                      <YahooEligibilityBox
                        lang={lang}
                        selected={entry.positions}
                        nhlPosition={entry.player?.position}
                        onToggle={(pos) => onTogglePos(entry.id, pos)}
                        onEdit={() => onEditYahoo(entry.id)}
                      />
                    </div>
                    {m && (
                      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div title={c.usefulHint}>
                          <dt className="text-[11px] leading-tight text-muted hyphens-none">{c.usefulCard}</dt>
                          <dd className="text-xl font-semibold tabular text-good">{m.usefulStarts}</dd>
                        </div>
                        <div title={c.benchHint}>
                          <dt className="text-[11px] leading-tight text-muted hyphens-none">{c.benchCard}</dt>
                          <dd className="text-xl font-semibold tabular text-bad">
                            {m.forcedBenchNights}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-1" title={c.compHint}>
                          <dt className="text-[11px] leading-tight text-muted hyphens-none">{c.complementarity}</dt>
                          <dd className="text-sm font-semibold tabular">
                            {m.complementarity}
                            <span className="ml-1 text-[11px] font-normal text-muted">/ 100</span>
                          </dd>
                        </div>
                      </dl>
                    )}
                    <LuckPanel
                      lang={lang}
                      report={entry.luck}
                      loading={luckLoading && entry.luck === undefined}
                      compact
                    />
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => onAddToRoster(entry.id)}
                        className="min-h-10 rounded-lg bg-ice/15 px-3 text-sm font-medium text-ice"
                      >
                        {c.add}
                      </button>
                    </div>
                    <MiniGames games={entry.games.slice(0, 3)} lang={lang} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
