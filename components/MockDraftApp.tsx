"use client";

import { AppNav, LuistinLogo } from "@/components/AppNav";
import { t, type Copy } from "@/lib/i18n";
import {
  applyPick,
  assignSlot,
  chooseBotPick,
  createEmptyRosters,
  lastNPicks,
  MOCK_ROUNDS,
  MOCK_SLOT_LIMITS,
  MOCK_TEAM_COUNT,
  MOCK_TOTAL_PICKS,
  pickIndexForTeamRound,
  remainingFromPicks,
  remainingSlots,
  rosterByTeamViews,
  rostersFromPicks,
  roundOfPick,
  snakeTeamIndex,
  sortPlayers,
  sparseBoard,
  type MockDraftPickRecord,
  type MockPlayer,
  type MockSlot,
  type MockSortKey,
  type TeamRoster,
} from "@/lib/mockDraft";
import {
  freeSeatCount,
  normalizeRoomId,
  seatForParticipant,
  type RoomState,
  type RoomStorageKind,
} from "@/lib/mockRoom";
import { normalizeName } from "@/lib/names";
import { getServerStateSnapshot, getStateSnapshot, setAppState, subscribeState } from "@/lib/storage";
import type { FantasyPosition, Lang } from "@/lib/types";
import type { YahooPlayersPayload } from "@/lib/yahooPlayers";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";

type Phase = "setup" | "lobby" | "drafting" | "done";
type Tab = "draft" | "teams";

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
const POLL_MS = 1500;
const PID_KEY = "luistin-mock-participant";

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

function formatRank(rank: number | null): string {
  if (rank == null || !Number.isFinite(rank)) return "—";
  return String(Math.round(rank));
}

function posLabel(positions: FantasyPosition[]): string {
  return positions.join("/");
}

function roomLink(id: string): string {
  if (typeof window === "undefined") return `/mock?room=${id}`;
  return `${window.location.origin}/mock?room=${id}`;
}

function roomErrorCopy(code: string | null | undefined, c: Copy): string {
  switch (code) {
    case "seat_taken":
      return c.mockSeatTaken;
    case "not_host":
      return c.mockNotHost;
    case "not_your_turn":
      return c.mockNotYourTurn;
    case "not_lobby":
    case "already_started":
      return c.mockNotLobby;
    case "not_found":
    case "invalid_room":
      return c.mockRoomMissing;
    case "busy":
      return c.mockBusy;
    default:
      return c.mockYahooError;
  }
}

