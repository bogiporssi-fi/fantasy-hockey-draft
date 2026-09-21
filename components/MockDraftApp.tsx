"use client";

import { AppNav, LuistinLogo } from "@/components/AppNav";
import { useStableListScroll } from "@/components/useStableListScroll";
import { t, type Copy } from "@/lib/i18n";
import {
  applyPick,
  assignSlot,
  boardCellLabel,
  chooseBotPick,
  createEmptyRosters,
  formatDraftedLabel,
  formatLastPickTicker,
  formatPosTeam,
  formatShortName,
  matchesPosFilter,
  MOCK_ROUNDS,
  MOCK_TEAM_COUNT,
  MOCK_TOTAL_PICKS,
  pickIndexForTeamRound,
  picksUntilTurn,
  remainingFromPicks,
  remainingSlots,
  rosterByTeamViews,
  rostersFromPicks,
  roundOfPick,
  snakeTeamIndex,
  sortPlayers,
  sparseBoard,
  stripSlotsFromRoster,
  type MockDraftPickRecord,
  type MockPlayer,
  type MockPosFilter,
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

type Phase = "setup" | "lobby" | "drafting" | "done";
type DraftTab = "players" | "queue" | "board" | "results";
type ResultsSub = "rosters" | "picks";

interface DraftState {
  pickIndex: number;
  rosters: TeamRoster[];
  remaining: MockPlayer[];
  board: (MockDraftPickRecord | null)[];
  lastPick: MockDraftPickRecord | null;
}

const BOT_DELAY_MS = 1100;
const POLL_MS = 1500;
const PID_KEY = "luistin-mock-participant";
const POS_CHIPS: MockPosFilter[] = ["ALL", "FD", "G"];
const EXTRA_FILTERS: FantasyPosition[] = ["C", "LW", "RW", "D", "G"];
const SEAT_COLORS = [
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#14b8a6",
  "#3b82f6",
  "#ef4444",
  "#eab308",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#84cc16",
  "#f59e0b",
  "#6366f1",
  "#10b981",
  "#f43f5e",
  "#0ea5e9",
  "#d946ef",
  "#65a30d",
  "#fb7185",
  "#7c3aed",
];

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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

function seatLabel(c: Copy, teamIndex: number, userIndex: number | null): string {
  if (userIndex != null && teamIndex === userIndex) return c.mockYou;
  return c.mockTeam.replace("{n}", String(teamIndex + 1));
}

function statusHeadline(opts: {
  c: Copy;
  phase: Phase;
  pickIndex: number;
  userIndex: number | null;
  isUserTurn: boolean;
  waitingOnOtherHuman: boolean;
  currentTeam: number;
}): string {
  const { c, phase, pickIndex, userIndex, isUserTurn, waitingOnOtherHuman, currentTeam } = opts;
  if (phase === "done") return c.mockComplete;
  if (phase !== "drafting") {
    const n = userIndex != null ? String(userIndex + 1) : "—";
    return `${c.mockYouPickNth.replace("{n}", n)} • ${c.mockDraftStartsSoon}`;
  }
  const round = Math.min(roundOfPick(Math.min(pickIndex, MOCK_TOTAL_PICKS - 1)), MOCK_ROUNDS);
  const pick = Math.min(pickIndex + 1, MOCK_TOTAL_PICKS);
  const roundPick = c.mockRoundPick.replace("{round}", String(round)).replace("{pick}", String(pick));
  if (isUserTurn) return `${c.mockYourTurn} • ${roundPick}`;
  if (waitingOnOtherHuman) {
    return `${c.mockOtherPicking.replace("{n}", String(currentTeam + 1))} • ${roundPick}`;
  }
  const until = picksUntilTurn(pickIndex, userIndex);
  if (until > 0) return `${c.mockUpInPicks.replace("{n}", String(until))} • ${roundPick}`;
  return `${c.mockBotPicking} • ${roundPick}`;
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
  const [posFilter, setPosFilter] = useState<MockPosFilter>("ALL");
  const [sortKey, setSortKey] = useState<MockSortKey>("yahooRank");
  const [tab, setTab] = useState<DraftTab>("players");
  const [resultsSub, setResultsSub] = useState<ResultsSub>("rosters");
  const [selectedTeam, setSelectedTeam] = useState(0);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [extraFilters, setExtraFilters] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [participantId, setParticipantId] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [storageKind, setStorageKind] = useState<RoomStorageKind | null>(null);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const userColumnRef = useRef<HTMLDivElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);

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
    if (phase !== "drafting") {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase, livePickIndex]);

  useEffect(() => {
    if (phase !== "drafting" && phase !== "done") return;
    const col = userColumnRef.current;
    if (!col) return;
    const scroller = col.closest("[data-mock-board-scroll]");
    if (!(scroller instanceof HTMLElement)) return;
    const nextLeft = col.offsetLeft - (scroller.clientWidth - col.clientWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, nextLeft) });
  }, [phase, userIndex, tab]);

  useEffect(() => {
    if (phase !== "drafting" && phase !== "done") return;
    const chip = carouselRef.current?.querySelector(`[data-seat="${currentTeam}"]`);
    if (chip instanceof HTMLElement) {
      chip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [phase, currentTeam]);

  const visiblePlayers = useMemo(() => {
    const q = normalizeName(query);
    return sortPlayers(liveRemaining, sortKey).filter((p) => {
      if (!matchesPosFilter(p, posFilter)) return false;
      if (!q) return true;
      return (
        normalizeName(p.name).includes(q) ||
        normalizeName(p.lastName).includes(q) ||
        normalizeName(p.team).includes(q)
      );
    });
  }, [liveRemaining, query, posFilter, sortKey]);

  const teamViews = useMemo(
    () => rosterByTeamViews(livePicks, userIndex),
    [livePicks, userIndex],
  );

  const remainingById = useMemo(() => new Map(liveRemaining.map((p) => [p.id, p])), [liveRemaining]);
  const queuedPlayers = queueIds.map((id) => remainingById.get(id)).filter((p): p is MockPlayer => Boolean(p));
  const untilTurn = picksUntilTurn(livePickIndex, userIndex);

  function startDraft() {
    if (!pool || pool.length === 0) return;
    setQuery("");
    setPosFilter("ALL");
    setTab("players");
    setQueueIds([]);
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
      setTab("players");
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
      setTab("players");
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
    setTab("players");
    setQueueIds([]);
    setRoom(null);
    setActionError(null);
    setSettingsOpen(false);
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

  function toggleQueue(id: string) {
    setQueueIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function showMyTeam() {
    if (userIndex != null) setSelectedTeam(userIndex);
    setResultsSub("rosters");
    setTab("results");
  }

  const showDraftUi = pool && (phase === "drafting" || phase === "done");
  const isHost = Boolean(room && participantId && room.hostParticipantId === participantId);
  const headline = statusHeadline({
    c,
    phase,
    pickIndex: livePickIndex,
    userIndex,
    isUserTurn,
    waitingOnOtherHuman,
    currentTeam,
  });

  return (
    <div className="mock-shell min-h-dvh">
      {loading && (
        <p className="px-4 py-16 text-center text-sm text-zinc-500">{c.mockYahooLoading}</p>
      )}
      {loadError && !loading && (
        <div className="px-4 py-16 text-center">
          <p className="text-sm text-red-600">{c.mockYahooError}</p>
          <button
            type="button"
            onClick={loadPlayers}
            className="mt-3 min-h-11 rounded-full bg-[var(--mock-purple)] px-4 text-sm font-medium text-white"
          >
            {c.retry}
          </button>
        </div>
      )}

      {roomLoadError && roomId && (
        <div className="px-4 py-16 text-center">
          <p className="text-sm text-red-600">{c.mockRoomMissing}</p>
          <button
            type="button"
            onClick={restart}
            className="mt-3 min-h-11 rounded-full bg-[var(--mock-purple)] px-4 text-sm font-medium text-white"
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
          meta={meta}
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
          onLeave={restart}
        />
      )}

      {roomId && !room && !roomLoadError && (
        <p className="px-4 py-16 text-center text-sm text-zinc-500">{c.mockRoomLoading}</p>
      )}

      {pool && showDraftUi && (
        <DraftRoom
          lang={lang}
          c={c}
          headline={headline}
          elapsed={elapsed}
          isUserTurn={isUserTurn}
          userIndex={userIndex}
          currentTeam={currentTeam}
          lastPick={lastPick}
          livePicks={livePicks}
          liveBoard={liveBoard}
          livePickIndex={phase === "done" ? MOCK_TOTAL_PICKS : livePickIndex}
          userRoster={userRoster}
          userRemaining={userRemaining}
          visiblePlayers={visiblePlayers}
          queuedPlayers={queuedPlayers}
          queueIds={queueIds}
          query={query}
          posFilter={posFilter}
          sortKey={sortKey}
          searchOpen={searchOpen}
          extraFilters={extraFilters}
          tab={tab}
          resultsSub={resultsSub}
          selectedTeam={selectedTeam}
          teamViews={teamViews}
          untilTurn={untilTurn}
          actionError={actionError}
          phase={phase === "done" ? "done" : "drafting"}
          room={room}
          copied={copied}
          settingsOpen={settingsOpen}
          appLang={appState.lang}
          onLang={(code) => setAppState({ ...appState, lang: code })}
          onClose={restart}
          onSettings={() => setSettingsOpen((v) => !v)}
          onCopyRoom={room ? () => void copyLink(room.id) : undefined}
          onQuery={setQuery}
          onFilter={setPosFilter}
          onSort={setSortKey}
          onSearchOpen={setSearchOpen}
          onExtraFilters={setExtraFilters}
          onTab={setTab}
          onResultsSub={setResultsSub}
          onSelectTeam={setSelectedTeam}
          onPick={pickHuman}
          onToggleQueue={toggleQueue}
          onShowMyTeam={showMyTeam}
          userColumnRef={userColumnRef}
          carouselRef={carouselRef}
        />
      )}
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
  meta,
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
  meta: Pick<YahooPlayersPayload, "gameKey" | "season" | "fetchedAt"> | null;
}) {
  const c = t(lang);
  const appState = useSyncExternalStore(subscribeState, getStateSnapshot, getServerStateSnapshot);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 py-4">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LuistinLogo />
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">{c.mockTitle}</h1>
            <p className="text-xs text-zinc-500">{c.mockTagline}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AppNav lang={lang} active="mock" />
          <div className="flex overflow-hidden rounded-full border border-zinc-200 text-[11px]">
            {(["fi", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setAppState({ ...appState, lang: code })}
                className={`px-2 py-1 uppercase ${appState.lang === code ? "bg-[var(--mock-purple)] text-white" : "text-zinc-500"}`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-zinc-800">{c.mockSetupLead}</p>
        <p className="mt-2 text-xs text-zinc-500">{c.mockSoloHint}</p>
        <p className="mt-2 text-xs text-zinc-500">{c.mockLeagueDefaults}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {playerCount} {c.players}
          {season ? ` · NHL ${season}` : ""}
        </p>
        <h2 className="mt-4 text-sm font-medium text-zinc-900">{c.mockYourSlot}</h2>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {Array.from({ length: MOCK_TEAM_COUNT }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSlot(n)}
              className={`min-h-11 rounded-xl border text-sm tabular ${
                slot === n
                  ? "border-[var(--mock-purple)] bg-[var(--mock-purple-soft)] text-[var(--mock-purple)]"
                  : "border-zinc-200 text-zinc-600"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{c.mockSlotHint.replaceAll("{n}", String(slot))}</p>
        {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onStart}
            className="min-h-11 w-full rounded-full bg-[var(--mock-purple)] px-4 text-sm font-semibold text-white"
          >
            {c.mockStart}
          </button>
          <button
            type="button"
            onClick={onCreateRoom}
            disabled={creating}
            className="min-h-11 w-full rounded-full border border-[var(--mock-purple)] px-4 text-sm font-semibold text-[var(--mock-purple)] disabled:opacity-60"
          >
            {c.mockCreateRoom}
          </button>
        </div>
      </section>
      <footer className="mt-6 space-y-1 text-[11px] leading-relaxed text-zinc-500">
        {meta && (
          <p>
            {c.mockDataSource}
            {meta.fetchedAt
              ? ` · ${c.updated} ${new Date(meta.fetchedAt).toLocaleString(lang === "fi" ? "fi-FI" : "en-CA")}`
              : ""}
          </p>
        )}
      </footer>
    </div>
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
  onLeave,
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
  onLeave: () => void;
}) {
  const c = t(lang);
  const free = freeSeatCount(room);
  const mine = seatForParticipant(room, participantId);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 py-4">
      <header className="mb-3 flex items-center gap-2">
        <IconButton label={c.close} onClick={onLeave}>
          <IconClose />
        </IconButton>
        <h1 className="flex-1 text-center text-sm font-semibold">
          {c.mockRoomCode} {room.id}
        </h1>
        <span className="w-10" />
      </header>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={onCopy}
          className="min-h-11 w-full rounded-full bg-[var(--mock-purple)] px-3 text-sm font-semibold text-white"
        >
          {copied ? c.mockCopied : c.mockCopyLink}
        </button>
        <p className="mt-2 text-xs text-zinc-500">{c.mockShareHint}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {c.mockSeatsFree}: {free} · {c.mockBotsFill}
        </p>
        {isHost && <p className="mt-1 text-xs text-[var(--mock-purple)]">{c.mockYouHost}</p>}
        {!isHost && !mine && <p className="mt-1 text-xs text-zinc-500">{c.mockJoin}</p>}
        {!isHost && mine && <p className="mt-1 text-xs text-zinc-500">{c.mockWaitingHost}</p>}
        {storageKind === "memory" && <p className="mt-2 text-xs text-amber-700">{c.mockStorageMemory}</p>}
        <div className="mt-3 grid grid-cols-5 gap-1.5">
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
                className={`min-h-14 rounded-xl border px-1 py-1 text-center ${
                  isMine
                    ? "border-[var(--mock-purple)] bg-[var(--mock-purple-soft)] text-[var(--mock-purple)]"
                    : taken
                      ? "border-zinc-200 bg-zinc-50 text-zinc-400"
                      : "border-zinc-200 text-zinc-800"
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
        {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}
        {isHost && (
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className="mt-4 min-h-11 w-full rounded-full bg-[var(--mock-purple)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {c.mockStart}
          </button>
        )}
      </section>
    </div>
  );
}

function DraftRoom({
  lang,
  c,
  headline,
  elapsed,
  isUserTurn,
  userIndex,
  currentTeam,
  lastPick,
  livePicks,
  liveBoard,
  livePickIndex,
  userRoster,
  userRemaining,
  visiblePlayers,
  queuedPlayers,
  queueIds,
  query,
  posFilter,
  sortKey,
  searchOpen,
  extraFilters,
  tab,
  resultsSub,
  selectedTeam,
  teamViews,
  untilTurn,
  actionError,
  phase,
  room,
  copied,
  settingsOpen,
  appLang,
  onLang,
  onClose,
  onSettings,
  onCopyRoom,
  onQuery,
  onFilter,
  onSort,
  onSearchOpen,
  onExtraFilters,
  onTab,
  onResultsSub,
  onSelectTeam,
  onPick,
  onToggleQueue,
  onShowMyTeam,
  userColumnRef,
  carouselRef,
}: {
  lang: Lang;
  c: Copy;
  headline: string;
  elapsed: number;
  isUserTurn: boolean;
  userIndex: number | null;
  currentTeam: number;
  lastPick: MockDraftPickRecord | null;
  livePicks: MockDraftPickRecord[];
  liveBoard: (MockDraftPickRecord | null)[];
  livePickIndex: number;
  userRoster: TeamRoster | undefined;
  userRemaining: ReturnType<typeof remainingSlots>;
  visiblePlayers: MockPlayer[];
  queuedPlayers: MockPlayer[];
  queueIds: string[];
  query: string;
  posFilter: MockPosFilter;
  sortKey: MockSortKey;
  searchOpen: boolean;
  extraFilters: boolean;
  tab: DraftTab;
  resultsSub: ResultsSub;
  selectedTeam: number;
  teamViews: ReturnType<typeof rosterByTeamViews>;
  untilTurn: number;
  actionError: string | null;
  phase: "drafting" | "done";
  room: RoomState | null;
  copied: boolean;
  settingsOpen: boolean;
  appLang: Lang;
  onLang: (code: Lang) => void;
  onClose: () => void;
  onSettings: () => void;
  onCopyRoom?: () => void;
  onQuery: (q: string) => void;
  onFilter: (f: MockPosFilter) => void;
  onSort: (k: MockSortKey) => void;
  onSearchOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  onExtraFilters: (v: boolean | ((p: boolean) => boolean)) => void;
  onTab: (t: DraftTab) => void;
  onResultsSub: (s: ResultsSub) => void;
  onSelectTeam: (n: number) => void;
  onPick: (p: MockPlayer) => void;
  onToggleQueue: (id: string) => void;
  onShowMyTeam: () => void;
  userColumnRef: RefObject<HTMLDivElement | null>;
  carouselRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-[#f7f8fc]">
      <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-start px-2 pb-1 pt-2">
        <IconButton label={c.mockLeaveDraft} onClick={onClose}>
          <IconClose />
        </IconButton>
        <div className="text-center">
          <p className="text-sm font-bold tabular text-zinc-900">{formatElapsed(elapsed)}</p>
          <p className="text-[11px] leading-tight text-zinc-500">{headline}</p>
        </div>
        <IconButton label={c.settings} onClick={onSettings}>
          <IconGear />
        </IconButton>
      </header>

      <div
        ref={carouselRef}
        className="flex gap-3 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {Array.from({ length: MOCK_TEAM_COUNT }, (_, team) => {
          const onClock = phase === "drafting" && team === currentTeam;
          const isYou = team === userIndex;
          return (
            <div
              key={team}
              data-seat={team}
              className="flex shrink-0 flex-col items-center gap-1"
            >
              <JerseyAvatar
                color={SEAT_COLORS[team % SEAT_COLORS.length]}
                onClock={onClock}
                isYou={isYou}
              />
              <span
                className={`max-w-[4.5rem] truncate text-[11px] font-medium ${
                  isYou ? "text-[var(--mock-purple)]" : "text-zinc-700"
                }`}
              >
                {seatLabel(c, team, userIndex)}
              </span>
            </div>
          );
        })}
      </div>

      {lastPick && (
        <div className="mx-3 mb-1 flex items-center justify-between rounded-full bg-zinc-100 px-3 py-1.5 text-[11px]">
          <p className="min-w-0 truncate font-medium text-zinc-800">
            <span className="text-zinc-500">{c.mockLastPrefix} </span>
            {formatLastPickTicker(lastPick.player)}
          </p>
          <span className="ml-2 shrink-0 text-zinc-500">
            {seatLabel(c, lastPick.teamIndex, userIndex)}
          </span>
        </div>
      )}

      {actionError && <p className="px-3 text-xs text-red-600">{actionError}</p>}

      <div className="relative min-h-0 flex-1">
        {tab === "players" && (
          <PlayersTab
            lang={lang}
            players={visiblePlayers}
            query={query}
            posFilter={posFilter}
            sortKey={sortKey}
            searchOpen={searchOpen}
            extraFilters={extraFilters}
            isUserTurn={isUserTurn}
            remainingSlotsNow={userRemaining}
            queueIds={queueIds}
            untilTurn={query ? -1 : untilTurn}
            onQuery={onQuery}
            onFilter={onFilter}
            onSort={onSort}
            onSearchOpen={onSearchOpen}
            onExtraFilters={onExtraFilters}
            onPick={onPick}
            onToggleQueue={onToggleQueue}
          />
        )}
        {tab === "queue" && (
          <QueueTab
            lang={lang}
            players={queuedPlayers}
            isUserTurn={isUserTurn}
            remainingSlotsNow={userRemaining}
            onPick={onPick}
            onToggleQueue={onToggleQueue}
          />
        )}
        {tab === "board" && (
          <BoardTab
            lang={lang}
            board={liveBoard}
            pickIndex={livePickIndex}
            userIndex={userIndex}
            columnRef={userColumnRef}
            onShowMyTeam={onShowMyTeam}
          />
        )}
        {tab === "results" && (
          <ResultsTab
            lang={lang}
            sub={resultsSub}
            onSub={onResultsSub}
            views={teamViews}
            selected={selectedTeam}
            onSelect={onSelectTeam}
            livePicks={livePicks}
            userIndex={userIndex}
            phase={phase}
            onRestart={onClose}
          />
        )}
      </div>

      {userRoster && (
        <RosterStrip lang={lang} roster={userRoster} livePicks={livePicks} />
      )}

      <BottomNav tab={tab} onTab={onTab} c={c} />

      {settingsOpen && (
        <SettingsSheet
          c={c}
          lang={appLang}
          room={room}
          copied={copied}
          onLang={onLang}
          onClose={onSettings}
          onCopyRoom={onCopyRoom}
          onLeave={onClose}
        />
      )}
    </div>
  );
}

function PlayersTab({
  lang,
  players,
  query,
  posFilter,
  sortKey,
  searchOpen,
  extraFilters,
  isUserTurn,
  remainingSlotsNow,
  queueIds,
  untilTurn,
  onQuery,
  onFilter,
  onSort,
  onSearchOpen,
  onExtraFilters,
  onPick,
  onToggleQueue,
}: {
  lang: Lang;
  players: MockPlayer[];
  query: string;
  posFilter: MockPosFilter;
  sortKey: MockSortKey;
  searchOpen: boolean;
  extraFilters: boolean;
  isUserTurn: boolean;
  remainingSlotsNow: ReturnType<typeof remainingSlots>;
  queueIds: string[];
  untilTurn: number;
  onQuery: (q: string) => void;
  onFilter: (f: MockPosFilter) => void;
  onSort: (k: MockSortKey) => void;
  onSearchOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  onExtraFilters: (v: boolean | ((p: boolean) => boolean)) => void;
  onPick: (p: MockPlayer) => void;
  onToggleQueue: (id: string) => void;
}) {
  const c = t(lang);
  const listKey = `${players.length}:${players[0]?.id ?? ""}:${players.at(-1)?.id ?? ""}`;
  const { ref: scrollerRef, onScroll } = useStableListScroll(listKey, "anchor");
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = 0;
  }, [query, posFilter, sortKey, scrollerRef]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-1">
        <IconButton
          label={c.mockOpenSearch}
          onClick={() => onSearchOpen((v) => !v)}
          active={searchOpen}
        >
          <IconSearch />
        </IconButton>
        <IconButton
          label={c.mockOpenFilters}
          onClick={() => onExtraFilters((v) => !v)}
          active={extraFilters}
        >
          <IconSliders />
        </IconButton>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {POS_CHIPS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilter(f)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                posFilter === f
                  ? "bg-[var(--mock-purple)] text-white"
                  : "border border-zinc-200 bg-white text-zinc-600"
              }`}
            >
              {f === "ALL" ? c.mockFilterAll : f === "FD" ? c.mockFilterSkaters : c.mockFilterGoalies}
            </button>
          ))}
        </div>
      </div>
      {searchOpen && (
        <div className="px-3 pb-1">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={c.mockSearchPlayers}
            className="min-h-11 w-full rounded-full border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-[var(--mock-purple)]"
            aria-label={c.mockSearchPlayers}
            autoFocus
          />
        </div>
      )}
      {extraFilters && (
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          {EXTRA_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilter(f)}
              className={`min-h-9 rounded-full border px-2.5 text-xs font-semibold ${
                posFilter === f
                  ? "border-[var(--mock-purple)] bg-[var(--mock-purple-soft)] text-[var(--mock-purple)]"
                  : "border-zinc-200 text-zinc-600"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[1fr_3.25rem_3.25rem] items-end gap-1 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        <span>{c.mockPlayerCol}</span>
        <button
          type="button"
          onClick={() => onSort("yahooRank")}
          className={`text-right ${sortKey === "yahooRank" ? "text-zinc-800 underline decoration-zinc-800" : ""}`}
        >
          {c.mockRank}
        </button>
        <button
          type="button"
          onClick={() => onSort("adp")}
          className={`text-right ${sortKey === "adp" ? "text-zinc-800 underline decoration-zinc-800" : ""}`}
        >
          {c.mockAdp}
        </button>
      </div>
      <ul
        ref={scrollerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white pb-28 [overflow-anchor:none]"
      >
        {players.length === 0 && (
          <li className="px-4 py-6 text-sm text-zinc-500">{c.mockEmptyList}</li>
        )}
        {players.map((p, i) => {
          const fits = assignSlot(p.positions, remainingSlotsNow) !== null;
          const queued = queueIds.includes(p.id);
          return (
            <li key={p.id} data-scroll-anchor={p.id}>
              {untilTurn > 0 && i === untilTurn && (
                <div className="flex justify-center py-1">
                  <span className="rounded-full bg-[var(--mock-purple-soft)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--mock-purple)]">
                    {c.mockYourNextTurn}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-[1fr_3.25rem_3.25rem] items-center gap-1 border-b border-zinc-100 px-2 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleQueue(p.id)}
                    className="shrink-0 p-1 text-zinc-300"
                    aria-label={queued ? c.mockStarRemove : c.mockStarAdd}
                    aria-pressed={queued}
                  >
                    <IconStar filled={queued} />
                  </button>
                  <button
                    type="button"
                    disabled={isUserTurn && !fits}
                    onClick={() => {
                      if (isUserTurn && fits) onPick(p);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                  >
                    <Headshot player={p} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-zinc-900">
                        {formatShortName(p)}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--mock-teal)]">
                        {formatPosTeam(p)}
                      </span>
                    </span>
                    {isUserTurn && (
                      <span
                        className={`shrink-0 text-[10px] font-semibold ${fits ? "text-[var(--mock-purple)]" : "text-zinc-400"}`}
                      >
                        {fits ? c.mockPickPlayer : c.mockNoFit}
                      </span>
                    )}
                  </button>
                </div>
                <span className="text-right text-sm font-semibold tabular text-zinc-800">
                  {formatRank(p.yahooRank)}
                </span>
                <span className="text-right text-sm tabular text-zinc-600">{formatAdp(p.adp, lang)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QueueTab({
  lang,
  players,
  isUserTurn,
  remainingSlotsNow,
  onPick,
  onToggleQueue,
}: {
  lang: Lang;
  players: MockPlayer[];
  isUserTurn: boolean;
  remainingSlotsNow: ReturnType<typeof remainingSlots>;
  onPick: (p: MockPlayer) => void;
  onToggleQueue: (id: string) => void;
}) {
  const c = t(lang);
  return (
    <ul className="h-full overflow-y-auto bg-white pb-28">
      {players.length === 0 && (
        <li className="px-6 py-10 text-center text-sm text-zinc-500">{c.mockQueueEmpty}</li>
      )}
      {players.map((p) => {
        const fits = assignSlot(p.positions, remainingSlotsNow) !== null;
        return (
          <li key={p.id} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
            <button
              type="button"
              onClick={() => onToggleQueue(p.id)}
              className="p-1 text-[var(--mock-purple)]"
              aria-label={c.mockStarRemove}
            >
              <IconStar filled />
            </button>
            <Headshot player={p} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{formatShortName(p)}</p>
              <p className="truncate text-[11px] text-[var(--mock-teal)]">{formatPosTeam(p)}</p>
            </div>
            <span className="w-10 text-right text-sm tabular">{formatRank(p.yahooRank)}</span>
            {isUserTurn && (
              <button
                type="button"
                disabled={!fits}
                onClick={() => onPick(p)}
                className="min-h-9 rounded-full bg-[var(--mock-purple)] px-3 text-xs font-semibold text-white disabled:opacity-40"
              >
                {fits ? c.mockPickPlayer : c.mockNoFit}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BoardTab({
  lang,
  board,
  pickIndex,
  userIndex,
  columnRef,
  onShowMyTeam,
}: {
  lang: Lang;
  board: (MockDraftPickRecord | null)[];
  pickIndex: number;
  userIndex: number | null;
  columnRef: RefObject<HTMLDivElement | null>;
  onShowMyTeam: () => void;
}) {
  const c = t(lang);
  return (
    <div className="relative h-full">
      <div className="h-full overflow-auto pb-24" data-mock-board-scroll>
        <div
          className="grid min-w-[72rem] gap-px p-2"
          style={{ gridTemplateColumns: `repeat(${MOCK_TEAM_COUNT}, minmax(5.2rem, 1fr))` }}
        >
          {Array.from({ length: MOCK_TEAM_COUNT }, (_, team) => (
            <div
              key={`h-${team}`}
              ref={team === userIndex ? columnRef : undefined}
              className="flex flex-col items-center gap-1 pb-1"
            >
              <JerseyAvatar color={SEAT_COLORS[team % SEAT_COLORS.length]} isYou={team === userIndex} />
              <span
                className={`truncate text-[10px] font-medium ${
                  team === userIndex ? "text-[var(--mock-purple)]" : "text-zinc-600"
                }`}
              >
                {seatLabel(c, team, userIndex)}
              </span>
            </div>
          ))}
          {Array.from({ length: MOCK_ROUNDS }, (_, round) =>
            Array.from({ length: MOCK_TEAM_COUNT }, (_, team) => {
              const overall = pickIndexForTeamRound(team, round);
              const pick = board[overall];
              const current = overall === pickIndex;
              const ltr = round % 2 === 0;
              const wrapDown = ltr ? team === MOCK_TEAM_COUNT - 1 : team === 0;
              const arrow = wrapDown ? "↓" : ltr ? "→" : "←";
              return (
                <div
                  key={`${round}-${team}`}
                  className={`relative min-h-[4.25rem] rounded-md bg-white p-1.5 text-[10px] leading-tight ${
                    current
                      ? "ring-2 ring-[var(--mock-purple)]"
                      : team === userIndex
                        ? "bg-[var(--mock-purple-soft)]/50"
                        : "bg-zinc-50"
                  }`}
                >
                  {current && (
                    <p className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-[var(--mock-purple)]">
                      <IconClock />
                      {c.mockOnTheClock}
                    </p>
                  )}
                  {pick ? (
                    <>
                      <p className="truncate font-semibold text-zinc-900">{pick.player.lastName}</p>
                      <p className="text-[var(--mock-teal)]">{formatPosTeam(pick.player)}</p>
                    </>
                  ) : (
                    <p className="pt-3 text-center text-zinc-400 tabular">{boardCellLabel(team, round)}</p>
                  )}
                  <span className="absolute bottom-0.5 right-1 text-zinc-300">{arrow}</span>
                </div>
              );
            }),
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onShowMyTeam}
        className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[var(--mock-purple)] px-4 py-2 text-sm font-semibold text-white shadow-lg"
      >
        {c.mockShowMyTeam}
      </button>
    </div>
  );
}

function ResultsTab({
  lang,
  sub,
  onSub,
  views,
  selected,
  onSelect,
  livePicks,
  userIndex,
  phase,
  onRestart,
}: {
  lang: Lang;
  sub: ResultsSub;
  onSub: (s: ResultsSub) => void;
  views: ReturnType<typeof rosterByTeamViews>;
  selected: number;
  onSelect: (n: number) => void;
  livePicks: MockDraftPickRecord[];
  userIndex: number | null;
  phase: "drafting" | "done";
  onRestart: () => void;
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
  const listKey = `${livePicks.length}:${livePicks.at(-1)?.pickIndex ?? ""}`;
  const { ref: scrollerRef, onScroll } = useStableListScroll(listKey, "bottom");

  if (!view || !roster) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f8fc] pb-24">
      <div className="mx-3 mt-1 grid grid-cols-2 rounded-full bg-zinc-200/70 p-1">
        <button
          type="button"
          onClick={() => onSub("rosters")}
          className={`min-h-9 rounded-full text-sm font-medium ${
            sub === "rosters" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
          }`}
        >
          {c.mockRosters}
        </button>
        <button
          type="button"
          onClick={() => onSub("picks")}
          className={`min-h-9 rounded-full text-sm font-medium ${
            sub === "picks" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
          }`}
        >
          {c.mockPicksTab}
        </button>
      </div>

      {sub === "rosters" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="mx-3 mt-3 flex items-center justify-between rounded-full border border-zinc-200 bg-white px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <JerseyAvatar
                color={SEAT_COLORS[view.teamIndex % SEAT_COLORS.length]}
                isYou={view.isUser}
                size={28}
              />
              <select
                value={selected}
                onChange={(e) => onSelect(Number(e.target.value))}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                aria-label={c.mockSelectTeam}
              >
                {views.map((team) => (
                  <option key={team.teamIndex} value={team.teamIndex}>
                    {team.isUser ? c.mockYourTeam : c.mockTeam.replace("{n}", String(team.seat))}
                  </option>
                ))}
              </select>
            </span>
            <span className="text-xs text-zinc-500">
              {c.mockFilledOf.replace("{n}", String(view.picks.length)).replace("{total}", String(MOCK_ROUNDS))}
            </span>
          </label>
          <div className="mt-2 grid grid-cols-[3rem_1fr_3rem] px-4 text-[10px] uppercase tracking-wide text-zinc-400">
            <span>{c.mockSlotCol}</span>
            <span>{c.mockPlayerCol}</span>
            <span className="text-right">{c.mockPickCol}</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto bg-white">
            {stripSlotsFromRoster(roster, byId).map((row, i) => (
              <li
                key={`${row.slot}-${i}`}
                className="grid grid-cols-[3rem_1fr_3rem] items-center border-b border-zinc-100 px-4 py-2.5"
              >
                <SlotBadge slot={row.slot} />
                <p className="min-w-0 truncate text-sm text-zinc-900">
                  {row.player ? formatDraftedLabel(row.player) : ""}
                </p>
                <span className="text-right text-xs tabular text-zinc-400">
                  {row.pickIndex != null ? row.pickIndex + 1 : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sub === "picks" && (
        <ul
          ref={scrollerRef}
          onScroll={onScroll}
          className="mt-2 min-h-0 flex-1 overflow-y-auto bg-white [overflow-anchor:none]"
        >
          {livePicks.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">—</li>}
          {livePicks.map((p) => (
            <li
              key={p.pickIndex}
              data-scroll-anchor={String(p.pickIndex)}
              className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2"
            >
              <span className="w-8 shrink-0 text-xs tabular text-zinc-400">#{p.pickIndex + 1}</span>
              <Headshot player={p.player} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{formatShortName(p.player)}</p>
                <p className="truncate text-[11px] text-[var(--mock-teal)]">{formatPosTeam(p.player)}</p>
              </div>
              <span className="text-xs text-zinc-500">{seatLabel(c, p.teamIndex, userIndex)}</span>
            </li>
          ))}
        </ul>
      )}

      {phase === "done" && (
        <button
          type="button"
          onClick={onRestart}
          className="mx-3 mt-2 min-h-11 rounded-full bg-[var(--mock-purple)] text-sm font-semibold text-white"
        >
          {c.mockRestart}
        </button>
      )}
    </div>
  );
}

function RosterStrip({
  lang,
  roster,
  livePicks,
}: {
  lang: Lang;
  roster: TeamRoster;
  livePicks: MockDraftPickRecord[];
}) {
  const c = t(lang);
  const byId = useMemo(() => {
    const map = new Map<string, MockPlayer>();
    for (const p of livePicks) map.set(p.player.id, p.player);
    return map;
  }, [livePicks]);
  const items = stripSlotsFromRoster(roster, byId);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[4.25rem] z-20 flex justify-center px-2">
      <div className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full border border-zinc-200 bg-white/95 px-2 py-1.5 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => (
          <div
            key={`${item.slot}-${i}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-white"
            title={item.player ? formatDraftedLabel(item.player) : item.slot === "BN" ? c.mockBenchShort : item.slot}
          >
            {item.player ? (
              <Headshot player={item.player} size={32} />
            ) : (
              <span className="text-[10px] font-bold text-[var(--mock-teal)]">
                {item.slot === "BN" ? c.mockBenchShort : item.slot}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomNav({
  tab,
  onTab,
  c,
}: {
  tab: DraftTab;
  onTab: (t: DraftTab) => void;
  c: Copy;
}) {
  const items: Array<{ id: DraftTab; label: string; icon: ReactNode }> = [
    { id: "players", label: c.mockTabPlayers, icon: <IconPlayers /> },
    { id: "queue", label: c.mockTabQueue, icon: <IconQueue /> },
    { id: "board", label: c.mockTabBoard, icon: <IconBoard /> },
    { id: "results", label: c.mockTabResults, icon: <IconResults /> },
  ];
  return (
    <nav
      className="relative z-30 grid grid-cols-4 border-t border-zinc-200 bg-white/95 px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1"
      aria-label={c.mockTitle}
    >
      {items.map((item) => {
        const on = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={`flex flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-medium ${
              on ? "bg-[var(--mock-purple-soft)] text-[var(--mock-purple)]" : "text-zinc-500"
            }`}
            aria-current={on ? "page" : undefined}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function SettingsSheet({
  c,
  lang,
  room,
  copied,
  onLang,
  onClose,
  onCopyRoom,
  onLeave,
}: {
  c: Copy;
  lang: Lang;
  room: RoomState | null;
  copied: boolean;
  onLang: (code: Lang) => void;
  onClose: () => void;
  onCopyRoom?: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/30" onClick={onClose} role="presentation">
      <div
        className="w-full rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={c.settings}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">{c.appTitle}</p>
          <button type="button" onClick={onClose} className="text-sm text-[var(--mock-purple)]">
            {c.close}
          </button>
        </div>
        <div className="mb-3 flex overflow-hidden rounded-full border border-zinc-200 text-xs">
          {(["fi", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onLang(code)}
              className={`flex-1 py-2 uppercase ${lang === code ? "bg-[var(--mock-purple)] text-white" : "text-zinc-500"}`}
            >
              {code}
            </button>
          ))}
        </div>
        {room && onCopyRoom && (
          <button
            type="button"
            onClick={onCopyRoom}
            className="mb-2 min-h-11 w-full rounded-full border border-zinc-200 text-sm"
          >
            {copied ? c.mockCopied : `${c.mockCopyLink} · ${room.id}`}
          </button>
        )}
        <a
          href="/"
          className="mb-2 flex min-h-11 w-full items-center justify-center rounded-full border border-zinc-200 text-sm"
        >
          {c.helperNav}
        </a>
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 w-full rounded-full bg-[var(--mock-purple)] text-sm font-semibold text-white"
        >
          {c.mockRestart}
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">{c.mockDataSource}</p>
        <p className="mt-1 text-[11px] text-zinc-400">{c.mockLeagueDefaults}</p>
      </div>
    </div>
  );
}

function Headshot({ player, size }: { player: MockPlayer; size: number }) {
  const [failed, setFailed] = useState(false);
  const url = player.headshot;
  if (!url || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-bold text-zinc-600"
        style={{ width: size, height: size }}
      >
        {(player.lastName || player.name).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // Yahoo headshots are remote; regular img avoids next/image remote-config.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-zinc-100 object-cover"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function SlotBadge({ slot }: { slot: MockSlot }) {
  return (
    <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-[11px] font-bold text-[var(--mock-teal)]">
      {slot}
    </span>
  );
}

function JerseyAvatar({
  color,
  onClock = false,
  isYou = false,
  size = 36,
}: {
  color: string;
  onClock?: boolean;
  isYou?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full ${
        onClock || isYou ? "ring-2 ring-[var(--mock-purple)] ring-offset-1" : ""
      }`}
      style={{ width: size, height: size, background: color }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" aria-hidden>
        <path
          d="M8 4h8l2 3v2h-2v11H8V9H6V7l2-3z"
          fill="white"
          fillOpacity="0.9"
        />
      </svg>
    </span>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border ${
        active
          ? "border-[var(--mock-purple)] bg-[var(--mock-purple-soft)] text-[var(--mock-purple)]"
          : "border-zinc-200 bg-white text-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 12l1.5-1.2-1-2.6-1.9.2a7.2 7.2 0 0 0-1.5-.9l-.4-1.9H10.3l-.4 1.9a7.2 7.2 0 0 0-1.5.9l-1.9-.2-1 2.6L7 12l-1.5 1.2 1 2.6 1.9-.2c.5.35 1 .66 1.5.9l.4 1.9h3.4l.4-1.9c.5-.24 1.02-.55 1.5-.9l1.9.2 1-2.6L19 12z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="7" r="1.6" fill="currentColor" />
      <circle cx="14" cy="12" r="1.6" fill="currentColor" />
      <circle cx="10" cy="17" r="1.6" fill="currentColor" />
    </svg>
  );
}

function IconStar({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.5l2.4 5.3 5.8.6-4.4 3.8 1.3 5.7L12 16.6 6.9 18.9l1.3-5.7L3.8 9.4l5.8-.6L12 3.5z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlayers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.5 19c.8-3.2 3.3-5 6.5-5s5.7 1.8 6.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconQueue() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7h14M5 12h14M5 17h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 5v4M8 10v4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconBoard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 10h16M10 5v14M14 5v14" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconResults() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 12.5l2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
