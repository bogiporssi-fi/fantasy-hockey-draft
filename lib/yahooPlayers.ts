import { isListedInjury, parseInjuryStatus, yahooTeamToNhl } from "./injury";
import type { InjuryIndexEntry } from "./rosterPool";
import { FANTASY_POSITIONS, type FantasyPosition } from "./types";
import type { MockPlayer } from "./mockDraft";

export const YAHOO_PUB = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2";
export const EXPECTED_NHL_GAME_KEY = "477";
export const YAHOO_PAGE_SIZE = 25;
export const YAHOO_MIN_POOL = 400;
export const YAHOO_TARGET_POOL = 500;
/** Stay under Next's 2MB fetch-cache limit (count=400 is ~2.3MB). */
export const YAHOO_INJURY_PAGE_SIZE = 200;
export const YAHOO_REVALIDATE_SECONDS = 86400;

export interface YahooPlayersPayload {
  gameKey: string;
  season: string | null;
  fetchedAt: string;
  players: MockPlayer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

/** Yahoo JSON represents objects as a list of single-key maps (plus empty arrays). */
export function mergeYahooMaps(items: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!isRecord(item)) continue;
    Object.assign(out, item);
  }
  return out;
}

export function extractGameKey(json: unknown): { gameKey: string; season: string | null } | null {
  if (!isRecord(json)) return null;
  const content = isRecord(json.fantasy_content) ? json.fantasy_content : json;
  const game = asArray(content.game);
  const meta = game.find((g) => isRecord(g) && ("game_key" in g || "game_id" in g));
  if (!isRecord(meta)) return null;
  const gameKey = String(meta.game_key ?? meta.game_id ?? "").trim();
  if (!gameKey) return null;
  const season = meta.season == null ? null : String(meta.season);
  return { gameKey, season };
}

export function parseEligiblePositions(raw: unknown): FantasyPosition[] {
  const allowed = new Set<string>(FANTASY_POSITIONS);
  const found: FantasyPosition[] = [];
  const seen = new Set<FantasyPosition>();

  function push(token: string) {
    const cleaned = token.trim().toUpperCase();
    for (const part of cleaned.split(/[,/]+/)) {
      const pos = part.trim() as FantasyPosition;
      if (!allowed.has(pos) || seen.has(pos)) continue;
      seen.add(pos);
      found.push(pos);
    }
  }

  for (const item of asArray(raw)) {
    if (typeof item === "string") {
      push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    if (typeof item.position === "string") push(item.position);
  }

  return found;
}

export function parseAveragePick(draftAnalysis: unknown): number | null {
  for (const item of asArray(draftAnalysis)) {
    if (!isRecord(item)) continue;
    if (!("average_pick" in item)) continue;
    const raw = item.average_pick;
    if (raw == null || raw === "" || raw === "-") return null;
    const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }
  return null;
}

/** Yahoo overall rank (`rank_type === "OR"`) from `player_ranks`. */
export function parseOverallRank(playerRanks: unknown): number | null {
  for (const item of asArray(playerRanks)) {
    if (!isRecord(item)) continue;
    const rank = isRecord(item.player_rank) ? item.player_rank : item;
    if (String(rank.rank_type ?? "") !== "OR") continue;
    const raw = rank.rank_value ?? rank.rank;
    if (raw == null || raw === "" || raw === "-") return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }
  return null;
}

function locName(value: unknown): { full: string; first: string; last: string } {
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/);
    return {
      full: value.trim(),
      first: parts[0] ?? "",
      last: parts.slice(1).join(" "),
    };
  }
  if (!isRecord(value)) return { full: "", first: "", last: "" };
  const first = String(value.first ?? value.ascii_first ?? "").trim();
  const last = String(value.last ?? value.ascii_last ?? "").trim();
  const full = String(value.full ?? `${first} ${last}`.trim()).trim();
  return { full, first, last };
}

function parseHeadshot(raw: unknown): string | null {
  if (typeof raw === "string" && raw.startsWith("http")) return raw;
  if (isRecord(raw) && typeof raw.url === "string") return raw.url;
  return null;
}