export function MockDraftApp() {
  const appState = useSyncExternalStore(subscribeState, getStateSnapshot, getServerStateSnapshot);
  const lang: Lang = appState.lang;
  const c = t(lang);
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomParam = searchParams.get("room");

  const [pool, setPool] = useState<MockPlayer[] | null>(null);
  const [meta, setMeta] = useState<Pick<YahooPlayersPayload, "gameKey" | "season" | "fetchedAt"> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slot, setSlot] = useState(1);
  const [soloPhase, setSoloPhase] = useState<Exclude<Phase, "lobby">>("setup");
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft());
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<FantasyPosition | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<MockSortKey>("adp");
  const [tab, setTab] = useState<Tab>("draft");
  const [lastTenOpen, setLastTenOpen] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState(0);
  const [participantId, setParticipantId] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [storageKind, setStorageKind] = useState<RoomStorageKind | null>(null);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
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
    let id = window.localStorage.getItem(PID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(PID_KEY, id);
    }
    setParticipantId(id);
  }, []);

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

  const roomId = normalizeRoomId(roomParam ?? "");

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setRoomLoadError(null);
      setStorageKind(null);
      return;
    }
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch(`/api/mock/room/${roomId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setRoom(null);
          setRoomLoadError(String(json.error ?? "not_found"));
          return;
        }
        setRoom(json.room as RoomState);
        setStorageKind((json.storage as RoomStorageKind) ?? null);
        setRoomLoadError(null);
      } catch {
        if (!cancelled) setRoomLoadError("not_found");
      }
    }
    void pull();
    const timer = window.setInterval(() => void pull(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [roomId]);

  const mySeat = room && participantId ? seatForParticipant(room, participantId) : null;
  const userIndex = room ? (mySeat?.teamIndex ?? null) : slot - 1;
  const livePicks = room ? room.picks : draft.board.filter((p): p is MockDraftPickRecord => Boolean(p));
  const livePickIndex = room ? room.picks.length : draft.pickIndex;
  const liveRosters = room ? rostersFromPicks(room.picks) : draft.rosters;
  const liveRemaining = room && pool ? remainingFromPicks(pool, room.picks) : draft.remaining;
  const liveBoard = room ? sparseBoard(room.picks) : draft.board;
  const lastPick = livePicks[livePicks.length - 1] ?? null;
  const phase: Phase = room
    ? room.status
    : roomId && !roomLoadError
      ? "lobby"
      : soloPhase;
  const currentTeam = snakeTeamIndex(Math.min(livePickIndex, MOCK_TOTAL_PICKS - 1));
  const isUserTurn =
    phase === "drafting" &&
    livePickIndex < MOCK_TOTAL_PICKS &&
    userIndex != null &&
    currentTeam === userIndex;
  const currentSeatKind = room ? room.seats[currentTeam]?.kind : "bot";
  const waitingOnOtherHuman =
    phase === "drafting" && !isUserTurn && currentSeatKind === "human";
  const userRoster = userIndex != null ? liveRosters[userIndex] : undefined;
  const userRemaining = userRoster
    ? remainingSlots(userRoster.filled)
    : remainingSlots(createEmptyRosters()[0].filled);

  useEffect(() => {
    if (userIndex != null) setSelectedTeam(userIndex);
  }, [userIndex]);

  useEffect(() => {
    if (phase !== "drafting") return;
    if (room) return;
    if (draft.pickIndex >= MOCK_TOTAL_PICKS) {
      setSoloPhase("done");
      return;
    }
    if (userIndex == null || snakeTeamIndex(draft.pickIndex) === userIndex) return;
    const timer = window.setTimeout(() => {
      setDraft((prev) => {
        if (prev.pickIndex >= MOCK_TOTAL_PICKS) return prev;
        const teamIndex = snakeTeamIndex(prev.pickIndex);
        if (userIndex != null && teamIndex === userIndex) return prev;
        const roster = prev.rosters[teamIndex];
        const player = chooseBotPick(prev.remaining, remainingSlots(roster.filled));
        if (!player) return prev;
        return commit(prev, player, "bot");
      });
    }, BOT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase, draft.pickIndex, userIndex, room]);

  useEffect(() => {
    if (phase !== "drafting") return;
    userColumnRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [phase, livePickIndex]);

  const visiblePlayers = useMemo(() => {
    const q = normalizeName(query);
    return sortPlayers(liveRemaining, sortKey).filter((p) => {
      if (posFilter !== "ALL" && !p.positions.includes(posFilter)) return false;
      if (!q) return true;
      return (
        normalizeName(p.name).includes(q) ||
        normalizeName(p.lastName).includes(q) ||
        normalizeName(p.team).includes(q)
      );
    });
  }, [liveRemaining, query, posFilter, sortKey]);

  const recentPicks = useMemo(() => lastNPicks(livePicks, 10), [livePicks]);
  const teamViews = useMemo(
    () => rosterByTeamViews(livePicks, userIndex),
    [livePicks, userIndex],
  );

  function startDraft() {
    if (!pool || pool.length === 0) return;
    setQuery("");
    setPosFilter("ALL");
    setTab("draft");
    setDraft(emptyDraft(pool));
    setSoloPhase("drafting");
  }

  async function postRoom(body: Record<string, unknown>): Promise<RoomState | null> {
    if (!roomId && body.action) return null;
    const url = body.action ? `/api/mock/room/${roomId}` : "/api/mock/room";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setActionError(roomErrorCopy(String(json.error ?? ""), c));
      return null;
    }
    const next = json.room as RoomState;
    setRoom(next);
    setStorageKind((json.storage as RoomStorageKind) ?? null);
    setActionError(null);
    return next;
  }

  async function createRoom() {
    if (!participantId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mock/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, slot }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(roomErrorCopy(String(json.error ?? ""), c));
        return;
      }
      const next = json.room as RoomState;
      setRoom(next);
      setStorageKind((json.storage as RoomStorageKind) ?? null);
      setActionError(null);
      setTab("draft");
      router.replace(`/mock?room=${next.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(n: number) {
    if (!participantId || !roomId) return;
    setBusy(true);
    try {
      await postRoom({ action: "join", participantId, slot: n });
    } finally {
      setBusy(false);
    }
  }

  async function startRoomDraft() {
    if (!participantId) return;
    setBusy(true);
    try {
      await postRoom({ action: "start", participantId });
      setTab("draft");
    } finally {
      setBusy(false);
    }
  }

  function pickHuman(player: MockPlayer) {
    if (!isUserTurn) return;
    setQuery("");
    if (room) {
      if (!participantId) return;
      void postRoom({ action: "pick", participantId, playerId: player.id });
      return;
    }
    if (userIndex == null) return;
    setDraft((prev) => {
      if (snakeTeamIndex(prev.pickIndex) !== userIndex) return prev;
      const roster = prev.rosters[userIndex];
      if (!assignSlot(player.positions, remainingSlots(roster.filled))) return prev;
      if (!prev.remaining.some((p) => p.id === player.id)) return prev;
      return commit(prev, player, "human");
    });
  }

  function restart() {
    setSoloPhase("setup");
    setDraft(emptyDraft(pool ?? []));
    setQuery("");
    setPosFilter("ALL");
    setTab("draft");
    setRoom(null);
    setActionError(null);
    if (roomId) router.replace("/mock");
  }

  async function copyLink(id: string) {
    const url = roomLink(id);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(c.mockCopyLink, url);
    }
  }

  const showDraftUi = pool && (phase === "drafting" || phase === "done");
  const isHost = Boolean(room && participantId && room.hostParticipantId === participantId);

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

      {roomLoadError && roomId && (
        <div className="rounded-xl border border-bad/40 bg-panel px-4 py-6 text-center">
          <p className="text-sm text-bad">{c.mockRoomMissing}</p>
          <button
            type="button"
            onClick={restart}
            className="mt-3 min-h-11 rounded-md bg-ice px-3 py-1.5 text-sm text-rink"
          >
            {c.mockBackToSetup}
          </button>
        </div>
      )}

      {pool && !loading && phase === "setup" && !roomId && (
        <Setup
          lang={lang}
          slot={slot}
          onSlot={setSlot}
          onStart={startDraft}
          onCreateRoom={() => void createRoom()}
          creating={busy}
          playerCount={pool.length}
          season={meta?.season}
          actionError={actionError}
        />
      )}

      {pool && room && phase === "lobby" && (
        <Lobby
          lang={lang}
          room={room}
          participantId={participantId}
          storageKind={storageKind}
          isHost={isHost}
          busy={busy}
          copied={copied}
          actionError={actionError}
          onJoin={(n) => void joinRoom(n)}
          onStart={() => void startRoomDraft()}
          onCopy={() => void copyLink(room.id)}
        />
      )}

      {roomId && !room && !roomLoadError && (
        <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-muted">
          {c.mockRoomLoading}
        </p>
      )}

      {pool && showDraftUi && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex rounded-xl border border-line bg-panel p-1" role="tablist">
            {(["draft", "teams"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-11 flex-1 rounded-lg text-sm ${
                  tab === key ? "bg-ice/20 text-ice" : "text-muted"
                }`}
              >
                {key === "draft" ? c.mockTabDraft : c.mockTabTeams}
              </button>
            ))}
          </div>

          {room && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>
                {c.mockRoomCode} {room.id}
              </span>
              <button
                type="button"
                onClick={() => void copyLink(room.id)}
                className="min-h-9 rounded-md border border-line px-2 text-ice"
              >
                {copied ? c.mockCopied : c.mockCopyLink}
              </button>
            </div>
          )}

          <StatusBar
            lang={lang}
            phase={phase === "done" ? "done" : "drafting"}
            pickIndex={livePickIndex}
            isUserTurn={isUserTurn}
            waitingOnOtherHuman={waitingOnOtherHuman}
            currentTeam={currentTeam}
            lastPick={lastPick}
            userIndex={userIndex ?? -1}
          />
          {actionError && <p className="text-sm text-bad">{actionError}</p>}

          {tab === "draft" && (
            <>
              <LastTen
                lang={lang}
                picks={recentPicks}
                userIndex={userIndex}
                open={lastTenOpen}
                onToggle={() => setLastTenOpen((v) => !v)}
              />

              {userRoster && (
                <OwnRoster lang={lang} roster={userRoster} remaining={userRemaining} livePicks={livePicks} />
              )}

              {phase === "drafting" && (
                <PlayerPicker
                  lang={lang}
                  players={visiblePlayers}
                  query={query}
                  posFilter={posFilter}
                  sortKey={sortKey}
                  isUserTurn={isUserTurn}
                  remainingSlotsNow={userRemaining}
                  onQuery={setQuery}
                  onFilter={setPosFilter}
                  onSort={setSortKey}
                  onPick={pickHuman}
                />
              )}

              <DraftBoard
                lang={lang}
                board={liveBoard}
                pickIndex={phase === "done" ? MOCK_TOTAL_PICKS : livePickIndex}
                userIndex={userIndex}
                columnRef={userColumnRef}
              />
            </>
          )}

          {tab === "teams" && (
            <TeamsTab
              lang={lang}
              views={teamViews}
              selected={selectedTeam}
              onSelect={setSelectedTeam}
            />
          )}

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
  onCreateRoom,
  creating,
  playerCount,
  season,
  actionError,
}: {
  lang: Lang;
  slot: number;
  onSlot: (n: number) => void;
  onStart: () => void;
  onCreateRoom: () => void;
  creating: boolean;
  playerCount: number;
  season: string | null | undefined;
  actionError: string | null;
}) {
  const c = t(lang);
  return (
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <p className="text-sm text-white">{c.mockSetupLead}</p>
      <p className="mt-2 text-xs text-muted">{c.mockSoloHint}</p>
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
      {actionError && <p className="mt-2 text-sm text-bad">{actionError}</p>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onStart}
          className="min-h-11 w-full rounded-lg bg-ice px-4 text-sm font-medium text-rink sm:w-auto"
        >
          {c.mockStart}
        </button>
        <button
          type="button"
          onClick={onCreateRoom}
          disabled={creating}
          className="min-h-11 w-full rounded-lg border border-ice/50 px-4 text-sm font-medium text-ice disabled:opacity-60 sm:w-auto"
        >
          {c.mockCreateRoom}
        </button>
      </div>
    </section>
  );
}

function Lobby({
  lang,
  room,
  participantId,
  storageKind,
  isHost,
  busy,
  copied,
  actionError,
  onJoin,
  onStart,
  onCopy,
}: {
  lang: Lang;
  room: RoomState;
  participantId: string;
  storageKind: RoomStorageKind | null;
  isHost: boolean;
  busy: boolean;
  copied: boolean;
  actionError: string | null;
  onJoin: (slot: number) => void;
  onStart: () => void;
  onCopy: () => void;
}) {
  const c = t(lang);
  const free = freeSeatCount(room);
  const mine = seatForParticipant(room, participantId);
  return (
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-white">
          {c.mockRoomCode} {room.id}
        </h2>
        <button
          type="button"
          onClick={onCopy}
          className="min-h-11 rounded-lg bg-ice px-3 text-sm font-medium text-rink"
        >
          {copied ? c.mockCopied : c.mockCopyLink}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">{c.mockShareHint}</p>
      <p className="mt-1 text-xs text-muted">
        {c.mockSeatsFree}: {free} · {c.mockBotsFill}
      </p>
      {isHost && <p className="mt-1 text-xs text-ice">{c.mockYouHost}</p>}
      {!isHost && !mine && <p className="mt-1 text-xs text-muted">{c.mockJoin}</p>}
      {!isHost && mine && <p className="mt-1 text-xs text-muted">{c.mockWaitingHost}</p>}
      {storageKind === "memory" && <p className="mt-2 text-xs text-warn">{c.mockStorageMemory}</p>}
      <div className="mt-3 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {room.seats.map((seat) => {
          const n = seat.teamIndex + 1;
          const isMine = seat.participantId === participantId && seat.kind === "human";
          const taken = seat.kind === "human" && !isMine;
          return (
            <button
              key={n}
              type="button"
              disabled={taken || busy}
              onClick={() => onJoin(n)}
              className={`min-h-14 rounded-lg border px-1 py-1 text-center ${
                isMine
                  ? "border-ice bg-ice/20 text-ice"
                  : taken
                    ? "border-line bg-panel-2 text-muted"
                    : "border-line text-white hover:border-ice/40"
              }`}
            >
              <span className="block text-sm tabular">{n}</span>
              <span className="block text-[10px] leading-tight">
                {isMine ? c.mockYou : taken ? c.mockSeatHuman : c.mockSeatEmpty}
              </span>
            </button>
          );
        })}
      </div>
      {actionError && <p className="mt-2 text-sm text-bad">{actionError}</p>}
      {isHost && (
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="mt-4 min-h-11 w-full rounded-lg bg-ice px-4 text-sm font-medium text-rink disabled:opacity-60 sm:w-auto"
        >
          {c.mockStart}
        </button>
      )}
    </section>
  );
}

function StatusBar({
  lang,
  phase,
  pickIndex,
  isUserTurn,
  waitingOnOtherHuman,
  currentTeam,
  lastPick,
  userIndex,
}: {
  lang: Lang;
  phase: Phase;
  pickIndex: number;
  isUserTurn: boolean;
  waitingOnOtherHuman?: boolean;
  currentTeam?: number;
  lastPick: MockDraftPickRecord | null;
  userIndex: number;
}) {
  const c = t(lang);
  const round = Math.min(roundOfPick(Math.min(pickIndex, MOCK_TOTAL_PICKS - 1)), MOCK_ROUNDS);
  const headline =
    phase === "done"
      ? c.mockComplete
      : isUserTurn
        ? c.mockYourTurn
        : waitingOnOtherHuman
          ? c.mockOtherPicking.replace("{n}", String((currentTeam ?? 0) + 1))
          : c.mockBotPicking;
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
        <p className="text-sm font-semibold text-white">{headline}</p>
        <p className="text-xs text-muted tabular">
          {c.mockRound} {round} · {c.mockPickOf.replace("{n}", String(Math.min(pickIndex + 1, MOCK_TOTAL_PICKS))).replace("{total}", String(MOCK_TOTAL_PICKS))}
        </p>
      </div>
      {lastPick && (
        <p className="mt-1 text-xs text-muted">
          {c.mockLastPick}: {lastPick.player.name} ({posLabel(lastPick.player.positions)}, {c.mockAdp}{" "}
          {formatAdp(lastPick.player.adp, lang)} · {c.mockYahooRank} {formatRank(lastPick.player.yahooRank)}) ·{" "}
          {lastPick.teamIndex === userIndex ? c.mockYou : c.mockTeam.replace("{n}", String(lastPick.teamIndex + 1))}
        </p>
      )}
    </div>
  );
}

function LastTen({
  lang,
  picks,
  userIndex,
  open,
  onToggle,
}: {
  lang: Lang;
  picks: MockDraftPickRecord[];
  userIndex: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  const c = t(lang);
  return (
    <section className="rounded-xl border border-line bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-white">{c.mockLastTen}</h2>
        <button
          type="button"
          onClick={onToggle}
          className="min-h-9 rounded-md px-2 text-xs text-ice sm:hidden"
        >
          {open ? c.mockHideLastTen : c.mockShowLastTen}
        </button>
      </div>
      <ul className={`mt-2 space-y-1 ${open ? "block" : "hidden sm:block"}`}>
        {picks.length === 0 && <li className="text-xs text-muted">—</li>}
        {picks.map((p) => (
          <li key={p.pickIndex} className="flex min-h-9 items-baseline gap-2 text-xs">
            <span className="w-10 shrink-0 font-mono text-ice/80 tabular">#{p.pickIndex + 1}</span>
            <span className="w-14 shrink-0 text-muted">
              {p.teamIndex === userIndex ? c.mockYou : c.mockTeam.replace("{n}", String(p.teamIndex + 1))}
            </span>
            <span className="min-w-0 flex-1 truncate text-white">{p.player.name}</span>
            <span className="shrink-0 text-muted">{posLabel(p.player.positions)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OwnRoster({
  lang,
  roster,
  remaining,
  livePicks,
}: {
  lang: Lang;
  roster: TeamRoster | undefined;
  remaining: ReturnType<typeof remainingSlots>;
  livePicks: MockDraftPickRecord[];
}) {
  const c = t(lang);
  const byId = useMemo(() => {
    const map = new Map<string, MockPlayer>();
    for (const p of livePicks) map.set(p.player.id, p.player);
    return map;
  }, [livePicks]);
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
      <SlotGrid lang={lang} roster={roster} byId={byId} />
    </section>
  );
}

function SlotGrid({
  lang,
  roster,
  byId,
}: {
  lang: Lang;
  roster: TeamRoster;
  byId: Map<string, MockPlayer>;
}) {
  const c = t(lang);
  return (
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
  );
}

function TeamsTab({
  lang,
  views,
  selected,
  onSelect,
}: {
  lang: Lang;
  views: ReturnType<typeof rosterByTeamViews>;
  selected: number;
  onSelect: (n: number) => void;
}) {
  const c = t(lang);
  const view = views[selected] ?? views[0];
  const roster: TeamRoster | undefined = view
    ? {
        teamIndex: view.teamIndex,
        picks: view.picks.map((p) => ({
          playerId: p.player.id,
          slot: p.slot,
          pickIndex: p.pickIndex,
        })),
        filled: view.filled,
      }
    : undefined;
  const byId = useMemo(() => {
    const map = new Map<string, MockPlayer>();
    for (const team of views) {
      for (const p of team.picks) map.set(p.player.id, p.player);
    }
    return map;
  }, [views]);
  if (!view || !roster) return null;
  return (
    <section className="rounded-xl border border-line bg-panel p-3">
      <h2 className="mb-2 text-sm font-medium text-white">{c.mockSelectTeam}</h2>
      <div className="flex gap-1.5 overflow-x-auto pb-2">
        {views.map((team) => (
          <button
            key={team.teamIndex}
            type="button"
            onClick={() => onSelect(team.teamIndex)}
            className={`min-h-11 min-w-11 shrink-0 rounded-lg border px-2 text-sm tabular ${
              team.teamIndex === selected
                ? "border-ice bg-ice/20 text-ice"
                : team.isUser
                  ? "border-ice/40 text-ice"
                  : "border-line text-muted"
            }`}
          >
            {team.isUser ? c.mockYou : team.seat}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-muted">
        {view.isUser ? c.mockYourTeam : c.mockTeam.replace("{n}", String(view.seat))} · {view.picks.length}/{MOCK_ROUNDS}
      </p>
      <SlotGrid lang={lang} roster={roster} byId={byId} />
    </section>
  );
}

function PlayerPicker({
  lang,
  players,
  query,
  posFilter,
  sortKey,
  isUserTurn,
  remainingSlotsNow,
  onQuery,
  onFilter,
  onSort,
  onPick,
}: {
  lang: Lang;
  players: MockPlayer[];
  query: string;
  posFilter: FantasyPosition | "ALL";
  sortKey: MockSortKey;
  isUserTurn: boolean;
  remainingSlotsNow: ReturnType<typeof remainingSlots>;
  onQuery: (q: string) => void;
  onFilter: (f: FantasyPosition | "ALL") => void;
  onSort: (k: MockSortKey) => void;
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
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={c.mockFilterAll}>
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
      <div className="mt-2">
        <p id="mock-sort-label" className="mb-1 text-xs text-muted">
          {c.mockSortBy}
        </p>
        <div
          className="grid grid-cols-2 overflow-hidden rounded-lg border border-line"
          role="radiogroup"
          aria-labelledby="mock-sort-label"
        >
          <button
            type="button"
            role="radio"
            aria-checked={sortKey === "adp"}
            onClick={() => onSort("adp")}
            className={`min-h-11 border-r border-line text-sm font-medium ${
              sortKey === "adp" ? "bg-ice/20 text-ice" : "text-muted hover:text-white"
            }`}
          >
            {c.mockAdp}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sortKey === "yahooRank"}
            onClick={() => onSort("yahooRank")}
            className={`min-h-11 text-sm font-medium ${
              sortKey === "yahooRank" ? "bg-ice/20 text-ice" : "text-muted hover:text-white"
            }`}
          >
            {c.mockYahooRankLong}
          </button>
        </div>
      </div>
      <div className="mt-2 flex gap-2 px-1 text-[10px] uppercase tracking-wide text-muted">
        <button
          type="button"
          onClick={() => onSort("adp")}
          className={`w-12 shrink-0 text-left ${sortKey === "adp" ? "text-ice" : ""}`}
        >
          {c.mockAdp}
        </button>
        <button
          type="button"
          onClick={() => onSort("yahooRank")}
          className={`w-10 shrink-0 text-left ${sortKey === "yahooRank" ? "text-ice" : ""}`}
        >
          {c.mockYahooRank}
        </button>
        <span className="flex-1">{c.players}</span>
      </div>
      <ul className="mt-1 max-h-[min(24rem,50vh)] overflow-auto">
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
                <span className="w-12 shrink-0 font-mono text-[11px] text-ice/80 tabular">
                  {formatAdp(p.adp, lang)}
                </span>
                <span className="w-8 shrink-0 font-mono text-[11px] text-ice/70 tabular">
                  {formatRank(p.yahooRank)}
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
  userIndex: number | null;
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
  userIndex: number | null;
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
