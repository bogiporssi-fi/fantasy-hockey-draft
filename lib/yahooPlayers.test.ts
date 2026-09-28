import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_NHL_GAME_KEY,
  extractGameKey,
  loadYahooInjuryIndex,
  loadYahooPlayers,
  parseAveragePick,
  parseEligiblePositions,
  parseOverallRank,
  parseYahooPlayerNode,
  parseYahooPlayersPage,
  YAHOO_MIN_POOL,
} from "./yahooPlayers";

const samplePage = {
  fantasy_content: {
    game: [
      {
        game_key: "477",
        game_id: "477",
        name: "Hockey",
        code: "nhl",
        season: "2026",
      },
      {
        players: {
          "0": {
            player: [
              [
                { player_key: "477.p.6743" },
                { player_id: "6743" },
                {
                  name: {
                    full: "Connor McDavid",
                    first: "Connor",
                    last: "McDavid",
                  },
                },
                { editorial_team_abbr: "EDM" },
                { display_position: "C" },
                { eligible_positions: [{ position: "C" }] },
              ],
              {
                draft_analysis: [{ average_pick: "1.5" }, { average_round: "1.0" }],
              },
              {
                player_ranks: [
                  { player_rank: { rank_type: "OR", rank_value: "1" } },
                  { player_rank: { rank_type: "S", rank_value: "1", rank_season: "2026" } },
                ],
              },
            ],
          },
          "1": {
            player: [
              [
                { player_id: "543" },
                { name: { full: "Nikita Kucherov", first: "Nikita", last: "Kucherov" } },
                { editorial_team_abbr: "TB" },
                { display_position: "RW" },
                { eligible_positions: [{ position: "RW" }] },
              ],
              { draft_analysis: [{ average_pick: "3.8" }] },
              {
                player_ranks: [{ player_rank: { rank_type: "S", rank_value: "2", rank_season: "2026" } }],
              },
            ],
          },
          "2": {
            player: [
              [
                { player_id: "5440" },
                { name: { full: "Leon Draisaitl", first: "Leon", last: "Draisaitl" } },
                { editorial_team_abbr: "EDM" },
                { display_position: "C,LW" },
                {
                  eligible_positions: [{ position: "C" }, { position: "LW" }],
                },
              ],
              { draft_analysis: [{ average_pick: "5.8" }] },
            ],
          },
          count: 3,
        },
      },
    ],
  },
};

describe("Yahoo player JSON parsing", () => {
  it("reads NHL 2026 game_key 477", () => {
    const meta = extractGameKey({
      fantasy_content: {
        game: [{ game_key: "477", game_id: "477", season: "2026", code: "nhl" }],
      },
    });
    expect(meta).toEqual({ gameKey: EXPECTED_NHL_GAME_KEY, season: "2026" });
  });

  it("extracts name, team, eligible_positions and ADP", () => {
    const players = parseYahooPlayersPage(samplePage);
    expect(players).toHaveLength(3);
    expect(players[0]).toMatchObject({
      id: "6743",
      name: "Connor McDavid",
      team: "EDM",
      positions: ["C"],
      adp: 1.5,
      yahooRank: 1,
    });
    expect(players[1]).toMatchObject({
      name: "Nikita Kucherov",
      positions: ["RW"],
      adp: 3.8,
      yahooRank: null,
    });
    expect(players[2]).toMatchObject({
      name: "Leon Draisaitl",
      positions: ["C", "LW"],
      adp: 5.8,
    });
    expect(players[0].injury).toBeNull();
  });

  it("keeps injured players and reads IR-NR / DTD status", () => {
    const jarvis = parseYahooPlayerNode({
      player: [
        [
          { player_id: "8653" },
          { name: { full: "Seth Jarvis", first: "Seth", last: "Jarvis" } },
          { editorial_team_abbr: "CAR" },
          { display_position: "LW,RW" },
          { eligible_positions: [{ position: "LW" }, { position: "RW" }] },
          { status: "IR-NR" },
          { status_full: "Injured Reserve" },
          { injury_note: "Shoulder" },
        ],
      ],
    });
    const barzal = parseYahooPlayerNode({
      player: [
        [
          { player_id: "6758" },
          { name: { full: "Mathew Barzal", first: "Mathew", last: "Barzal" } },
          { editorial_team_abbr: "NYI" },
          { display_position: "C,RW" },
          { eligible_positions: [{ position: "C" }, { position: "RW" }] },
          { status: "DTD" },
          { injury_note: "Knee" },
        ],
      ],
    });
    expect(jarvis).toMatchObject({
      id: "8653",
      team: "CAR",
      positions: ["LW", "RW"],
      injury: { code: "IR-NR", note: "Shoulder" },
    });
    expect(barzal).toMatchObject({
      id: "6758",
      team: "NYI",
      injury: { code: "DTD", note: "Knee" },
    });
  });

  it("parses eligible positions and missing ADP", () => {
    expect(parseEligiblePositions([{ position: "C" }, { position: "LW" }])).toEqual(["C", "LW"]);
    expect(parseEligiblePositions([{ position: "Util" }])).toEqual([]);
    expect(parseAveragePick([{ average_pick: "-" }])).toBeNull();
    expect(parseAveragePick([{ average_pick: "0" }])).toBeNull();
    expect(parseAveragePick([{ percent_drafted: "1.00" }])).toBeNull();
  });

  it("reads Yahoo overall rank (OR) and ignores other rank_type values", () => {
    expect(
      parseOverallRank([
        { player_rank: { rank_type: "OR", rank_value: "1" } },
        { player_rank: { rank_type: "S", rank_value: "4" } },
      ]),
    ).toBe(1);
    expect(parseOverallRank([{ rank_type: "OR", rank_value: "12" }])).toBe(12);
    expect(parseOverallRank([{ player_rank: { rank_type: "S", rank_value: "1" } }])).toBeNull();
    expect(parseOverallRank([{ player_rank: { rank_type: "OR", rank_value: "-" } }])).toBeNull();
    expect(parseOverallRank([])).toBeNull();
  });
});

