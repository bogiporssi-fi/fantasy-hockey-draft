"use client";

import { t } from "@/lib/i18n";
import { FANTASY_POSITIONS } from "@/lib/types";
import type { FantasyPosition, Lang, NhlGame, NhlPlayer, RosterPlayer } from "@/lib/types";

export function PositionPills({
  selected,
  onToggle,
  size = "md",
  labeled,
  lang,
}: {
  selected: FantasyPosition[];
  onToggle: (pos: FantasyPosition) => void;
  size?: "sm" | "md";
  labeled?: boolean;
  lang?: Lang;
}) {
  const c = lang ? t(lang) : null;
  const tap =
    size === "md"
      ? "min-h-9 min-w-10 px-2.5 py-1.5 text-xs"
      : "px-1.5 py-0.5 text-[10px]";
  return (
    <div className="flex flex-col gap-1">
      {labeled && c && (
        <span className="text-[10px] uppercase tracking-wide text-muted">{c.positions}</span>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label={c?.positions ?? "Yahoo"}>
        {FANTASY_POSITIONS.map((pos) => {
          const on = selected.includes(pos);
          return (
            <button
              key={pos}
              type="button"
              onClick={() => onToggle(pos)}
              aria-pressed={on}
              className={`rounded-md font-mono tracking-wide ${tap} ${
                on ? "bg-ice/25 text-ice ring-1 ring-ice/50" : "bg-white/5 text-muted hover:text-white"
              }`}
            >
              {pos}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MiniGames({ games, lang }: { games: NhlGame[]; lang: Lang }) {
  const next = games.slice(0, 4);
  if (next.length === 0) return null;
  return (
    <p className="text-[11px] text-muted">
      {t(lang).next}:{" "}
      {next.map((g, i) => (
        <span key={g.date}>
          {i > 0 && " · "}
          {g.date.slice(5)} {g.home ? "vs" : "@"} {g.opponent}
        </span>
      ))}
    </p>
  );
}

export function PlayerRow({
  nhl,
  roster,
  games,
  lang,
  onRemove,
  onTogglePos,
}: {
  nhl: NhlPlayer | undefined;
  roster: RosterPlayer;
  games: NhlGame[];
  lang: Lang;
  onRemove: () => void;
  onTogglePos: (pos: FantasyPosition) => void;
}) {
  const c = t(lang);
  const name = nhl?.fullName ?? `#${roster.id}`;
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-transparent px-1 py-1.5 hover:border-line hover:bg-white/[0.03]">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-white">{name}</span>
          <span className="font-mono text-[11px] text-ice/70">{nhl?.team ?? "?"}</span>
          <span className="text-[10px] text-muted">
            {c.nhlPos} {nhl?.position}
          </span>
        </div>
        <PositionPills
          selected={roster.positions}
          onToggle={onTogglePos}
          size="md"
          labeled
          lang={lang}
        />
        <MiniGames games={games} lang={lang} />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="min-h-9 min-w-9 shrink-0 text-lg text-muted hover:text-bad"
        aria-label={c.remove}
      >
        ×
      </button>
    </div>
  );
}
