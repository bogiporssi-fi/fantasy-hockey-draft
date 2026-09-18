import { normalizeName } from "./names";
import {
  goalieReport,
  LUCK_SEASON,
  LUCK_SEASON_LABEL,
  skaterReport,
  type LuckPayload,
  type LuckReport,
  type SkaterLuckInput,
} from "./luck";

export const MONEYPCK_DATA_PAGE = "https://moneypuck.com/data.htm";
export const MONEYPCK_SKATERS_CSV =
  "https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/skaters.csv";
export const MONEYPCK_GOALIES_CSV =
  "https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/goalies.csv";

interface SkaterRow {
  playerId: number;
  name: string;
  situation: string;
  input: SkaterLuckInput;
}

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

function skaterFromRow(row: Record<string, string>): SkaterRow | null {
  const playerId = Number.parseInt(row.playerId ?? "", 10);
  if (!Number.isFinite(playerId) || playerId <= 0) return null;
  return {
    playerId,
    name: row.name ?? "",
    situation: row.situation ?? "",
    input: {
      gamesPlayed: num(row, "games_played"),
      goals: num(row, "I_F_goals"),
      xGoals: num(row, "I_F_xGoals"),
      shotsOnGoal: num(row, "I_F_shotsOnGoal"),
      onIceGoalsFor: num(row, "OnIce_F_goals"),
      onIceShotsFor: num(row, "OnIce_F_shotsOnGoal"),
      onIceGoalsAgainst: num(row, "OnIce_A_goals"),
      onIceShotsAgainst: num(row, "OnIce_A_shotsOnGoal"),
    },
  };
}

export function reportsFromSkaterCsv(text: string): LuckReport[] {
  const grouped = new Map<number, { name: string; all?: SkaterLuckInput; five?: SkaterLuckInput }>();
  for (const row of parseCsv(text)) {
    const parsed = skaterFromRow(row);
    if (!parsed) continue;
    const cur = grouped.get(parsed.playerId) ?? { name: parsed.name };
    cur.name = parsed.name || cur.name;
    if (parsed.situation === "all") cur.all = parsed.input;
    if (parsed.situation === "5on5") cur.five = parsed.input;
    grouped.set(parsed.playerId, cur);
  }
  const reports: LuckReport[] = [];
  for (const [id, g] of grouped) {
    if (!g.all) continue;
    reports.push(
      skaterReport(id, g.name, g.all, g.five
        ? {
            onIceGoalsFor: g.five.onIceGoalsFor,
            onIceShotsFor: g.five.onIceShotsFor,
            onIceGoalsAgainst: g.five.onIceGoalsAgainst,
            onIceShotsAgainst: g.five.onIceShotsAgainst,
          }
        : null),
    );
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
  const [skaterCsv, goalieCsv] = await Promise.all([
    fetchCsv(MONEYPCK_SKATERS_CSV),
    fetchCsv(MONEYPCK_GOALIES_CSV),
  ]);
  const reports = [...reportsFromSkaterCsv(skaterCsv), ...reportsFromGoalieCsv(goalieCsv)];
  const players: Record<string, LuckReport> = {};
  for (const r of reports) {
    players[String(r.playerId)] = r;
  }
  return {
    season: LUCK_SEASON,
    seasonLabel: LUCK_SEASON_LABEL,
    fetchedAt: new Date().toISOString(),
    source: {
      name: "MoneyPuck",
      url: MONEYPCK_DATA_PAGE,
      files: [MONEYPCK_SKATERS_CSV, MONEYPCK_GOALIES_CSV],
      note: "Free for non-commercial use; credit MoneyPuck.com. NHL playerId mapping.",
    },
    players,
  };
}
