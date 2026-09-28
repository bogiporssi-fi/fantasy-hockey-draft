"use client";

import { injuryBadgeMeta, isLongTermIr } from "@/lib/injury";
import { t } from "@/lib/i18n";
import type { FantasyPosition, Lang, NhlGame, NhlPlayer, PlayerInjury, RosterPlayer } from "@/lib/types";
import { YahooEligibilityBox } from "./YahooPositionSheet";

export function InjuryBadge({
  lang,
  injury,
  size = "md",
}: {
  lang: Lang;
  injury?: PlayerInjury | null;
  size?: "sm" | "md";
}) {
  const meta = injuryBadgeMeta(injury?.code);
  if (!injury || !meta) return null;
  const c = t(lang);
  const hint = injury.note ? `${c[meta.hint]} (${injury.note})` : c[meta.hint];
  const tone = isLongTermIr(injury.code) ? "bg-bad text-white" : "bg-warn text-[#2a2208]";
  const sizing = size === "sm" ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      title={hint}
      aria-label={hint}
      className={`inline-flex shrink-0 items-center rounded font-semibold uppercase leading-none tracking-wide ${tone} ${sizing}`}
    >
      {c[meta.label]}
    </span>
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
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-white">{name}</span>
          <InjuryBadge lang={lang} injury={nhl?.injury} />
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
