"use client";

import { t } from "@/lib/i18n";
import { FANTASY_POSITIONS } from "@/lib/types";
import type {
  FantasyPosition,
  Lang,
  LeagueProfile,
  NhlGame,
  NhlPayload,
  NhlPlayer,
  RosterPlayer,
} from "@/lib/types";
import { activeRosterLimit, totalRosterLimit } from "@/lib/defaults";
import { PlayerRow } from "./PlayerBits";
import { PlayerSearch } from "./PlayerSearch";

const ORDER: FantasyPosition[] = [...FANTASY_POSITIONS];

export function RosterPanel({
  lang,
  data,
  profile,
  onAdd,
  onRemove,
  onTogglePos,
  onEditYahoo,
  onPaste,
  onClear,
}: {
  lang: Lang;
  data: NhlPayload;
  profile: LeagueProfile;
  onAdd: (player: NhlPlayer) => void;
  onRemove: (id: number) => void;
  onTogglePos: (id: number, pos: FantasyPosition) => void;
  onEditYahoo: (id: number) => void;
  onPaste: () => void;
  onClear: () => void;
}) {
  const c = t(lang);
  const byId = new Map(data.players.map((p) => [p.id, p]));
  const cap = totalRosterLimit(profile.slots);
  const activeCap = activeRosterLimit(profile.slots);
  // Group by primary (first) eligibility for a stable list.
  const byPrimary = new Map<FantasyPosition, RosterPlayer[]>();
  for (const pos of ORDER) byPrimary.set(pos, []);
  for (const r of profile.roster) {
    const primary = r.positions[0] ?? "C";
    byPrimary.get(primary)?.push(r);
  }

  const rosterIds = new Set(profile.roster.map((r) => r.id));
  const over = profile.roster.length > cap;

  function gamesFor(r: RosterPlayer): NhlGame[] {
    const nhl = byId.get(r.id);
    if (!nhl) return [];
    const all = data.teamGames[nhl.team] ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return all.filter((g) => g.date >= today);
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-panel/80">
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">{c.rosterStep}</h2>
          <p className={`text-xs tabular ${over ? "text-bad" : "text-muted"}`}>
            {profile.roster.length}/{cap} · {c.active} {activeCap}
            {over ? ` · ${c.overflow}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPaste}
            className="rounded-md px-2 py-1 text-xs text-muted hover:text-ice"
          >
            {c.paste}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-xs text-muted hover:text-bad"
          >
            {c.clearRoster}
          </button>
        </div>
      </header>
      <div className="px-4 py-3">
        <PlayerSearch
          lang={lang}
          players={data.players}
          onPick={onAdd}
          placeholder={c.searchPlayer}
          excludeIds={rosterIds}
          size="lg"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {profile.roster.length === 0 ? (
          <p className="px-1 py-5 text-sm leading-relaxed text-white/80">{c.rosterEmpty}</p>
        ) : (
          ORDER.map((pos) => {
            const rows = byPrimary.get(pos) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={pos} className="mb-3">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="font-mono text-[11px] text-ice/90">{pos}</span>
                  <span className="text-[11px] tabular text-muted">
                    {rows.length}/{profile.slots[pos]}
                  </span>
                </div>
                {rows.map((r) => (
                  <PlayerRow
                    key={r.id}
                    nhl={byId.get(r.id)}
                    roster={r}
                    games={gamesFor(r)}
                    lang={lang}
                    onRemove={() => onRemove(r.id)}
                    onTogglePos={(p) => onTogglePos(r.id, p)}
                    onEditYahoo={() => onEditYahoo(r.id)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
