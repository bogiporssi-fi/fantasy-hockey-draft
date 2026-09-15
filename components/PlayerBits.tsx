"use client";

import { t } from "@/lib/i18n";
import type { FantasyPosition, Lang, NhlGame, NhlPlayer, RosterPlayer } from "@/lib/types";
import { YahooEligibilityBox } from "./YahooPositionSheet";

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
  onEditYahoo,
}: {
  nhl: NhlPlayer | undefined;
  roster: RosterPlayer;
  games: NhlGame[];
  lang: Lang;
  onRemove: () => void;
  onTogglePos: (pos: FantasyPosition) => void;
  onEditYahoo: () => void;
}) {
  const c = t(lang);
  const name = nhl?.fullName ?? `#${roster.id}`;
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-transparent px-1 py-1.5 hover:border-line hover:bg-white/[0.03]">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-white">{name}</span>
          <span className="font-mono text-[11px] text-ice/70">{nhl?.team ?? "?"}</span>
        </div>
        <YahooEligibilityBox
          lang={lang}
          selected={roster.positions}
          nhlPosition={nhl?.position}
          onToggle={onTogglePos}
          onEdit={onEditYahoo}
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
