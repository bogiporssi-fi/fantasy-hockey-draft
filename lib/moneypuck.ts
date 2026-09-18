import { normalizeName } from "./names";
import {
  assembleSkaterReport,
  goalieReport,
  LUCK_SEASON,
  LUCK_SEASON_LABEL,
  LUCK_YEARS,
  type LuckPayload,
  type LuckReport,
  type SituationStats,
  type TeamPpUsage,
  type YearSlice,
} from "./luck";

export const MONEYPCK_DATA_PAGE = "https://moneypuck.com/data.htm";
export const MONEYPCK_SKATERS_CSV =
  "https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/skaters.csv";
export const MONEYPCK_GOALIES_CSV =
  "https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/goalies.csv";

export function skatersCsvUrl(season: number): string {
  return `https://moneypuck.com/moneypuck/playerData/seasonSummary/${season}/regular/skaters.csv`;
}

export function teamsCsvUrl(season: number): string {
  return `https://moneypuck.com/moneypuck/playerData/seasonSummary/${season}/regular/teams.csv`;
}

type NamedYear = YearSlice & { playerId: number; name: string };

function num(row: Record<string, string>, key: string): number {
  const v = Number.parseFloat(row[key] ?? "");
  return Number.isFinite(v) ? v : 0;
}

/** Minimal CSV parser: MoneyPuck files are comma-separated without nested quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < headers.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function situationFromRow(row: Record<string, string>): SituationStats {
  return {
    gamesPlayed: num(row, "games_played"),
    iceTime: num(row, "icetime"),
    goals: num(row, "I_F_goals"),
    xGoals: num(row, "I_F_xGoals"),
    shotsOnGoal: num(row, "I_F_shotsOnGoal"),
    points: num(row, "I_F_points"),
    onIceGoalsFor: num(row, "OnIce_F_goals"),
    onIceShotsFor: num(row, "OnIce_F_shotsOnGoal"),
    onIceGoalsAgainst: num(row, "OnIce_A_goals"),
    onIceShotsAgainst: num(row, "OnIce_A_shotsOnGoal"),
    primaryAssists: num(row, "I_F_primaryAssists"),
    secondaryAssists: num(row, "I_F_secondaryAssists"),
    ozStarts: num(row, "I_F_oZoneShiftStarts"),
    dzStarts: num(row, "I_F_dZoneShiftStarts"),
    xGoalsPct: num(row, "onIce_xGoalsPercentage"),
    corsiPct: num(row, "onIce_corsiPercentage"),
  };
}

export function parseSkaterSeasonCsv(text: string): NamedYear[] {
  const grouped = new Map<string, NamedYear>();
  for (const row of parseCsv(text)) {
    const playerId = Number.parseInt(row.playerId ?? "", 10);
    if (!Number.isFinite(playerId) || playerId <= 0) continue;
    const season = Number.parseInt(row.season ?? "", 10);
    const sit = row.situation ?? "";
    const yr = Number.isFinite(season) ? season : LUCK_SEASON;
    const key = `${playerId}:${yr}`;
    const cur =
      grouped.get(key) ??
      ({
        playerId,
        name: row.name ?? "",
        season: yr,
      } satisfies NamedYear);
    if (row.name) cur.name = row.name;
    const team = (row.team ?? "").trim();
    if (team.length === 3) cur.team = team;
    const stats = situationFromRow(row);
    if (sit === "all") cur.all = stats;
    else if (sit === "5on5") cur.five = stats;
    else if (sit === "5on4") cur.pp = stats;
    grouped.set(key, cur);
  }
  return [...grouped.values()];
}

/** Single-season reports (tests). Production uses mergeSkaterYears. */
export function reportsFromSkaterCsv(text: string): LuckReport[] {
  return parseSkaterSeasonCsv(text)
    .filter((y) => y.all)
    .map((y) => assembleSkaterReport(y.playerId, y.name, [y]));
}

export function parseTeamPpCsv(text: string): Map<string, TeamPpUsage> {
  const out = new Map<string, TeamPpUsage>();
  for (const row of parseCsv(text)) {
    if ((row.situation ?? "") !== "5on4") continue;
    const team = (row.team ?? row.name ?? "").trim();
    const season = Number.parseInt(row.season ?? "", 10);
    if (team.length !== 3 || !Number.isFinite(season)) continue;
    const iceTime = num(row, "iceTime") || num(row, "icetime");
    const games = num(row, "games_played");
    if (!(iceTime > 0) || !(games > 0)) continue;
    out.set(`${season}:${team}`, { iceTime, games });
  }
  return out;
}