describe("loadYahooPlayers pagination", () => {
  it("verifies game key and gathers pages without inventing players", async () => {
    const pagePlayers = Array.from({ length: 25 }, (_, i) => ({
      player: [
        [
          { player_id: String(i) },
          { name: { full: `P${i}`, first: "P", last: String(i) } },
          { editorial_team_abbr: "TOR" },
          { display_position: "C" },
          { eligible_positions: [{ position: "C" }] },
        ],
        { draft_analysis: [{ average_pick: String(i + 1) }] },
      ],
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/game/nhl")) {
          return {
            ok: true,
            json: async () => ({
              fantasy_content: { game: [{ game_key: "477", season: "2026" }] },
            }),
          };
        }
        const href = String(url);
        if (href.includes("/players")) {
          expect(href).toContain("out=draft_analysis,ranks");
        }
        const match = href.match(/start=(\d+)/);
        const start = Number(match?.[1] ?? 0);
        if (start >= YAHOO_MIN_POOL) {
          return {
            ok: true,
            json: async () => ({
              fantasy_content: { game: [{ game_key: "477" }, { players: { count: 0 } }] },
            }),
          };
        }
        const players: Record<string, unknown> = { count: 25 };
        pagePlayers.forEach((row, i) => {
          const id = start + i;
          players[String(i)] = {
            player: [
              [
                { player_id: String(id) },
                { name: { full: `P${id}`, first: "P", last: String(id) } },
                { editorial_team_abbr: "TOR" },
                { display_position: "C" },
                { eligible_positions: [{ position: "C" }] },
              ],
              { draft_analysis: [{ average_pick: String(id + 1) }] },
            ],
          };
        });
        return {
          ok: true,
          json: async () => ({
            fantasy_content: { game: [{ game_key: "477" }, { players }] },
          }),
        };
      }),
    );

    const payload = await loadYahooPlayers();
    expect(payload.gameKey).toBe("477");
    expect(payload.players.length).toBeGreaterThanOrEqual(YAHOO_MIN_POOL);
    expect(payload.players[0].name).toBe("P0");
    expect(new Set(payload.players.map((p) => p.id)).size).toBe(payload.players.length);
    vi.unstubAllGlobals();
  });
});

describe("Yahoo injury index", () => {
  it("keeps listed injuries, drops healthy players, and maps LA to LAK", async () => {
    function row(
      id: string,
      name: string,
      team: string,
      pos: string,
      status: string | null,
      note: string | null,
    ) {
      const fields: Record<string, unknown>[] = [
        { player_id: id },
        {
          name: {
            full: name,
            first: name.split(" ")[0],
            last: name.split(" ").slice(1).join(" "),
          },
        },
        { editorial_team_abbr: team },
        { display_position: pos },
        { eligible_positions: [{ position: pos }] },
      ];
      if (status) fields.push({ status });
      if (note) fields.push({ injury_note: note });
      return { player: [fields] };
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href.includes("/game/nhl")) {
          return {
            ok: true,
            json: async () => ({
              fantasy_content: { game: [{ game_key: "477", season: "2026" }] },
            }),
          };
        }
        const start = Number(href.match(/start=(\d+)/)?.[1] ?? 0);
        if (start > 0) {
          return {
            ok: true,
            json: async () => ({
              fantasy_content: { game: [{ game_key: "477" }, { players: { count: 0 } }] },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            fantasy_content: {
              game: [
                { game_key: "477" },
                {
                  players: {
                    count: 4,
                    "0": row("8653", "Seth Jarvis", "CAR", "RW", "IR-NR", "Shoulder"),
                    "1": row("6758", "Mathew Barzal", "NYI", "C", "DTD", "Knee"),
                    "2": row("6743", "Connor McDavid", "EDM", "C", null, null),
                    "3": row("7001", "Kevin Fiala", "LA", "LW", "IR", "Lower Leg"),
                  },
                },
              ],
            },
          }),
        };
      }),
    );

    const rows = await loadYahooInjuryIndex();
    expect(rows).toEqual([
      { name: "Seth Jarvis", team: "CAR", injury: { code: "IR-NR", note: "Shoulder" } },
      { name: "Mathew Barzal", team: "NYI", injury: { code: "DTD", note: "Knee" } },
      { name: "Kevin Fiala", team: "LAK", injury: { code: "IR", note: "Lower Leg" } },
    ]);
    vi.unstubAllGlobals();
  });
});
