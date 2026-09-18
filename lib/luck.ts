/** Last-season finishing / on-ice luck for draft-night “onni / epäonni”. */

export const LUCK_SEASON = 2024;
export const LUCK_SEASON_LABEL = "2024–25";
/** Oldest → newest seasons used for Frozen Tools-style trends. */
export const LUCK_YEARS = [2022, 2023, 2024] as const;

export const SKATER_MIN_GAMES = 20;
export const SKATER_MIN_SHOTS = 40;
export const SKATER_MIN_SHOTS_5V5 = 20;
export const SKATER_MIN_ONICE_SHOTS = 80;
export const IPP_MIN_ONICE_GOALS = 8;
export const PP_IPP_MIN_ONICE_GOALS = 5;
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

export interface SituationStats {
  gamesPlayed: number;
  iceTime: number;
  goals: number;
  xGoals: number;
  shotsOnGoal: number;
  points: number;
  onIceGoalsFor: number;
  onIceShotsFor: number;
  onIceGoalsAgainst: number;
  onIceShotsAgainst: number;
  primaryAssists: number;
  secondaryAssists: number;
  ozStarts: number;
  dzStarts: number;
  xGoalsPct: number;
  corsiPct: number;
}

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

export interface TrendMetric {
  current: number | null;
  /** vs previous season (percentage points). */
  delta: number | null;
  /** vs two seasons ago. */
  delta2: number | null;
  /** Oldest → newest, aligned to LUCK_YEARS. */
  trend: (number | null)[];
}

export const EMPTY_TREND: TrendMetric = { current: null, delta: null, delta2: null, trend: [] };

export const PER60_MIN_ICE = 18000; // 300 minutes
export const OZ_MIN_STARTS = 40;
export const A2_MIN_ASSISTS = 8;
export const PP_SHARE_MIN_ICE = 600; // 10 minutes of PP

export function per60(count: number, iceTimeSeconds: number, minIce: number = PER60_MIN_ICE): number | null {
  if (!(iceTimeSeconds >= minIce) || !Number.isFinite(count)) return null;
  return round1((3600 * count) / iceTimeSeconds);
}

/** OZ Start% = offensive / (offensive + defensive) zone starts. */
export function ozStartPct(ozStarts: number, dzStarts: number, minStarts: number = OZ_MIN_STARTS): number | null {
  if (ozStarts + dzStarts < minStarts) return null;
  return ratePct(ozStarts, ozStarts + dzStarts);
}

/** MoneyPuck stores on-ice xG% / CF% as 0–1. */
export function shareToPct(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < 0) return null;
  if (raw <= 1) return round1(raw * 100);
  return round1(raw);
}

export function secondaryAssistPct(
  primaryAssists: number,
  secondaryAssists: number,
  minAssists: number = A2_MIN_ASSISTS,
): number | null {
  const assists = primaryAssists + secondaryAssists;
  if (assists < minAssists) return null;
  return ratePct(secondaryAssists, assists);
}

/** GP-normalized share of team PP ice time. */
export function ppSharePct(
  playerPpIce: number,
  playerGames: number,
  teamPpIce: number,
  teamGames: number,
): number | null {
  if (!(playerGames > 0) || !(teamGames > 0) || !(teamPpIce > 0) || playerPpIce < PP_SHARE_MIN_ICE) {
    return null;
  }
  const playerPerG = playerPpIce / playerGames;
  const teamPerG = teamPpIce / teamGames;
  if (!(teamPerG > 0)) return null;
  return round1((100 * playerPerG) / teamPerG);
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
  sh5v5: TrendMetric;
  ipp: TrendMetric;
  ipp5v5: TrendMetric;
  ppIpp: TrendMetric;
  ppShare: TrendMetric;
  ptsPer60: TrendMetric;
  sogPer60: TrendMetric;
  ozStart: TrendMetric;
  xgPct5v5: TrendMetric;
  secondaryAssistPct: TrendMetric;
  onIceSh5v5: number | null;
  toi5v5: number | null;
  toiPp: number | null;
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

export function shootingPctMinShots(goals: number, shotsOnGoal: number, minShots: number): number | null {
  if (shotsOnGoal < minShots) return null;
  return shootingPct(goals, shotsOnGoal);
}

/** IPP = player points / on-ice goals for. */
export function ipp(points: number, onIceGoals: number, minGoals: number = IPP_MIN_ONICE_GOALS): number | null {
  if (onIceGoals < minGoals) return null;
  return ratePct(points, onIceGoals);
}

export function toiPerGame(iceTimeSeconds: number, gamesPlayed: number): number | null {
  if (!(gamesPlayed > 0) || !(iceTimeSeconds > 0)) return null;
  return round1(iceTimeSeconds / gamesPlayed / 60);
}

export function metricDelta(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null) return null;
  return round1(current - prior);
}

