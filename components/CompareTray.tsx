"use client";

import { MiniGames } from "./PlayerBits";
import { PlayerSearch } from "./PlayerSearch";
import { YahooEligibilityBox } from "./YahooPositionSheet";
import { t } from "@/lib/i18n";
import { formatEligibility } from "@/lib/positions";
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
}

export function CompareTray({
  lang,
  players,
  entries,
  focusedId,
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
    <section className="sticky bottom-0 z-20 mt-4 rounded-t-2xl border border-line bg-[#0b1822]/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_rgba(0,0,0,0.45)] backdrop-blur lg:static lg:rounded-2xl lg:bg-panel/80 lg:shadow-none">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-white">{c.compareTray}</h2>
          <p className="text-[11px] text-muted">
            {entries.length} · {c.compareHint}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={entries.length === 0}
          className="min-h-9 rounded-md border border-line px-3 text-sm text-ice hover:bg-ice/10 disabled:opacity-40"
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
        />
        {entries.length === 0 ? (
          <p className="pb-2 text-sm text-muted">{c.compareEmpty}</p>
        ) : (
          <ul className="flex max-h-[42vh] flex-col gap-2 overflow-auto lg:max-h-none lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => {
              const name = entry.player?.fullName ?? `#${entry.id}`;
              const m = entry.metrics;
              const selected = focusedId === entry.id;
              const isBest =
                m != null && bestUseful >= 0 && m.usefulStarts === bestUseful && entries.length > 1;
              return (
                <li key={entry.id}>
                  <div
                    className={`w-full rounded-xl border px-3 py-2 text-left ${
                      selected ? "border-ice/60 bg-ice/10" : "border-line bg-[#08141d]"
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
                          {entry.player && (
                            <span className="ml-1 text-muted">
                              {c.nhlPos} {entry.player.position}
                            </span>
                          )}
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
                      <dl className="mt-2 grid grid-cols-4 gap-1 text-center">
                        <div>
                          <dt className="text-[9px] uppercase text-muted">{c.usefulShort}</dt>
                          <dd className="text-sm font-semibold tabular text-good">{m.usefulStarts}</dd>
                        </div>
                        <div>
                          <dt className="text-[9px] uppercase text-muted">{c.benchShort}</dt>
                          <dd className="text-sm font-semibold tabular text-bad">
                            {m.forcedBenchNights}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[9px] uppercase text-muted">{c.compShort}</dt>
                          <dd className="text-sm font-semibold tabular">{m.complementarity}</dd>
                        </div>
                        <div>
                          <dt className="text-[9px] uppercase text-muted">{c.games}</dt>
                          <dd className="text-sm font-semibold tabular">{m.totalGames}</dd>
                        </div>
                      </dl>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onAddToRoster(entry.id)}
                        className="rounded-md border border-ice/40 px-2 py-1 text-[11px] text-ice"
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
