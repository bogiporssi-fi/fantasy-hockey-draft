import { formatEligibility, orderedPositions } from "./positions";
import { FANTASY_POSITIONS, type FantasyPosition } from "./types";

export const MOCK_TEAM_COUNT = 20;
export const MOCK_ROUNDS = 16;
export const MOCK_TOTAL_PICKS = MOCK_TEAM_COUNT * MOCK_ROUNDS;
export const BOT_TOP_N = 3;

export type MockSlot = FantasyPosition | "BN";

export interface MockSlotCounts {
  C: number;
  LW: number;
  RW: number;
  D: number;
  G: number;
  BN: number;
}

/** Kimppa defaults: 2C / 2LW / 2RW / 4D / 2G + 4 BN. */
export const MOCK_SLOT_LIMITS: MockSlotCounts = {
  C: 2,
  LW: 2,
  RW: 2,
  D: 4,
  G: 2,
  BN: 4,
};

export interface MockPlayer {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  team: string;
  displayPosition: string;
  positions: FantasyPosition[];
  adp: number | null;
  yahooRank: number | null;
  headshot?: string | null;
}

export type MockSortKey = "adp" | "yahooRank";
export type MockPosFilter = FantasyPosition | "ALL" | "FD";

/** Sticky strip: C,C,LW,LW,RW,RW,D,D,D,D,G,G + BN×4. */
export const ROSTER_STRIP_SLOTS: MockSlot[] = [
  "C",
  "C",
  "LW",
  "LW",
  "RW",
  "RW",
  "D",
  "D",
  "D",
  "D",
  "G",
  "G",
  "BN",
  "BN",
  "BN",
  "BN",
];

export interface RosterPick {
  playerId: string;
  slot: MockSlot;
  pickIndex: number;
}

export interface TeamRoster {
  teamIndex: number;
  picks: RosterPick[];
  filled: MockSlotCounts;
}

export function emptySlotCounts(): MockSlotCounts {
  return { C: 0, LW: 0, RW: 0, D: 0, G: 0, BN: 0 };
}

export function remainingSlots(
  filled: MockSlotCounts,
  limits: MockSlotCounts = MOCK_SLOT_LIMITS,
): MockSlotCounts {
  return {
    C: Math.max(0, limits.C - filled.C),
    LW: Math.max(0, limits.LW - filled.LW),
    RW: Math.max(0, limits.RW - filled.RW),
    D: Math.max(0, limits.D - filled.D),
    G: Math.max(0, limits.G - filled.G),
    BN: Math.max(0, limits.BN - filled.BN),
  };
}

export function createEmptyRosters(teamCount: number = MOCK_TEAM_COUNT): TeamRoster[] {
  return Array.from({ length: teamCount }, (_, teamIndex) => ({
    teamIndex,
    picks: [],
    filled: emptySlotCounts(),
  }));
}

/** 0-based pick index → 0-based team index in a snake draft. */
export function snakeTeamIndex(pickIndex: number, teamCount: number = MOCK_TEAM_COUNT): number {
  if (teamCount <= 0) throw new Error("teamCount must be positive");
  const round = Math.floor(pickIndex / teamCount);
  const posInRound = pickIndex % teamCount;
  if (round % 2 === 0) return posInRound;
  return teamCount - 1 - posInRound;
}

/** 1-based draft slot (1–20). */
export function snakeDraftSlot(pickIndex: number, teamCount: number = MOCK_TEAM_COUNT): number {
  return snakeTeamIndex(pickIndex, teamCount) + 1;
}

export function roundOfPick(pickIndex: number, teamCount: number = MOCK_TEAM_COUNT): number {
  return Math.floor(pickIndex / teamCount) + 1;
}

/** Board cell (team column, 0-based round) → overall pick index in snake order. */
export function pickIndexForTeamRound(
  teamIndex: number,
  roundZero: number,
  teamCount: number = MOCK_TEAM_COUNT,
): number {
  if (roundZero % 2 === 0) return roundZero * teamCount + teamIndex;
  return roundZero * teamCount + (teamCount - 1 - teamIndex);
}

export function buildSnakeOrder(teamCount: number, rounds: number): number[] {
  const order: number[] = [];
  for (let r = 0; r < rounds; r++) {
    if (r % 2 === 0) {
      for (let t = 0; t < teamCount; t++) order.push(t);
    } else {
      for (let t = teamCount - 1; t >= 0; t--) order.push(t);
    }
  }
  return order;
}

