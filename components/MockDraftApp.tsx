"use client";

import { AppNav, LuistinLogo } from "@/components/AppNav";
import { t } from "@/lib/i18n";
import {
  applyPick,
  assignSlot,
  chooseBotPick,
  createEmptyRosters,
  MOCK_ROUNDS,
  MOCK_SLOT_LIMITS,
  MOCK_TEAM_COUNT,
  MOCK_TOTAL_PICKS,
  pickIndexForTeamRound,
  remainingSlots,
  roundOfPick,
  snakeTeamIndex,
  sortByAdp,
  type MockDraftPickRecord,
  type MockPlayer,
  type MockSlot,
  type TeamRoster,
} from "@/lib/mockDraft";
import { normalizeName } from "@/lib/names";
import { getServerStateSnapshot, getStateSnapshot, setAppState, subscribeState } from "@/lib/storage";
import type { FantasyPosition, Lang } from "@/lib/types";
import type { YahooPlayersPayload } from "@/lib/yahooPlayers";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";

type Phase = "setup" | "drafting" | "done";

interface DraftState {
  pickIndex: number;
  rosters: TeamRoster[];
  remaining: MockPlayer[];
  board: (MockDraftPickRecord | null)[];
  lastPick: MockDraftPickRecord | null;
}

const FILTERS: Array<FantasyPosition | "ALL"> = ["ALL", "C", "LW", "RW", "D", "G"];
const SLOT_ORDER: MockSlot[] = ["C", "LW", "RW", "D", "G", "BN"];
const BOT_DELAY_MS = 1100;

function emptyDraft(pool: MockPlayer[] = []): DraftState {
  return {
    pickIndex: 0,
    rosters: createEmptyRosters(),
    remaining: pool,
    board: Array.from({ length: MOCK_TOTAL_PICKS }, () => null),
    lastPick: null,
  };
}

