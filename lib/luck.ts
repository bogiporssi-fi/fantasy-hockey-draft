/** Last-season finishing / on-ice luck for draft-night “onni / epäonni”. */

export const LUCK_SEASON = 2024;
export const LUCK_SEASON_LABEL = "2024–25";

export const SKATER_MIN_GAMES = 20;
export const SKATER_MIN_SHOTS = 40;
export const SKATER_MIN_ONICE_SHOTS = 80;
export const FINISH_GOALS_XG = 5;
export const FINISH_SH_PP = 3;
/** Mild PDO: used when finishing is average. */
export const PDO_BAND = 2;
/** Strong PDO: can cancel finishing and yield a mixed/neutral verdict. */
export const PDO_STRONG_BAND = 3;
export const PDO_BASELINE = 100;
export const GOALIE_MIN_GAMES = 15;
export const GOALIE_GA_XG = 12;

export type LuckLabel = "lucky" | "unlucky" | "neutral" | "thin";

export type LuckWhy =
  | "finish_high"
  | "finish_low"
  | "pdo_high"
  | "pdo_low"
  | "both_high"
  | "both_low"
  | "mixed"
  | "near_average"
  | "thin_sample"
  | "goalie_saves_high"
  | "goalie_saves_low"
  | "goalie_near";

export type LuckKind = "skater" | "goalie";

export interface SkaterLuckInput {
  gamesPlayed: number;
  goals: number;
  xGoals: number;
  shotsOnGoal: number;
  onIceGoalsFor: number;
  onIceShotsFor: number;
  onIceGoalsAgainst: number;
  onIceShotsAgainst: number;
}

export interface GoalieLuckInput {
  gamesPlayed: number;
  goalsAgainst: number;
  xGoalsAgainst: number;
  shotsOnGoalAgainst: number;
}

export interface LuckClassification {
  label: LuckLabel;
  why: LuckWhy;
}

