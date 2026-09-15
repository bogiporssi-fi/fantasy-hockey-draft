"use client";

import { t } from "@/lib/i18n";
import { formatEligibility } from "@/lib/positions";
import { FANTASY_POSITIONS } from "@/lib/types";
import type { FantasyPosition, Lang, NhlPlayer } from "@/lib/types";

export function YahooPositionSheet({
  lang,
  player,
  positions,
  onToggle,
  onConfirm,
  onCancel,
  confirmLabel,
}: {
  lang: Lang;
  player: NhlPlayer;
  positions: FantasyPosition[];
  onToggle: (pos: FantasyPosition) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
}) {
  const c = t(lang);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl border border-line bg-[#0b1822] p-5 shadow-2xl sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-white">{c.yahooSheetTitle}</h2>
        <p className="mt-1 text-base font-medium text-ice">
          {player.fullName}{" "}
          <span className="font-mono text-sm text-ice/80">{player.team}</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">{c.yahooSheetHelp}</p>
        <p className="mt-1 text-xs text-muted">
          {c.yahooSheetNhl}: <span className="font-mono text-white/80">{player.position}</span> —{" "}
          {c.yahooNotLocked}
        </p>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {FANTASY_POSITIONS.map((pos) => {
            const on = positions.includes(pos);
            return (
              <button
                key={pos}
                type="button"
                onClick={() => onToggle(pos)}
                aria-pressed={on}
                className={`min-h-14 rounded-xl font-mono text-sm font-semibold ${
                  on
                    ? "bg-ice text-rink ring-2 ring-white/30"
                    : "border border-line bg-[#08141d] text-muted"
                }`}
              >
                {pos}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-white">
          {c.positions}:{" "}
          <span className="font-mono text-ice">{formatEligibility(positions)}</span>
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-lg border border-line text-sm text-muted"
          >
            {c.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 flex-1 rounded-lg bg-ice text-sm font-medium text-rink"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function YahooEligibilityBox({
  lang,
  selected,
  nhlPosition,
  onToggle,
  onEdit,
}: {
  lang: Lang;
  selected: FantasyPosition[];
  nhlPosition: FantasyPosition | undefined;
  onToggle: (pos: FantasyPosition) => void;
  onEdit: () => void;
}) {
  const c = t(lang);
  return (
    <div className="mt-1.5 rounded-lg border border-ice/35 bg-ice/[0.07] p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ice">
          {c.positions}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="min-h-8 rounded-md bg-ice/20 px-2 text-[11px] font-medium text-ice"
        >
          {c.editYahoo}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FANTASY_POSITIONS.map((pos) => {
          const on = selected.includes(pos);
          return (
            <button
              key={pos}
              type="button"
              onClick={() => onToggle(pos)}
              aria-pressed={on}
              className={`min-h-10 min-w-11 rounded-md font-mono text-xs font-semibold ${
                on ? "bg-ice text-rink" : "bg-black/30 text-muted"
              }`}
            >
              {pos}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-muted">
        {c.nhlPos} {nhlPosition ?? "—"} · {c.yahooNotLocked} · {formatEligibility(selected)}
      </p>
    </div>
  );
}