function formatAdp(adp: number | null, lang: Lang): string {
  if (adp == null) return "—";
  return adp.toLocaleString(lang === "fi" ? "fi-FI" : "en-CA", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function posLabel(positions: FantasyPosition[]): string {
  return positions.join("/");
}

export function MockDraftApp() {
  const appState = useSyncExternalStore(subscribeState, getStateSnapshot, getServerStateSnapshot);
  const lang: Lang = appState.lang;
  const c = t(lang);

  const [pool, setPool] = useState<MockPlayer[] | null>(null);
  const [meta, setMeta] = useState<Pick<YahooPlayersPayload, "gameKey" | "season" | "fetchedAt"> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slot, setSlot] = useState(1);
  const [phase, setPhase] = useState<Phase>("setup");
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft());
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<FantasyPosition | "ALL">("ALL");
  const userColumnRef = useRef<HTMLDivElement | null>(null);

  function loadPlayers() {
    setLoading(true);
    fetch("/api/yahoo/players")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Yahoo error");
        const payload = json as YahooPlayersPayload;
        setPool(payload.players);
        setMeta({
          gameKey: payload.gameKey,
          season: payload.season,
          fetchedAt: payload.fetchedAt,
        });
        setLoadError(null);
      })
      .catch(() => {
        setPool(null);
        setLoadError(c.mockYahooError);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/yahoo/players", { signal: ac.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Yahoo error");
        const payload = json as YahooPlayersPayload;
        setPool(payload.players);
        setMeta({
          gameKey: payload.gameKey,
          season: payload.season,
          fetchedAt: payload.fetchedAt,
        });
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setPool(null);
        setLoadError(err instanceof Error ? c.mockYahooError : c.mockYahooError);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; copy is lang-stable enough
  }, []);

  const userIndex = slot - 1;
  const currentTeam = snakeTeamIndex(draft.pickIndex);
  const isUserTurn = phase === "drafting" && draft.pickIndex < MOCK_TOTAL_PICKS && currentTeam === userIndex;
  const userRoster = draft.rosters[userIndex];
  const userRemaining = userRoster ? remainingSlots(userRoster.filled) : remainingSlots(createEmptyRosters()[0].filled);

  useEffect(() => {
    if (phase !== "drafting") return;
    if (draft.pickIndex >= MOCK_TOTAL_PICKS) {
      setPhase("done");
      return;
    }
    if (snakeTeamIndex(draft.pickIndex) === userIndex) return;
    const timer = window.setTimeout(() => {
      setDraft((prev) => {
        if (prev.pickIndex >= MOCK_TOTAL_PICKS) return prev;
        const teamIndex = snakeTeamIndex(prev.pickIndex);
        if (teamIndex === userIndex) return prev;
        const roster = prev.rosters[teamIndex];
        const player = chooseBotPick(prev.remaining, remainingSlots(roster.filled));
        if (!player) return prev;
        return commit(prev, player, "bot");
      });
    }, BOT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase, draft.pickIndex, userIndex]);

  useEffect(() => {
    if (phase !== "drafting") return;
    userColumnRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [phase, draft.pickIndex]);

  const visiblePlayers = useMemo(() => {
    const q = normalizeName(query);
    return sortByAdp(draft.remaining).filter((p) => {
      if (posFilter !== "ALL" && !p.positions.includes(posFilter)) return false;
      if (!q) return true;
      return (
        normalizeName(p.name).includes(q) ||
        normalizeName(p.lastName).includes(q) ||
        normalizeName(p.team).includes(q)
      );
    });
  }, [draft.remaining, query, posFilter]);

  function startDraft() {
    if (!pool || pool.length === 0) return;
    setQuery("");
    setPosFilter("ALL");
    setDraft(emptyDraft(pool));
    setPhase("drafting");
  }

  function pickHuman(player: MockPlayer) {
    if (!isUserTurn) return;
    setQuery("");
    setDraft((prev) => {
      if (snakeTeamIndex(prev.pickIndex) !== userIndex) return prev;
      const roster = prev.rosters[userIndex];
      if (!assignSlot(player.positions, remainingSlots(roster.filled))) return prev;
      if (!prev.remaining.some((p) => p.id === player.id)) return prev;
      return commit(prev, player, "human");
    });
  }

  function restart() {
    setPhase("setup");
    setDraft(emptyDraft(pool ?? []));
    setQuery("");
    setPosFilter("ALL");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-3 py-3 sm:px-5 sm:py-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <LuistinLogo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">{c.mockTitle}</h1>
            <p className="text-xs text-muted">{c.mockTagline}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppNav lang={lang} active="mock" />
          <div className="flex rounded-lg border border-line text-xs">
            {(["fi", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setAppState({ ...appState, lang: code })}
                className={`px-2 py-1.5 uppercase ${appState.lang === code ? "bg-ice/20 text-ice" : "text-muted"}`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading && (
        <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-muted">
          {c.mockYahooLoading}
        </p>
      )}
      {loadError && !loading && (
        <div className="rounded-xl border border-bad/40 bg-panel px-4 py-8 text-center">
          <p className="text-sm text-bad">{c.mockYahooError}</p>
          <button
            type="button"
            onClick={loadPlayers}
            className="mt-3 rounded-md bg-ice px-3 py-1.5 text-sm text-rink"
          >
            {c.retry}
          </button>
        </div>
      )}

      {pool && !loading && phase === "setup" && (
        <Setup
          lang={lang}
          slot={slot}
          onSlot={setSlot}
          onStart={startDraft}
          playerCount={pool.length}
          season={meta?.season}
        />
      )}

      {pool && phase !== "setup" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <StatusBar
            lang={lang}
            phase={phase}
            pickIndex={draft.pickIndex}
            isUserTurn={isUserTurn}
            lastPick={draft.lastPick}
            userIndex={userIndex}
          />

          <OwnRoster lang={lang} roster={userRoster} remaining={userRemaining} pool={pool} />

          {phase === "drafting" && (
            <PlayerPicker
              lang={lang}
              players={visiblePlayers}
              query={query}
              posFilter={posFilter}
              isUserTurn={isUserTurn}
              remainingSlotsNow={userRemaining}
              onQuery={setQuery}
              onFilter={setPosFilter}
              onPick={pickHuman}
            />
          )}

          <DraftBoard
            lang={lang}
            board={draft.board}
            pickIndex={phase === "done" ? MOCK_TOTAL_PICKS : draft.pickIndex}
            userIndex={userIndex}
            columnRef={userColumnRef}
          />

          {phase === "done" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={restart}
                className="min-h-11 rounded-lg bg-ice px-4 py-2 text-sm font-medium text-rink"
              >
                {c.mockRestart}
              </button>
            </div>
          )}
        </div>
      )}

      <footer className="mt-6 space-y-2 text-[11px] leading-relaxed text-muted">
        {meta && pool && (
          <p>
            Yahoo game {meta.gameKey}
            {meta.season ? ` · ${meta.season}` : ""} · {pool.length} {c.players}
            {meta.fetchedAt
              ? ` · ${c.updated} ${new Date(meta.fetchedAt).toLocaleString(lang === "fi" ? "fi-FI" : "en-CA")}`
              : ""}
          </p>
        )}
        <p>{c.mockDataSource}</p>
        <p>{c.mockLeagueDefaults}</p>
      </footer>
    </div>
  );
}

function commit(
  prev: DraftState,
  player: MockPlayer,
  by: "human" | "bot",
): DraftState {
  const teamIndex = snakeTeamIndex(prev.pickIndex);
  const nextRoster = applyPick(prev.rosters[teamIndex], player, prev.pickIndex);
  if (!nextRoster) return prev;
  const record: MockDraftPickRecord = {
    pickIndex: prev.pickIndex,
    teamIndex,
    player,
    slot: nextRoster.picks[nextRoster.picks.length - 1].slot,
    by,
  };
  const board = [...prev.board];
  board[prev.pickIndex] = record;
  return {
    pickIndex: prev.pickIndex + 1,
    rosters: prev.rosters.map((r, i) => (i === teamIndex ? nextRoster : r)),
    remaining: prev.remaining.filter((p) => p.id !== player.id),
    board,
    lastPick: record,
  };
}

function Setup({
  lang,
  slot,
  onSlot,
  onStart,
  playerCount,
  season,
}: {
  lang: Lang;
  slot: number;
  onSlot: (n: number) => void;
  onStart: () => void;
  playerCount: number;
  season: string | null | undefined;
}) {
  const c = t(lang);
  return (
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <p className="text-sm text-white">{c.mockSetupLead}</p>
      <p className="mt-2 text-xs text-muted">{c.mockLeagueDefaults}</p>
      <p className="mt-1 text-xs text-muted">
        {playerCount} {c.players}
        {season ? ` · NHL ${season}` : ""}
      </p>
      <h2 className="mt-4 text-sm font-medium text-white">{c.mockYourSlot}</h2>
      <div className="mt-2 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {Array.from({ length: MOCK_TEAM_COUNT }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onSlot(n)}
            className={`min-h-11 rounded-lg border text-sm tabular ${
              slot === n
                ? "border-ice bg-ice/20 text-ice"
                : "border-line text-muted hover:border-ice/40 hover:text-white"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{c.mockSlotHint.replaceAll("{n}", String(slot))}</p>
      <button
        type="button"
        onClick={onStart}
        className="mt-4 min-h-11 w-full rounded-lg bg-ice px-4 text-sm font-medium text-rink sm:w-auto"
      >
        {c.mockStart}
      </button>
    </section>
  );
}

function StatusBar({
  lang,
  phase,
  pickIndex,
  isUserTurn,
  lastPick,
  userIndex,
}: {
  lang: Lang;
  phase: Phase;
  pickIndex: number;
  isUserTurn: boolean;
  lastPick: MockDraftPickRecord | null;
  userIndex: number;
}) {
  const c = t(lang);
  const round = Math.min(roundOfPick(Math.min(pickIndex, MOCK_TOTAL_PICKS - 1)), MOCK_ROUNDS);
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        phase === "done"
          ? "border-good/40 bg-panel"
          : isUserTurn
            ? "border-ice bg-ice/10"
            : "border-line bg-panel"
      }`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          {phase === "done"
            ? c.mockComplete
            : isUserTurn
              ? c.mockYourTurn
              : c.mockBotPicking}
        </p>
        <p className="text-xs text-muted tabular">
          {c.mockRound} {round} · {c.mockPickOf.replace("{n}", String(Math.min(pickIndex + 1, MOCK_TOTAL_PICKS))).replace("{total}", String(MOCK_TOTAL_PICKS))}
        </p>
      </div>
      {lastPick && (
        <p className="mt-1 text-xs text-muted">
          {c.mockLastPick}: {lastPick.player.name} ({posLabel(lastPick.player.positions)}, {c.mockAdp}{" "}
          {formatAdp(lastPick.player.adp, lang)}) ·{" "}
          {lastPick.teamIndex === userIndex ? c.mockYou : c.mockTeam.replace("{n}", String(lastPick.teamIndex + 1))}
        </p>
      )}
    </div>
  );
}

function OwnRoster({
  lang,
  roster,
  remaining,
  pool,
}: {
  lang: Lang;
  roster: TeamRoster | undefined;
  remaining: ReturnType<typeof remainingSlots>;
  pool: MockPlayer[];
}) {
  const c = t(lang);
  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  if (!roster) return null;
  return (
    <section className="sticky top-0 z-20 rounded-xl border border-line bg-[#0b1822]/95 p-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-white">{c.mockYourRoster}</h2>
        <p className="text-[11px] text-muted">
          {c.mockOpenStarters}:{" "}
          {(["C", "LW", "RW", "D", "G"] as const)
            .map((s) => `${s}\u00a0${remaining[s]}`)
            .join(" · ")}{" "}
          · {c.mockBenchShort}\u00a0{remaining.BN}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {SLOT_ORDER.map((slot) => {
          const rows = roster.picks.filter((p) => p.slot === slot);
          const limit = MOCK_SLOT_LIMITS[slot];
          return (
            <div key={slot} className="rounded-lg border border-line/80 bg-panel-2/40 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-ice/80">
                {slot === "BN" ? c.mockBenchShort : slot} {rows.length}/{limit}
              </p>
              {Array.from({ length: limit }, (_, i) => {
                const pick = rows[i];
                const nhl = pick ? byId.get(pick.playerId) : null;
                return (
                  <p key={i} className="truncate text-xs text-white/90">
                    {nhl ? nhl.lastName : "—"}
                  </p>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlayerPicker({
  lang,
  players,
  query,
  posFilter,
  isUserTurn,
  remainingSlotsNow,
  onQuery,
  onFilter,
  onPick,
}: {
  lang: Lang;
  players: MockPlayer[];
  query: string;
  posFilter: FantasyPosition | "ALL";
  isUserTurn: boolean;
  remainingSlotsNow: ReturnType<typeof remainingSlots>;
  onQuery: (q: string) => void;
  onFilter: (f: FantasyPosition | "ALL") => void;
  onPick: (p: MockPlayer) => void;
}) {
  const c = t(lang);
  return (
    <section className="rounded-xl border border-line bg-panel p-3">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={c.mockSearchPlayers}
        className="min-h-11 w-full rounded-lg border border-ice/35 bg-[#08141d] px-3 text-sm text-white outline-none placeholder:text-muted/80 focus:border-ice/70"
        aria-label={c.mockSearchPlayers}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilter(f)}
            className={`min-h-9 rounded-md border px-2.5 text-xs ${
              posFilter === f
                ? "border-ice bg-ice/20 text-ice"
                : "border-line text-muted hover:text-white"
            }`}
          >
            {f === "ALL" ? c.mockFilterAll : f}
          </button>
        ))}
      </div>
      <ul className="mt-2 max-h-[min(24rem,50vh)] overflow-auto">
        {players.length === 0 && (
          <li className="px-1 py-3 text-sm text-muted">{c.mockEmptyList}</li>
        )}
        {players.map((p) => {
          const fits = assignSlot(p.positions, remainingSlotsNow) !== null;
          const disabled = !isUserTurn || !fits;
          return (
            <li key={p.id} className="border-b border-line/60 last:border-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(p)}
                className="flex min-h-11 w-full items-center gap-2 px-1 py-1.5 text-left disabled:opacity-60"
              >
                <span className="w-14 shrink-0 font-mono text-[11px] text-ice/80 tabular">
                  {formatAdp(p.adp, lang)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-white">
                  {p.name}
                  <span className="ml-2 font-mono text-[11px] text-muted">{p.team}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted">{posLabel(p.positions)}</span>
                {isUserTurn && (
                  <span className={`shrink-0 text-[11px] ${fits ? "text-ice" : "text-muted"}`}>
                    {fits ? c.mockPickPlayer : c.mockNoFit}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DraftBoard({
  lang,
  board,
  pickIndex,
  userIndex,
  columnRef,
}: {
  lang: Lang;
  board: (MockDraftPickRecord | null)[];
  pickIndex: number;
  userIndex: number;
  columnRef: RefObject<HTMLDivElement | null>;
}) {
  const c = t(lang);
  return (
    <section className="rounded-xl border border-line bg-panel p-2 sm:p-3">
      <h2 className="mb-2 px-1 text-sm font-medium text-white">{c.mockDraftBoard}</h2>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[72rem] gap-px"
          style={{ gridTemplateColumns: `2.25rem repeat(${MOCK_TEAM_COUNT}, minmax(4.4rem, 1fr))` }}
        >
          <div />
          {Array.from({ length: MOCK_TEAM_COUNT }, (_, team) => (
            <div
              key={team}
              ref={team === userIndex ? columnRef : undefined}
              className={`sticky top-0 z-10 px-1 py-1 text-center text-[10px] font-medium ${
                team === userIndex ? "bg-ice/20 text-ice" : "bg-panel-2 text-muted"
              }`}
            >
              {team === userIndex ? c.mockYou : c.mockTeam.replace("{n}", String(team + 1))}
            </div>
          ))}
          {Array.from({ length: MOCK_ROUNDS }, (_, round) => (
            <RoundRow
              key={round}
              round={round}
              board={board}
              pickIndex={pickIndex}
              userIndex={userIndex}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RoundRow({
  round,
  board,
  pickIndex,
  userIndex,
}: {
  round: number;
  board: (MockDraftPickRecord | null)[];
  pickIndex: number;
  userIndex: number;
}) {
  return (
    <>
      <div className="flex items-center justify-center text-[10px] text-muted tabular">{round + 1}</div>
      {Array.from({ length: MOCK_TEAM_COUNT }, (_, team) => {
        const overall = pickIndexForTeamRound(team, round);
        const pick = board[overall];
        const current = overall === pickIndex;
        return (
          <div
            key={team}
            className={`min-h-10 rounded px-1 py-0.5 text-[10px] leading-tight ${
              current ? "ring-1 ring-ice bg-ice/15" : team === userIndex ? "bg-ice/10" : "bg-[#08141d]"
            }`}
          >
            {pick ? (
              <>
                <p className="truncate text-white">{pick.player.lastName}</p>
                <p className="text-muted">
                  {pick.slot} · {pick.player.team}
                </p>
              </>
            ) : (
              <p className="text-muted/40">{current ? "●" : ""}</p>
            )}
          </div>
        );
      })}
    </>
  );
}