export function yahooMarks(positions: FantasyPosition[]): FantasyPosition[] {
  const allowed = new Set<FantasyPosition>(FANTASY_POSITIONS);
  const seen = new Set<FantasyPosition>();
  const out: FantasyPosition[] = [];
  for (const pos of positions) {
    if (!allowed.has(pos) || seen.has(pos)) continue;
    seen.add(pos);
    out.push(pos);
  }
  return out;
}

export function isGoalieOnly(positions: FantasyPosition[]): boolean {
  const marks = yahooMarks(positions);
  return marks.length > 0 && marks.every((p) => p === "G");
}

/**
 * Open starter (C/LW/RW/D/G) this player can fill.
 * Prefers the tightest remaining matching slot; ties follow C → LW → RW → D → G.
 */
export function starterSlotFor(
  positions: FantasyPosition[],
  remaining: MockSlotCounts,
): FantasyPosition | null {
  const marks = yahooMarks(positions);
  let best: FantasyPosition | null = null;
  let bestRem = Infinity;
  for (const pos of FANTASY_POSITIONS) {
    if (!marks.includes(pos)) continue;
    const rem = remaining[pos];
    if (rem > 0 && rem < bestRem) {
      best = pos;
      bestRem = rem;
    }
  }
  return best;
}

/**
 * Assign a drafted player to a roster slot.
 * Starters first; if those are full → BN for any non-G. Goalies only into G slots.
 */
export function assignSlot(
  positions: FantasyPosition[],
  remaining: MockSlotCounts,
): MockSlot | null {
  const starter = starterSlotFor(positions, remaining);
  if (starter) return starter;
  if (remaining.BN > 0 && !isGoalieOnly(positions)) return "BN";
  return null;
}

export function canFillStarter(
  positions: FantasyPosition[],
  remaining: MockSlotCounts,
): boolean {
  return starterSlotFor(positions, remaining) !== null;
}

export function playerFitsRoster(
  positions: FantasyPosition[],
  remaining: MockSlotCounts,
): boolean {
  return assignSlot(positions, remaining) !== null;
}

function compareNullableAsc(
  aVal: number | null,
  bVal: number | null,
  aName: string,
  bName: string,
): number {
  const aOk = aVal != null && Number.isFinite(aVal);
  const bOk = bVal != null && Number.isFinite(bVal);
  if (!aOk) {
    if (!bOk) return aName.localeCompare(bName);
    return 1;
  }
  if (!bOk) return -1;
  if (aVal !== bVal) return (aVal as number) - (bVal as number);
  return aName.localeCompare(bName);
}

export function compareAdp(a: MockPlayer, b: MockPlayer): number {
  return compareNullableAsc(a.adp, b.adp, a.name, b.name);
}

export function compareYahooRank(a: MockPlayer, b: MockPlayer): number {
  return compareNullableAsc(a.yahooRank, b.yahooRank, a.name, b.name);
}

export function sortByAdp(players: MockPlayer[]): MockPlayer[] {
  return [...players].sort(compareAdp);
}

export function sortPlayers(players: MockPlayer[], key: MockSortKey = "adp"): MockPlayer[] {
  return [...players].sort(key === "yahooRank" ? compareYahooRank : compareAdp);
}

export function matchesPosFilter(player: MockPlayer, filter: MockPosFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "FD") return player.positions.some((p) => p !== "G");
  return player.positions.includes(filter);
}

/** List name: "Z. WERENSKI". */
export function formatShortName(player: Pick<MockPlayer, "firstName" | "lastName" | "name">): string {
  const last = (player.lastName || player.name).trim().toUpperCase();
  const first = (player.firstName || "").trim();
  const initial = first.charAt(0).toUpperCase();
  return initial ? `${initial}. ${last}` : last;
}

/** Subline: "C • EDM" or "C,LW • NJ". */
export function formatPosTeam(player: Pick<MockPlayer, "positions" | "team">): string {
  const pos = orderedPositions(player.positions).join(",");
  const team = player.team.trim();
  if (!pos) return team;
  return team ? `${pos} • ${team}` : pos;
}

/** Own-roster line: "Elias Pettersson, VAN, C/LW". */
export function formatDraftedLabel(player: Pick<MockPlayer, "name" | "team" | "positions">): string {
  const parts: string[] = [];
  const name = player.name.trim();
  if (name) parts.push(name);
  const team = player.team.trim();
  if (team) parts.push(team);
  const pos = formatEligibility(player.positions);
  if (pos) parts.push(pos);
  return parts.join(", ");
}

/** Ticker: "A. MATTHEWS (C • TOR)". */
export function formatLastPickTicker(
  player: Pick<MockPlayer, "firstName" | "lastName" | "name" | "positions" | "team">,
): string {
  return `${formatShortName(player)} (${formatPosTeam(player)})`;
}