export function mergeTeamPp(maps: Map<string, TeamPpUsage>[]): Map<string, TeamPpUsage> {
  const out = new Map<string, TeamPpUsage>();
  for (const m of maps) {
    for (const [k, v] of m) out.set(k, v);
  }
  return out;
}

export function mergeSkaterYears(
  seasons: NamedYear[][],
  teamPp?: Map<string, TeamPpUsage>,
): LuckReport[] {
  const byId = new Map<number, { name: string; years: YearSlice[] }>();
  for (const list of seasons) {
    for (const y of list) {
      const cur = byId.get(y.playerId) ?? { name: y.name, years: [] };
      if (y.name) cur.name = y.name;
      cur.years.push(y);
      byId.set(y.playerId, cur);
    }
  }
  const reports: LuckReport[] = [];
  for (const [id, g] of byId) {
    if (!g.years.some((y) => y.all || y.five)) continue;
    reports.push(assembleSkaterReport(id, g.name, g.years, teamPp));
  }
  return reports;
}

export function reportsFromGoalieCsv(text: string): LuckReport[] {
  const reports: LuckReport[] = [];
  for (const row of parseCsv(text)) {
    if ((row.situation ?? "") !== "all") continue;
    const playerId = Number.parseInt(row.playerId ?? "", 10);
    if (!Number.isFinite(playerId) || playerId <= 0) continue;
    reports.push(
      goalieReport(playerId, row.name ?? "", {
        gamesPlayed: num(row, "games_played"),
        goalsAgainst: num(row, "goals"),
        xGoalsAgainst: num(row, "xGoals"),
        shotsOnGoalAgainst: num(row, "ongoal"),
      }),
    );
  }
  return reports;
}

export function indexLuckReports(reports: LuckReport[]): {
  byId: Map<number, LuckReport>;
  byName: Map<string, LuckReport>;
} {
  const byId = new Map<number, LuckReport>();
  const names = new Map<string, LuckReport[]>();
  for (const r of reports) {
    byId.set(r.playerId, r);
    const key = normalizeName(r.name);
    if (!key) continue;
    names.set(key, [...(names.get(key) ?? []), r]);
  }
  const byName = new Map<string, LuckReport>();
  for (const [key, list] of names) {
    if (list.length === 1) byName.set(key, list[0]);
  }
  return { byId, byName };
}

async function fetchCsv(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": "luistin-draft-helper" },
        // CSV is ~4.5MB; Next.js data cache rejects items over 2MB. Route ISR caches the compact JSON.
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`MoneyPuck ${url} → ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function loadLuckPayload(): Promise<LuckPayload> {
  const skaterUrls = LUCK_YEARS.map((y) => skatersCsvUrl(y));
  const teamUrls = LUCK_YEARS.map((y) => teamsCsvUrl(y));
  const settled = await Promise.allSettled([
    fetchCsv(MONEYPCK_GOALIES_CSV),
    ...skaterUrls.map((url) => fetchCsv(url)),
    ...teamUrls.map((url) => fetchCsv(url)),
  ]);
  const goalieCsv = settled[0].status === "fulfilled" ? settled[0].value : "";
  const skaterCsvs = settled.slice(1, 1 + skaterUrls.length).map((s) => (s.status === "fulfilled" ? s.value : ""));
  const teamCsvs = settled.slice(1 + skaterUrls.length).map((s) => (s.status === "fulfilled" ? s.value : ""));
  const parsedYears = skaterCsvs.filter(Boolean).map((text) => parseSkaterSeasonCsv(text));
  const teamPp = mergeTeamPp(teamCsvs.filter(Boolean).map((text) => parseTeamPpCsv(text)));
  const files = [...skaterUrls, ...teamUrls, MONEYPCK_GOALIES_CSV];
  const reports = [
    ...mergeSkaterYears(parsedYears, teamPp),
    ...(goalieCsv ? reportsFromGoalieCsv(goalieCsv) : []),
  ];
  const players: Record<string, LuckReport> = {};
  for (const r of reports) {
    // Skater rows win if a player appears in both (should not happen).
    if (players[String(r.playerId)] && r.kind === "goalie") continue;
    players[String(r.playerId)] = r;
  }
  if (Object.keys(players).length === 0) {
    throw new Error("MoneyPuck returned no luck stats");
  }
  return {
    season: LUCK_SEASON,
    seasonLabel: LUCK_SEASON_LABEL,
    fetchedAt: new Date().toISOString(),
    source: {
      name: "MoneyPuck",
      url: MONEYPCK_DATA_PAGE,
      files,
      note: "Free for non-commercial use; credit MoneyPuck.com. Frozen Tools-style rates computed from these CSVs — not Dobber data.",
    },
    players,
  };
}
