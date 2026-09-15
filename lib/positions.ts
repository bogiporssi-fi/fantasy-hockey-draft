import { FANTASY_POSITIONS, type FantasyPosition } from "./types";

export function orderedPositions(positions: FantasyPosition[]): FantasyPosition[] {
  const set = new Set(positions);
  return FANTASY_POSITIONS.filter((p) => set.has(p));
}

/** Toggle Yahoo eligibility. At least one position always remains. */
export function toggleFantasyPosition(
  current: FantasyPosition[],
  pos: FantasyPosition,
): FantasyPosition[] {
  const has = current.includes(pos);
  const next = has ? current.filter((p) => p !== pos) : [...current, pos];
  if (next.length === 0) return [pos];
  return orderedPositions(next);
}

export function formatEligibility(positions: FantasyPosition[]): string {
  return orderedPositions(positions).join("/");
}
