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
 * Place a player only into an active slot they marked (C/LW/RW/D/G).
 * UTIL is not a Yahoo mark — it is used only when the league profile still
 * has remaining UTIL capacity.
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

/**
 * Greedy nightly assignment from each player's Yahoo marks only.
 * Narrower eligibility first, then the tightest remaining marked slot.
 */
export function assignNight(players: EligiblePlayer[], slots: SlotConfig): NightFill {
  const remaining = emptyRemaining(slots);
  const started = new Map<string, StartSlot>();
  const benched: string[] = [];

  const sorted = [...players].sort((a, b) => {
    const diff = yahooMarks(a.positions).length - yahooMarks(b.positions).length;
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  for (const player of sorted) {
    const slot = pickSlot(player.positions, remaining);
    if (slot) {
      remaining[slot] -= 1;
      started.set(player.id, slot);
    } else {
      benched.push(player.id);
    }
  }

  return { started, benched, remaining };
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

export function evaluateCandidate(input: EvaluateInput): CandidateMetrics {
  const { slots, roster, rosterGames, candidate, candidateGames, weeks } = input;
  const nights: NightOutcome[] = [];

  for (const game of candidateGames) {
    const playing = roster.filter((p) => rosterGames.get(p.id)?.has(game.date));
    const fill = assignNight(playing, slots);
    const slot = pickSlot(candidate.positions, fill.remaining);
    const open = openEligibleSlots(fill.remaining, candidate.positions);
    nights.push({
      date: game.date,
      result: slot ? "useful" : "bench",
      slot,
      rosterPlaying: playing.length,
      openEligibleSlots: open,
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
      const playing = roster.filter((p) => rosterGames.get(p.id)?.has(d));
      rosterPlayerGames += playing.length;
      const fill = assignNight(playing, slots);
      if (openEligibleSlots(fill.remaining, candidate.positions) > 0) {
        emptyEligibleNights += 1;
      }
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