/** Picks until this seat is on the clock (0 = now). -1 if the seat is unknown. */
export function picksUntilTurn(
  pickIndex: number,
  userIndex: number | null,
  teamCount: number = MOCK_TEAM_COUNT,
): number {
  if (userIndex == null || userIndex < 0 || userIndex >= teamCount) return -1;
  const horizon = teamCount * 2;
  for (let i = 0; i < horizon; i++) {
    if (snakeTeamIndex(pickIndex + i, teamCount) === userIndex) return i;
  }
  return -1;
}

/** Board cell label: round.pickInRound, e.g. 1.1 or 2.20 (snake). */
export function boardCellLabel(
  teamIndex: number,
  roundZero: number,
  teamCount: number = MOCK_TEAM_COUNT,
): string {
  const round = roundZero + 1;
  const pickInRound = roundZero % 2 === 0 ? teamIndex + 1 : teamCount - teamIndex;
  return `${round}.${pickInRound}`;
}

export function stripSlotsFromRoster(
  roster: TeamRoster,
  playersById: Map<string, MockPlayer>,
  slots: MockSlot[] = ROSTER_STRIP_SLOTS,
): Array<{ slot: MockSlot; player: MockPlayer | null; pickIndex: number | null }> {
  const remaining = [...roster.picks];
  return slots.map((slot) => {
    const idx = remaining.findIndex((p) => p.slot === slot);
    if (idx < 0) return { slot, player: null, pickIndex: null };
    const [pick] = remaining.splice(idx, 1);
    return {
      slot,
      player: playersById.get(pick.playerId) ?? null,
      pickIndex: pick.pickIndex,
    };
  });
}

/** Most recent first. Accepts a compact pick list or a sparse board. */
export function lastNPicks(
  picks: Array<MockDraftPickRecord | null | undefined>,
  n = 10,
): MockDraftPickRecord[] {
  if (n <= 0) return [];
  const filled = picks.filter((p): p is MockDraftPickRecord => Boolean(p));
  return filled.slice(-n).reverse();
}

export interface TeamRosterView {
  teamIndex: number;
  seat: number;
  isUser: boolean;
  picks: MockDraftPickRecord[];
  filled: MockSlotCounts;
}

/** One row per seat (1–20) with that team's drafted players. */
export function rosterByTeamViews(
  picks: MockDraftPickRecord[],
  userTeamIndex: number | null,
  teamCount: number = MOCK_TEAM_COUNT,
): TeamRosterView[] {
  const grouped: MockDraftPickRecord[][] = Array.from({ length: teamCount }, () => []);
  for (const pick of picks) {
    if (pick.teamIndex < 0 || pick.teamIndex >= teamCount) continue;
    grouped[pick.teamIndex].push(pick);
  }
  return grouped.map((teamPicks, teamIndex) => ({
    teamIndex,
    seat: teamIndex + 1,
    isUser: userTeamIndex === teamIndex,
    picks: teamPicks,
    filled: teamPicks.reduce((acc, p) => {
      acc[p.slot] += 1;
      return acc;
    }, emptySlotCounts()),
  }));
}

export function rostersFromPicks(
  picks: MockDraftPickRecord[],
  teamCount: number = MOCK_TEAM_COUNT,
): TeamRoster[] {
  const rosters = createEmptyRosters(teamCount);
  for (const pick of picks) {
    if (pick.teamIndex < 0 || pick.teamIndex >= teamCount) continue;
    const roster = rosters[pick.teamIndex];
    rosters[pick.teamIndex] = {
      ...roster,
      picks: [
        ...roster.picks,
        { playerId: pick.player.id, slot: pick.slot, pickIndex: pick.pickIndex },
      ],
      filled: { ...roster.filled, [pick.slot]: roster.filled[pick.slot] + 1 },
    };
  }
  return rosters;
}

export function sparseBoard(
  picks: MockDraftPickRecord[],
  total: number = MOCK_TOTAL_PICKS,
): (MockDraftPickRecord | null)[] {
  const board = Array.from({ length: total }, () => null as MockDraftPickRecord | null);
  for (const pick of picks) {
    if (pick.pickIndex >= 0 && pick.pickIndex < total) board[pick.pickIndex] = pick;
  }
  return board;
}

export function remainingFromPicks(pool: MockPlayer[], picks: MockDraftPickRecord[]): MockPlayer[] {
  const taken = new Set(picks.map((p) => p.player.id));
  return pool.filter((p) => !taken.has(p.id));
}