export interface LuckReport {
  playerId: number;
  name: string;
  kind: LuckKind;
  gamesPlayed: number;
  label: LuckLabel;
  why: LuckWhy;
  goals: number | null;
  xGoals: number | null;
  goalsMinusXg: number | null;
  shotsOnGoal: number | null;
  shootingPct: number | null;
  expectedShootingPct: number | null;
  pdo: number | null;
  goalsAgainst: number | null;
  xGoalsAgainst: number | null;
  savePct: number | null;
  expectedSavePct: number | null;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function ratePct(numer: number, denom: number): number | null {
  if (!(denom > 0) || !Number.isFinite(numer) || !Number.isFinite(denom)) return null;
  return round1((100 * numer) / denom);
}

/** Individual shooting % vs xG-implied rate on the same shot volume. */
export function shootingPct(goals: number, shotsOnGoal: number): number | null {
  return ratePct(goals, shotsOnGoal);
}

/**
 * 5-on-5 PDO = on-ice SH% + on-ice SV%, scaled to ~100.
 * Needs enough on-ice shots both ways or it is noise.
 */
export function pdo(
  onIceGoalsFor: number,
  onIceShotsFor: number,
  onIceGoalsAgainst: number,
  onIceShotsAgainst: number,
): number | null {
  if (onIceShotsFor < SKATER_MIN_ONICE_SHOTS || onIceShotsAgainst < SKATER_MIN_ONICE_SHOTS) {
    return null;
  }
  const sh = onIceGoalsFor / onIceShotsFor;
  const sv = 1 - onIceGoalsAgainst / onIceShotsAgainst;
  if (!Number.isFinite(sh) || !Number.isFinite(sv)) return null;
  return round1(100 * (sh + sv));
}

export function finishDirection(goalsMinusXg: number, shPct: number | null, xShPct: number | null): -1 | 0 | 1 {
  const shDelta = shPct != null && xShPct != null ? shPct - xShPct : 0;
  if (goalsMinusXg >= FINISH_GOALS_XG || shDelta >= FINISH_SH_PP) return 1;
  if (goalsMinusXg <= -FINISH_GOALS_XG || shDelta <= -FINISH_SH_PP) return -1;
  return 0;
}

export function pdoDirection(value: number | null, band: number = PDO_BAND): -1 | 0 | 1 {
  if (value == null) return 0;
  if (value >= PDO_BASELINE + band) return 1;
  if (value <= PDO_BASELINE - band) return -1;
  return 0;
}

export function classifySkaterLuck(input: SkaterLuckInput): LuckClassification {
  if (input.gamesPlayed < SKATER_MIN_GAMES || input.shotsOnGoal < SKATER_MIN_SHOTS) {
    return { label: "thin", why: "thin_sample" };
  }

  const gx = input.goals - input.xGoals;
  const shPct = shootingPct(input.goals, input.shotsOnGoal);
  const xShPct = shootingPct(input.xGoals, input.shotsOnGoal);
  const finish = finishDirection(gx, shPct, xShPct);
  const pdoValue = pdo(
    input.onIceGoalsFor,
    input.onIceShotsFor,
    input.onIceGoalsAgainst,
    input.onIceShotsAgainst,
  );
  const onIce = pdoDirection(pdoValue);
  const onIceStrong = pdoDirection(pdoValue, PDO_STRONG_BAND);

  if (finish === 1 && onIce === 1) return { label: "lucky", why: "both_high" };
  if (finish === -1 && onIce === -1) return { label: "unlucky", why: "both_low" };
  if (finish !== 0 && onIceStrong !== 0 && finish !== onIceStrong) {
    return { label: "neutral", why: "mixed" };
  }
  if (finish === 1) return { label: "lucky", why: "finish_high" };
  if (finish === -1) return { label: "unlucky", why: "finish_low" };
  if (onIce === 1) return { label: "lucky", why: "pdo_high" };
  if (onIce === -1) return { label: "unlucky", why: "pdo_low" };
  return { label: "neutral", why: "near_average" };
}

export function classifyGoalieLuck(input: GoalieLuckInput): LuckClassification {
  if (input.gamesPlayed < GOALIE_MIN_GAMES) {
    return { label: "thin", why: "thin_sample" };
  }
  const delta = input.goalsAgainst - input.xGoalsAgainst;
  // Fewer goals against than xGA → on-ice/save luck (or elite talent).
  if (delta <= -GOALIE_GA_XG) return { label: "lucky", why: "goalie_saves_high" };
  if (delta >= GOALIE_GA_XG) return { label: "unlucky", why: "goalie_saves_low" };
  return { label: "neutral", why: "goalie_near" };
}

export function skaterReport(
  playerId: number,
  name: string,
  all: SkaterLuckInput,
  fiveOnFive: Pick<
    SkaterLuckInput,
    "onIceGoalsFor" | "onIceShotsFor" | "onIceGoalsAgainst" | "onIceShotsAgainst"
  > | null,
): LuckReport {
  const input: SkaterLuckInput = {
    ...all,
    onIceGoalsFor: fiveOnFive?.onIceGoalsFor ?? 0,
    onIceShotsFor: fiveOnFive?.onIceShotsFor ?? 0,
    onIceGoalsAgainst: fiveOnFive?.onIceGoalsAgainst ?? 0,
    onIceShotsAgainst: fiveOnFive?.onIceShotsAgainst ?? 0,
  };
  const { label, why } = classifySkaterLuck(input);
  const shPct = shootingPct(all.goals, all.shotsOnGoal);
  const xShPct = shootingPct(all.xGoals, all.shotsOnGoal);
  return {
    playerId,
    name,
    kind: "skater",
    gamesPlayed: all.gamesPlayed,
    label,
    why,
    goals: round1(all.goals),
    xGoals: round1(all.xGoals),
    goalsMinusXg: round1(all.goals - all.xGoals),
    shotsOnGoal: round1(all.shotsOnGoal),
    shootingPct: shPct,
    expectedShootingPct: xShPct,
    pdo: pdo(
      input.onIceGoalsFor,
      input.onIceShotsFor,
      input.onIceGoalsAgainst,
      input.onIceShotsAgainst,
    ),
    goalsAgainst: null,
    xGoalsAgainst: null,
    savePct: null,
    expectedSavePct: null,
  };
}

export function goalieReport(playerId: number, name: string, input: GoalieLuckInput): LuckReport {
  const { label, why } = classifyGoalieLuck(input);
  const savePct = ratePct(input.shotsOnGoalAgainst - input.goalsAgainst, input.shotsOnGoalAgainst);
  const xSavePct = ratePct(input.shotsOnGoalAgainst - input.xGoalsAgainst, input.shotsOnGoalAgainst);
  return {
    playerId,
    name,
    kind: "goalie",
    gamesPlayed: input.gamesPlayed,
    label,
    why,
    goals: null,
    xGoals: null,
    goalsMinusXg: round1(input.xGoalsAgainst - input.goalsAgainst),
    shotsOnGoal: round1(input.shotsOnGoalAgainst),
    shootingPct: null,
    expectedShootingPct: null,
    pdo: null,
    goalsAgainst: round1(input.goalsAgainst),
    xGoalsAgainst: round1(input.xGoalsAgainst),
    savePct,
    expectedSavePct: xSavePct,
  };
}

export interface LuckPayload {
  season: number;
  seasonLabel: string;
  fetchedAt: string;
  source: {
    name: "MoneyPuck";
    url: string;
    files: string[];
    note: string;
  };
  players: Record<string, LuckReport>;
}

export function lookupLuck(
  byId: Map<number, LuckReport>,
  byName: Map<string, LuckReport>,
  nhlId: number,
  fullName: string,
  normalize: (s: string) => string,
): LuckReport | null {
  const direct = byId.get(nhlId);
  if (direct) return direct;
  const named = byName.get(normalize(fullName));
  return named ?? null;
}
