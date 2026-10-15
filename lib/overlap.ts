import type {
  CandidateMetrics,
  FantasyPosition,
  NightOutcome,
  SlotConfig,
  StartSlot,
  WeekMetrics,
  WeekWindow,
} from "./types";
import { FANTASY_POSITIONS } from "./types";
import { addDays } from "./weeks";

export interface EligiblePlayer {
  id: string;
  positions: FantasyPosition[];
}

export interface NightFill {
  started: Map<string, StartSlot>;
  benched: string[];
  remaining: Record<StartSlot, number>;
}

const START_ORDER: StartSlot[] = ["C", "LW", "RW", "D", "G", "UTIL"];

export function emptyRemaining(slots: SlotConfig): Record<StartSlot, number> {
  return {
    C: slots.C,
    LW: slots.LW,
    RW: slots.RW,
    D: slots.D,
    G: slots.G,
    UTIL: slots.UTIL,
  };
}

function slotCount(slots: SlotConfig, key: StartSlot): number {
  const n = slots[key];
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function normalizedCaps(slots: SlotConfig): Record<StartSlot, number> {
  return {
    C: slotCount(slots, "C"),
    LW: slotCount(slots, "LW"),
    RW: slotCount(slots, "RW"),
    D: slotCount(slots, "D"),
    G: slotCount(slots, "G"),
    UTIL: slotCount(slots, "UTIL"),
  };
}

/** Only Yahoo marks on the player. Never NHL default, never an unmarked slot. */
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

/**
 * Single-player preference against leftover counts.
 * Tightest open marked slot, then UTIL. Nightly assignment does not use this.
 */
export function pickSlot(
  positions: FantasyPosition[],
  remaining: Record<StartSlot, number>,
): StartSlot | null {
  const marks = yahooMarks(positions);
  let best: FantasyPosition | null = null;
  let bestRem = Infinity;
  for (const pos of marks) {
    const rem = remaining[pos] ?? 0;
    if (rem > 0 && rem < bestRem) {
      best = pos;
      bestRem = rem;
    }
  }
  if (best) return best;
  if ((remaining.UTIL ?? 0) > 0) return "UTIL";
  return null;
}

/** UTIL is a league slot, not a Yahoo mark. Any player may use it, including goalies. */
function canPlay(player: EligiblePlayer, slot: StartSlot): boolean {
  if (slot === "UTIL") return true;
  return yahooMarks(player.positions).includes(slot);
}

/** First row wins when the same id appears twice. */
export function dedupePlayers(players: EligiblePlayer[]): EligiblePlayer[] {
  const seen = new Set<string>();
  const out: EligiblePlayer[] = [];
  for (const player of players) {
    if (seen.has(player.id)) continue;
    seen.add(player.id);
    out.push(player);
  }
  return out;
}

function byNarrowThenId(a: EligiblePlayer, b: EligiblePlayer): number {
  const diff = yahooMarks(a.positions).length - yahooMarks(b.positions).length;
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

/** Cardinality only. Edge order does not matter. */
function maximumMatchingSize(players: EligiblePlayer[], caps: Record<StartSlot, number>): number {
  const copies: StartSlot[] = [];
  for (const slot of START_ORDER) {
    for (let i = 0; i < caps[slot]; i++) copies.push(slot);
  }
  const adj = players.map((player) => {
    const edges: number[] = [];
    for (let i = 0; i < copies.length; i++) {
      if (canPlay(player, copies[i])) edges.push(i);
    }
    return edges;
  });
  const matchTo = new Array<number>(copies.length).fill(-1);
  const dfs = (u: number, seen: boolean[]): boolean => {
    for (const v of adj[u]) {
      if (seen[v]) continue;
      seen[v] = true;
      const holder = matchTo[v];
      if (holder === -1 || dfs(holder, seen)) {
        matchTo[v] = u;
        return true;
      }
    }
    return false;
  };
  let count = 0;
  for (let u = 0; u < players.length; u++) {
    if (dfs(u, new Array(copies.length).fill(false))) count++;
  }
  return count;
}

/**
 * Maximum bipartite matching of players to slot copies.
 * Among maximum matchings, earlier players (narrower Yahoo marks, then id)
 * keep the earliest slot in C → LW → RW → D → G → UTIL that still allows
 * a maximum matching of everyone else.
 * BN is a roster cap, not a nightly slot.
 */
export function assignNight(players: EligiblePlayer[], slots: SlotConfig): NightFill {
  const caps = normalizedCaps(slots);
  const ordered = dedupePlayers(players).sort(byNarrowThenId);
  let need = maximumMatchingSize(ordered, caps);
  const started = new Map<string, StartSlot>();
  const benched: string[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const player = ordered[i];
    const rest = ordered.slice(i + 1);
    let placed: StartSlot | null = null;
    for (const slot of START_ORDER) {
      if (caps[slot] <= 0 || !canPlay(player, slot)) continue;
      caps[slot] -= 1;
      const restMax = maximumMatchingSize(rest, caps);
      if (restMax === need - 1) {
        placed = slot;
        need = restMax;
        break;
      }
      caps[slot] += 1;
    }
    if (placed) started.set(player.id, placed);
    else benched.push(player.id);
  }

  return { started, benched, remaining: caps };
}

export function openEligibleSlots(
  remaining: Record<StartSlot, number>,
  positions: FantasyPosition[],
): number {
  let open = 0;
  for (const pos of yahooMarks(positions)) open += remaining[pos] ?? 0;
  open += remaining.UTIL ?? 0;
  return open;
}

export interface EvaluateInput {
  slots: SlotConfig;
  roster: EligiblePlayer[];
  rosterGames: Map<string, Set<string>>;
  candidate: EligiblePlayer;
  candidateGames: { date: string; opponent: string; home: boolean }[];
  weeks: WeekWindow[];
}

function playingOn(
  roster: EligiblePlayer[],
  rosterGames: Map<string, Set<string>>,
  date: string,
  ignoreId: string,
): EligiblePlayer[] {
  return dedupePlayers(
    roster.filter((player) => player.id !== ignoreId && rosterGames.get(player.id)?.has(date)),
  );
}

/** True when the candidate raises the number of starters that night. */
function addsStart(roster: EligiblePlayer[], candidate: EligiblePlayer, slots: SlotConfig): boolean {
  const caps = normalizedCaps(slots);
  const without = maximumMatchingSize(roster, caps);
  const withCandidate = maximumMatchingSize([...roster, candidate], caps);
  return withCandidate > without;
}

export function evaluateCandidate(input: EvaluateInput): CandidateMetrics {
  const { slots, roster, rosterGames, candidate, candidateGames, weeks } = input;
  const nights: NightOutcome[] = [];
  const seenDates = new Set<string>();

  for (const game of candidateGames) {
    if (seenDates.has(game.date)) continue;
    seenDates.add(game.date);
    const playing = playingOn(roster, rosterGames, game.date, candidate.id);
    const useful = addsStart(playing, candidate, slots);
    const slot = useful
      ? (assignNight([...playing, candidate], slots).started.get(candidate.id) ?? null)
      : null;
    nights.push({
      date: game.date,
      result: useful ? "useful" : "bench",
      slot,
      rosterPlaying: playing.length,
      openEligibleSlots: useful ? 1 : 0,
      opponent: game.opponent,
      home: game.home,
    });
  }

  const usefulStarts = nights.filter((n) => n.result === "useful").length;
  const forcedBenchNights = nights.length - usefulStarts;
  const totalGames = nights.length;
  const utilization = totalGames === 0 ? 0 : usefulStarts / totalGames;
  const avgOpenEligibleSlots =
    totalGames === 0
      ? 0
      : nights.reduce((sum, n) => sum + n.openEligibleSlots, 0) / totalGames;
  const complementarity = Math.round(utilization * 100);

  const byWeek: WeekMetrics[] = weeks.map((week) => {
    const inWeek = nights.filter((n) => n.date >= week.start && n.date <= week.end);
    let rosterPlayerGames = 0;
    let emptyEligibleNights = 0;
    for (let d = week.start; d <= week.end; d = addDays(d, 1)) {
      const playing = playingOn(roster, rosterGames, d, candidate.id);
      rosterPlayerGames += playing.length;
      if (addsStart(playing, candidate, slots)) emptyEligibleNights += 1;
    }
    return {
      week,
      candidateGames: inWeek.length,
      useful: inWeek.filter((n) => n.result === "useful").length,
      bench: inWeek.filter((n) => n.result === "bench").length,
      rosterPlayerGames,
      emptyEligibleNights,
    };
  });

  return {
    totalGames,
    usefulStarts,
    forcedBenchNights,
    utilization,
    complementarity,
    avgOpenEligibleSlots,
    nights,
    byWeek,
  };
}

export function slotLabel(slot: StartSlot | null): string {
  return slot ?? "BN";
}