/** ADP-sorted players that fill an open starter, else BN-eligible players. */
export function needAwareCandidates(
  remainingPlayers: MockPlayer[],
  remaining: MockSlotCounts,
): MockPlayer[] {
  const sorted = sortByAdp(remainingPlayers);
  const starters = sorted.filter((p) => canFillStarter(p.positions, remaining));
  if (starters.length > 0) return starters;
  return sorted.filter((p) => assignSlot(p.positions, remaining) === "BN");
}

/** Small random weight among the top N need-aware names so mocks differ. */
export function weightedIndex(size: number, rng: () => number): number {
  if (size <= 0) return 0;
  const weights = Array.from({ length: size }, (_, i) => size - i);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < size; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return size - 1;
}

export function chooseBotPick(
  remainingPlayers: MockPlayer[],
  remaining: MockSlotCounts,
  rng: () => number = Math.random,
  topN: number = BOT_TOP_N,
): MockPlayer | null {
  const candidates = needAwareCandidates(remainingPlayers, remaining);
  if (candidates.length === 0) return null;
  const pool = candidates.slice(0, Math.min(topN, candidates.length));
  return pool[weightedIndex(pool.length, rng)] ?? null;
}

export function applyPick(
  roster: TeamRoster,
  player: MockPlayer,
  pickIndex: number,
  limits: MockSlotCounts = MOCK_SLOT_LIMITS,
): TeamRoster | null {
  const remaining = remainingSlots(roster.filled, limits);
  const slot = assignSlot(player.positions, remaining);
  if (!slot) return null;
  return {
    ...roster,
    picks: [...roster.picks, { playerId: player.id, slot, pickIndex }],
    filled: { ...roster.filled, [slot]: roster.filled[slot] + 1 },
  };
}

export function rosterRespectsLimits(
  roster: TeamRoster,
  limits: MockSlotCounts = MOCK_SLOT_LIMITS,
): boolean {
  const keys: (keyof MockSlotCounts)[] = ["C", "LW", "RW", "D", "G", "BN"];
  for (const key of keys) {
    if (roster.filled[key] > limits[key]) return false;
    if (roster.filled[key] < 0) return false;
  }
  const pickSum = keys.reduce((sum, key) => sum + roster.filled[key], 0);
  return pickSum === roster.picks.length;
}

export interface MockDraftPickRecord {
  pickIndex: number;
  teamIndex: number;
  player: MockPlayer;
  slot: MockSlot;
  by: "human" | "bot";
}

export interface SimulateResult {
  rosters: TeamRoster[];
  board: MockDraftPickRecord[];
  remaining: MockPlayer[];
}

/** Run a full snake mock (all bots, or a human picker callback). */
export function simulateMockDraft(
  pool: MockPlayer[],
  options: {
    teamCount?: number;
    rounds?: number;
    userSlot?: number | null;
    humanPick?: (
      remaining: MockPlayer[],
      roster: TeamRoster,
      pickIndex: number,
    ) => MockPlayer | null;
    rng?: () => number;
  } = {},
): SimulateResult {
  const teamCount = options.teamCount ?? MOCK_TEAM_COUNT;
  const rounds = options.rounds ?? MOCK_ROUNDS;
  const total = teamCount * rounds;
  const rng = options.rng ?? Math.random;
  const userIndex =
    options.userSlot != null && options.userSlot >= 1 && options.userSlot <= teamCount
      ? options.userSlot - 1
      : null;

  const rosters = createEmptyRosters(teamCount);
  let remaining = [...pool];
  const board: MockDraftPickRecord[] = [];

  for (let pickIndex = 0; pickIndex < total; pickIndex++) {
    const teamIndex = snakeTeamIndex(pickIndex, teamCount);
    const roster = rosters[teamIndex];
    const slotsLeft = remainingSlots(roster.filled);
    const isHuman = userIndex === teamIndex && options.humanPick;
    const player = isHuman
      ? options.humanPick!(remaining, roster, pickIndex)
      : chooseBotPick(remaining, slotsLeft, rng);
    if (!player) {
      throw new Error(`No legal pick at index ${pickIndex} for team ${teamIndex}`);
    }
    const next = applyPick(roster, player, pickIndex);
    if (!next) {
      throw new Error(`Player ${player.name} does not fit team ${teamIndex} at pick ${pickIndex}`);
    }
    rosters[teamIndex] = next;
    remaining = remaining.filter((p) => p.id !== player.id);
    board.push({
      pickIndex,
      teamIndex,
      player,
      slot: next.picks[next.picks.length - 1].slot,
      by: isHuman ? "human" : "bot",
    });
  }

  return { rosters, board, remaining };
}