export function trendMetric(valuesOldestToNewest: (number | null)[]): TrendMetric {
  const n = valuesOldestToNewest.length;
  const current = n ? (valuesOldestToNewest[n - 1] ?? null) : null;
  const prev = n >= 2 ? (valuesOldestToNewest[n - 2] ?? null) : null;
  const prev2 = n >= 3 ? (valuesOldestToNewest[n - 3] ?? null) : null;
  return {
    current,
    delta: metricDelta(current, prev),
    delta2: metricDelta(current, prev2),
    trend: valuesOldestToNewest,
  };
}

export function seasonShortLabel(season: number): string {
  const y = season % 100;
  const next = (season + 1) % 100;
  return `${String(y).padStart(2, "0")}–${String(next).padStart(2, "0")}`;
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
    sh5v5: EMPTY_TREND,
    ipp: EMPTY_TREND,
    ipp5v5: EMPTY_TREND,
    ppIpp: EMPTY_TREND,
    ppShare: EMPTY_TREND,
    ptsPer60: EMPTY_TREND,
    sogPer60: EMPTY_TREND,
    ozStart: EMPTY_TREND,
    xgPct5v5: EMPTY_TREND,
    secondaryAssistPct: EMPTY_TREND,
    onIceSh5v5: null,
    toi5v5: null,
    toiPp: null,
  };
}

export interface YearSlice {
  season: number;
  team?: string;
  all?: SituationStats;
  five?: SituationStats;
  pp?: SituationStats;
}

export interface TeamPpUsage {
  iceTime: number;
  games: number;
}

function sliceIpp(s: SituationStats | undefined, minGoals: number): number | null {
  if (!s) return null;
  return ipp(s.points, s.onIceGoalsFor, minGoals);
}

function sliceSh(s: SituationStats | undefined, minShots: number): number | null {
  if (!s) return null;
  return shootingPctMinShots(s.goals, s.shotsOnGoal, minShots);
}