export function parseYahooPlayerNode(node: unknown): MockPlayer | null {
  if (!isRecord(node)) return null;
  const playerWrap = node.player ?? node;
  const chunks = asArray(playerWrap);
  const fieldItems: unknown[] = [];
  let draftAnalysis: unknown = null;
  let playerRanks: unknown = null;
  for (const chunk of chunks) {
    if (Array.isArray(chunk)) {
      fieldItems.push(...chunk);
      continue;
    }
    if (isRecord(chunk) && ("draft_analysis" in chunk || "player_ranks" in chunk)) {
      if ("draft_analysis" in chunk) draftAnalysis = chunk.draft_analysis;
      if ("player_ranks" in chunk) playerRanks = chunk.player_ranks;
      const rest = { ...chunk };
      delete rest.draft_analysis;
      delete rest.player_ranks;
      if (Object.keys(rest).length) fieldItems.push(rest);
      continue;
    }
    fieldItems.push(chunk);
  }
  const fields = mergeYahooMaps(fieldItems);
  if (draftAnalysis == null && "draft_analysis" in fields) draftAnalysis = fields.draft_analysis;
  if (playerRanks == null && "player_ranks" in fields) playerRanks = fields.player_ranks;
  const id = String(fields.player_id ?? "").trim();
  const name = locName(fields.name);
  if (!id || !name.full) return null;
  const displayPosition = String(fields.display_position ?? "").trim();
  let positions = parseEligiblePositions(fields.eligible_positions);
  if (positions.length === 0 && displayPosition) {
    positions = parseEligiblePositions([{ position: displayPosition }]);
  }
  if (positions.length === 0) return null;
  const team = String(fields.editorial_team_abbr ?? "").trim();
  return {
    id,
    name: name.full,
    firstName: name.first,
    lastName: name.last || name.full,
    team,
    displayPosition: displayPosition || positions.join("/"),
    positions,
    adp: parseAveragePick(draftAnalysis),
    yahooRank: parseOverallRank(playerRanks),
    headshot: parseHeadshot(fields.headshot) ?? parseHeadshot(fields.image_url),
    injury: parseInjuryStatus(fields.status, fields.injury_note),
  };
}

export function parseYahooPlayersPage(json: unknown): MockPlayer[] {
  if (!isRecord(json)) return [];
  const content = isRecord(json.fantasy_content) ? json.fantasy_content : json;
  const game = asArray(content.game);
  const playersNode = game.find((g) => isRecord(g) && "players" in g);
  if (!isRecord(playersNode) || !isRecord(playersNode.players)) return [];
  const bag = playersNode.players;
  const out: MockPlayer[] = [];
  const countRaw = bag.count;
  const count = typeof countRaw === "number" ? countRaw : Number.parseInt(String(countRaw ?? "0"), 10);
  const max = Number.isFinite(count) && count > 0 ? count : 25;
  for (let i = 0; i < max; i++) {
    const row = bag[String(i)] ?? bag[i];
    const player = parseYahooPlayerNode(row);
    if (player) out.push(player);
  }
  return out;
}

async function yahooFetch(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "luistin-mock-draft",
        },
        next: { revalidate: YAHOO_REVALIDATE_SECONDS },
      });
      if (!res.ok) {
        throw new Error(`Yahoo ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function loadYahooPlayers(): Promise<YahooPlayersPayload> {
  const gameJson = await yahooFetch(`${YAHOO_PUB}/game/nhl?format=json`);
  const meta = extractGameKey(gameJson);
  if (!meta) {
    throw new Error("Yahoo NHL game key missing");
  }
  const { gameKey, season } = meta;

  const seen = new Set<string>();
  const players: MockPlayer[] = [];
  for (let start = 0; players.length < YAHOO_TARGET_POOL; start += YAHOO_PAGE_SIZE) {
    const url =
      `${YAHOO_PUB}/game/${encodeURIComponent(gameKey)}` +
      `/players;start=${start};count=${YAHOO_PAGE_SIZE};sort=rank_season;out=draft_analysis,ranks?format=json`;
    const pageJson = await yahooFetch(url);
    const page = parseYahooPlayersPage(pageJson);
    if (page.length === 0) break;
    for (const p of page) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      players.push(p);
    }
    if (page.length < YAHOO_PAGE_SIZE) break;
  }

  if (players.length < YAHOO_MIN_POOL) {
    throw new Error(`Yahoo returned only ${players.length} players`);
  }

  return {
    gameKey,
    season,
    fetchedAt: new Date().toISOString(),
    players,
  };
}

/**
 * Name, NHL team, and listed injury for the whole Yahoo player pool.
 * Used to badge the NHL roster and to add IR/DTD/Out players missing from `/roster/current`.
 * Ranking pages stay separate so the mock draft pool does not grow past its ADP cap.
 */
export async function loadYahooInjuryIndex(): Promise<InjuryIndexEntry[]> {
  const gameJson = await yahooFetch(`${YAHOO_PUB}/game/nhl?format=json`);
  const meta = extractGameKey(gameJson);
  if (!meta) return [];
  const rows: InjuryIndexEntry[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < 8000; start += YAHOO_INJURY_PAGE_SIZE) {
    const url =
      `${YAHOO_PUB}/game/${encodeURIComponent(meta.gameKey)}` +
      `/players;start=${start};count=${YAHOO_INJURY_PAGE_SIZE};sort=rank_season?format=json`;
    const page = parseYahooPlayersPage(await yahooFetch(url));
    if (page.length === 0) break;
    for (const player of page) {
      if (!player.injury || !isListedInjury(player.injury.code)) continue;
      if (seen.has(player.id)) continue;
      seen.add(player.id);
      rows.push({
        name: player.name,
        team: yahooTeamToNhl(player.team),
        injury: player.injury,
      });
    }
    if (page.length < YAHOO_INJURY_PAGE_SIZE) break;
  }
  return rows;
}
