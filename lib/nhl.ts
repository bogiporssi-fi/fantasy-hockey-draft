import { nhlToFantasyPosition } from "./names";
import type { FantasyPosition, NhlGame, NhlPayload, NhlPlayer } from "./types";

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
  const res = await fetch(`${NHL}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 6 * 60 * 60 },
  });
  if (!res.ok) {
    throw new Error(`NHL ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
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
  const players: NhlPlayer[] = [];
  const seenPlayers = new Set<number>();

  const results = await mapPool(teams, 6, async (team) => {
    const abbrev = team.abbrev;
    try {
      const [schedule, roster] = await Promise.all([
        nhlJson<ScheduleResponse>(`/v1/club-schedule-season/${abbrev}/now`),
        nhlJson<RosterResponse>(`/v1/roster/${abbrev}/current`),
      ]);
      return { abbrev, name: team.name, schedule, roster };
    } catch {
      return { abbrev, name: team.name, schedule: null, roster: null };
    }
  });

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

    const groups: RosterPlayerRaw[] = [
      ...(row.roster.forwards ?? []),
      ...(row.roster.defensemen ?? []),
      ...(row.roster.goalies ?? []),
    ];
    for (const p of groups) {
      if (!p.id || seenPlayers.has(p.id)) continue;
      seenPlayers.add(p.id);
      const firstName = loc(p.firstName);
      const lastName = loc(p.lastName);
      const position: FantasyPosition = nhlToFantasyPosition(p.positionCode ?? "C");
      players.push({
        id: p.id,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        team: row.abbrev,
        teamName: row.name,
        position,
        headshot: p.headshot ?? null,
        sweaterNumber: p.sweaterNumber ?? null,
      });
    }
  }

  players.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

  if (!season) {
    const y = new Date().getFullYear();
    const month = new Date().getMonth();
    season = month >= 7 ? y * 10000 + (y + 1) : (y - 1) * 10000 + y;
  }

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