export function assembleSkaterReport(
  playerId: number,
  name: string,
  years: YearSlice[],
  teamPp?: Map<string, TeamPpUsage>,
): LuckReport {
  const byYear = new Map(years.map((y) => [y.season, y]));
  const latest =
    byYear.get(LUCK_SEASON) ??
    [...years].sort((a, b) => a.season - b.season).at(-1);
  const all = latest?.all;
  const five = latest?.five;
  const pp = latest?.pp;

  const base = skaterReport(
    playerId,
    name,
    all
      ? {
          gamesPlayed: all.gamesPlayed,
          goals: all.goals,
          xGoals: all.xGoals,
          shotsOnGoal: all.shotsOnGoal,
          onIceGoalsFor: five?.onIceGoalsFor ?? all.onIceGoalsFor,
          onIceShotsFor: five?.onIceShotsFor ?? all.onIceShotsFor,
          onIceGoalsAgainst: five?.onIceGoalsAgainst ?? all.onIceGoalsAgainst,
          onIceShotsAgainst: five?.onIceShotsAgainst ?? all.onIceShotsAgainst,
        }
      : {
          gamesPlayed: five?.gamesPlayed ?? 0,
          goals: five?.goals ?? 0,
          xGoals: five?.xGoals ?? 0,
          shotsOnGoal: five?.shotsOnGoal ?? 0,
          onIceGoalsFor: five?.onIceGoalsFor ?? 0,
          onIceShotsFor: five?.onIceShotsFor ?? 0,
          onIceGoalsAgainst: five?.onIceGoalsAgainst ?? 0,
          onIceShotsAgainst: five?.onIceShotsAgainst ?? 0,
        },
    five ?? null,
  );

  const ordered = LUCK_YEARS.map((season) => byYear.get(season));
  const shTrend = ordered.map((y) => sliceSh(y?.five, SKATER_MIN_SHOTS_5V5));
  const ippTrend = ordered.map((y) => sliceIpp(y?.all, IPP_MIN_ONICE_GOALS));
  const ipp5Trend = ordered.map((y) => sliceIpp(y?.five, IPP_MIN_ONICE_GOALS));
  const ppTrend = ordered.map((y) => sliceIpp(y?.pp, PP_IPP_MIN_ONICE_GOALS));
  const ppShareTrend = ordered.map((y) => {
    if (!y?.pp || !y.team || !teamPp) return null;
    const team = teamPp.get(`${y.season}:${y.team}`);
    if (!team) return null;
    return ppSharePct(y.pp.iceTime, y.pp.gamesPlayed, team.iceTime, team.games);
  });
  const pts60Trend = ordered.map((y) => (y?.all ? per60(y.all.points, y.all.iceTime) : null));
  const sog60Trend = ordered.map((y) => (y?.all ? per60(y.all.shotsOnGoal, y.all.iceTime) : null));
  const ozTrend = ordered.map((y) => (y?.five ? ozStartPct(y.five.ozStarts, y.five.dzStarts) : null));
  const xgTrend = ordered.map((y) => {
    if (!y?.five || y.five.iceTime < PER60_MIN_ICE) return null;
    if (y.five.xGoalsPct > 0) return shareToPct(y.five.xGoalsPct);
    if (y.five.corsiPct > 0) return shareToPct(y.five.corsiPct);
    return null;
  });
  const a2Trend = ordered.map((y) =>
    y?.all ? secondaryAssistPct(y.all.primaryAssists, y.all.secondaryAssists) : null,
  );

  return {
    ...base,
    sh5v5: trendMetric([...shTrend]),
    ipp: trendMetric([...ippTrend]),
    ipp5v5: trendMetric([...ipp5Trend]),
    ppIpp: trendMetric([...ppTrend]),
    ppShare: trendMetric([...ppShareTrend]),
    ptsPer60: trendMetric([...pts60Trend]),
    sogPer60: trendMetric([...sog60Trend]),
    ozStart: trendMetric([...ozTrend]),
    xgPct5v5: trendMetric([...xgTrend]),
    secondaryAssistPct: trendMetric([...a2Trend]),
    onIceSh5v5: five ? shootingPctMinShots(five.onIceGoalsFor, five.onIceShotsFor, SKATER_MIN_ONICE_SHOTS) : null,
    toi5v5: five ? toiPerGame(five.iceTime, five.gamesPlayed) : null,
    toiPp: pp ? toiPerGame(pp.iceTime, pp.gamesPlayed) : null,
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
    sh5v5: EMPTY_TREND,
    ipp: EMPTY_TREND,
    ipp5v5: EMPTY_TREND,
    ppIpp: EMPTY_TREND,
    ppShare: EMPTY_TREND,
    ptsPer60: EMPTY_TREND,
    sogPer60: EMPTY_TREND,
    ozStart: EMPTY_TREND,
    xgPct5v5: EMPTY_TREND,
    secondaryAssistPct: EMPTY_TREND,
    onIceSh5v5: null,
    toi5v5: null,
    toiPp: null,
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
