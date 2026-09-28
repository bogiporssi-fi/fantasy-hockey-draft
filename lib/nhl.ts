import { buildPlayerPool, type RosterSourcePlayer } from "./rosterPool";
import { loadYahooInjuryIndex } from "./yahooPlayers";
import type { NhlGame, NhlPayload } from "./types";

const NHL = "https://api-web.nhle.com";
const FALLBACK_TEAMS = [
  "ANA",
  "BOS",
  "BUF",
  "CAR",
  "CBJ",
  "CGY",
  "CHI",
  "COL",
  "DAL",
  "DET",
  "EDM",
  "FLA",
  "LAK",
  "MIN",
  "MTL",
  "NJD",
  "NSH",
  "NYI",
  "NYR",
  "OTT",
  "PHI",
  "PIT",
  "SEA",
  "SJS",
  "STL",
  "TBL",
  "TOR",
  "UTA",
  "VAN",
  "VGK",
  "WPG",
  "WSH",
];

type Localized = string | { default?: string; fi?: string } | undefined;

function loc(value: Localized): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.default ?? value.fi ?? "";
}

async function nhlJson<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${NHL}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "luistin-draft-helper" },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`NHL ${path} → ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

interface StandingsResponse {
  standings?: {
    teamAbbrev?: Localized;
    teamName?: Localized;
  }[];
}

interface ScheduleResponse {
  currentSeason?: number;
  games?: {
    gameType?: number;
    gameDate?: string;
    awayTeam?: { abbrev?: string };
    homeTeam?: { abbrev?: string };
  }[];
}

interface RosterPlayerRaw {
  id: number;
  headshot?: string;
  firstName?: Localized;
  lastName?: Localized;
  positionCode?: string;
  sweaterNumber?: number;
}

interface RosterResponse {
  forwards?: RosterPlayerRaw[];
  defensemen?: RosterPlayerRaw[];
  goalies?: RosterPlayerRaw[];
}

interface ScheduleNowResponse {
  regularSeasonStartDate?: string;
  regularSeasonEndDate?: string;
}

function seasonLabel(season: number): string {
  const s = String(season);
  if (s.length !== 8) return s;
  return `${s.slice(0, 4)}–${s.slice(6)}`;
}

/** NHL season id (20262027) for a calendar date. Rolls over in August, matching the previous fallback. */
export function seasonIdForDate(date = new Date()): number {
  const y = date.getFullYear();
  const month = date.getMonth();
  const start = month >= 7 ? y : y - 1;
  return start * 10000 + (start + 1);
}

export function previousSeasonId(season: number): number {
  const start = Math.floor(season / 10000) - 1;
  return start * 10000 + (start + 1);
}

function rosterSources(roster: RosterResponse | null, team: { abbrev: string; name: string }): RosterSourcePlayer[] {
  if (!roster) return [];
  const groups: RosterPlayerRaw[] = [
    ...(roster.forwards ?? []),
    ...(roster.defensemen ?? []),
    ...(roster.goalies ?? []),
  ];
  const out: RosterSourcePlayer[] = [];
  for (const p of groups) {
    if (!p.id) continue;
    const firstName = loc(p.firstName);
    const lastName = loc(p.lastName);
    if (!firstName && !lastName) continue;
    out.push({
      id: p.id,
      firstName,
      lastName,
      positionCode: p.positionCode ?? "C",
      headshot: p.headshot ?? null,
      sweaterNumber: p.sweaterNumber ?? null,
      team: team.abbrev,
      teamName: team.name,
    });
  }
  return out;
}

export async function loadNhlData(): Promise<NhlPayload> {
  let teams: { abbrev: string; name: string }[] = FALLBACK_TEAMS.map((abbrev) => ({
    abbrev,
    name: abbrev,
  }));

  try {
    const standings = await nhlJson<StandingsResponse>("/v1/standings/now");
    const fromStandings =
      standings.standings
        ?.map((row) => ({
          abbrev: loc(row.teamAbbrev),
          name: loc(row.teamName),
        }))
        .filter((t) => t.abbrev.length === 3) ?? [];
    if (fromStandings.length >= 30) {
      teams = fromStandings.sort((a, b) => a.abbrev.localeCompare(b.abbrev));
    }
  } catch {
    // keep fallback list
  }

  let regularSeasonStart = "";
  let regularSeasonEnd = "";
  try {
    const now = await nhlJson<ScheduleNowResponse>("/v1/schedule/now");
    regularSeasonStart = now.regularSeasonStartDate ?? "";
    regularSeasonEnd = now.regularSeasonEndDate ?? "";
  } catch {
    // filled from team schedules below
  }

  const missingTeams: string[] = [];
  let season = 0;
  const teamGames: Record<string, NhlGame[]> = {};
  const currentPlayers: RosterSourcePlayer[] = [];
  const previousPlayers: RosterSourcePlayer[] = [];
  const previousSeason = previousSeasonId(seasonIdForDate());

  const [results, injuries] = await Promise.all([
    mapPool(teams, 3, async (team) => {
      const abbrev = team.abbrev;
      try {
        const [schedule, roster, previousRoster] = await Promise.all([
          nhlJson<ScheduleResponse>(`/v1/club-schedule-season/${abbrev}/now`),
          nhlJson<RosterResponse>(`/v1/roster/${abbrev}/current`),
          // Active roster omits IR / LTIR. Last season's roster still lists them.
          nhlJson<RosterResponse>(`/v1/roster/${abbrev}/${previousSeason}`).catch(() => null),
        ]);
        return { abbrev, name: team.name, schedule, roster, previousRoster };
      } catch {
        return { abbrev, name: team.name, schedule: null, roster: null, previousRoster: null };
      }
    }),
    loadYahooInjuryIndex().catch(() => []),
  ]);

  for (const row of results) {
    if (!row.schedule || !row.roster) {
      missingTeams.push(row.abbrev);
      continue;
    }
    if (row.schedule.currentSeason) season = row.schedule.currentSeason;
    const games: NhlGame[] = [];
    for (const g of row.schedule.games ?? []) {
      if (g.gameType !== 2 || !g.gameDate) continue;
      const home = g.homeTeam?.abbrev === row.abbrev;
      const opponent = home ? (g.awayTeam?.abbrev ?? "") : (g.homeTeam?.abbrev ?? "");
      games.push({ date: g.gameDate, opponent, home });
    }
    games.sort((a, b) => a.date.localeCompare(b.date));
    teamGames[row.abbrev] = games;
    if (!regularSeasonStart && games[0]) regularSeasonStart = games[0].date;
    if (games.length) {
      const last = games[games.length - 1].date;
      if (!regularSeasonEnd || last > regularSeasonEnd) regularSeasonEnd = last;
    }

    currentPlayers.push(...rosterSources(row.roster, { abbrev: row.abbrev, name: row.name }));
    previousPlayers.push(...rosterSources(row.previousRoster, { abbrev: row.abbrev, name: row.name }));
  }

  const players = buildPlayerPool({
    current: currentPlayers,
    previous: previousPlayers,
    injuries,
    teamNames: new Map(teams.map((team) => [team.abbrev, team.name])),
  });

  if (!season) season = seasonIdForDate();

  return {
    season,
    seasonLabel: seasonLabel(season),
    regularSeasonStart,
    regularSeasonEnd,
    fetchedAt: new Date().toISOString(),
    teams,
    players,
    teamGames,
    missingTeams,
  };
}

export function gamesForTeam(data: NhlPayload, team: string): NhlGame[] {
  return data.teamGames[team] ?? [];
}
