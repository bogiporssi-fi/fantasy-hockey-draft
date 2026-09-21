import { describe, expect, it } from "vitest";
import type { FantasyPosition } from "./types";
import {
  applyPick,
  assignSlot,
  boardCellLabel,
  buildSnakeOrder,
  chooseBotPick,
  compareAdp,
  compareYahooRank,
  createEmptyRosters,
  formatDraftedLabel,
  formatLastPickTicker,
  formatPosTeam,
  formatShortName,
  lastNPicks,
  matchesPosFilter,
  MOCK_ROUNDS,
  MOCK_SLOT_LIMITS,
  MOCK_TEAM_COUNT,
  MOCK_TOTAL_PICKS,
  needAwareCandidates,
  pickIndexForTeamRound,
  picksUntilTurn,
  remainingSlots,
  rosterRespectsLimits,
  rosterByTeamViews,
  roundOfPick,
  simulateMockDraft,
  snakeDraftSlot,
  snakeTeamIndex,
  sortByAdp,
  sortPlayers,
  starterSlotFor,
  stripSlotsFromRoster,
  weightedIndex,
  type MockDraftPickRecord,
  type MockPlayer,
  type MockSlotCounts,
} from "./mockDraft";

function player(
  id: string,
  name: string,
  positions: FantasyPosition[],
  adp: number | null,
  yahooRank: number | null = adp,
): MockPlayer {
  const [first, ...rest] = name.split(" ");
  return {
    id,
    name,
    firstName: first ?? name,
    lastName: rest.join(" ") || name,
    team: "EDM",
    displayPosition: positions.join(","),
    positions,
    adp,
    yahooRank,
  };
}

function filled(partial: Partial<MockSlotCounts>): MockSlotCounts {
  return { C: 0, LW: 0, RW: 0, D: 0, G: 0, BN: 0, ...partial };
}

describe("snake draft order", () => {
  it("goes 1→20 on odd rounds and 20→1 on even rounds", () => {
    expect(snakeTeamIndex(0)).toBe(0);
    expect(snakeDraftSlot(0)).toBe(1);
    expect(snakeDraftSlot(19)).toBe(20);
    expect(snakeDraftSlot(20)).toBe(20);
    expect(snakeDraftSlot(21)).toBe(19);
    expect(snakeDraftSlot(39)).toBe(1);
    expect(snakeDraftSlot(40)).toBe(1);
    expect(roundOfPick(0)).toBe(1);
    expect(roundOfPick(19)).toBe(1);
    expect(roundOfPick(20)).toBe(2);
    expect(roundOfPick(39)).toBe(2);
    expect(roundOfPick(40)).toBe(3);
  });

  it("gives each of 20 teams 16 picks (320 total)", () => {
    const order = buildSnakeOrder(MOCK_TEAM_COUNT, MOCK_ROUNDS);
    expect(order).toHaveLength(MOCK_TOTAL_PICKS);
    const counts = Array.from({ length: MOCK_TEAM_COUNT }, () => 0);
    order.forEach((team, i) => {
      expect(team).toBe(snakeTeamIndex(i));
      counts[team] += 1;
    });
    expect(counts.every((n) => n === MOCK_ROUNDS)).toBe(true);
    expect(order.slice(0, 20)).toEqual([...Array(20).keys()]);
    expect(order.slice(20, 40)).toEqual([...Array(20).keys()].reverse());
    expect(pickIndexForTeamRound(0, 0)).toBe(0);
    expect(pickIndexForTeamRound(19, 0)).toBe(19);
    expect(pickIndexForTeamRound(19, 1)).toBe(20);
    expect(pickIndexForTeamRound(0, 1)).toBe(39);
  });
});

describe("slot filling", () => {
  it("fills matching starters before bench", () => {
    const rem = remainingSlots(filled({}));
    expect(assignSlot(["C"], rem)).toBe("C");
    expect(assignSlot(["LW", "RW"], rem)).toBe("LW");
    expect(assignSlot(["G"], rem)).toBe("G");
  });

  it("puts dual C+LW into the tighter remaining starter", () => {
    expect(starterSlotFor(["C", "LW"], remainingSlots(filled({ C: 1 })))).toBe("C");
    expect(starterSlotFor(["C", "LW"], remainingSlots(filled({ LW: 1 })))).toBe("LW");
    expect(assignSlot(["C", "LW"], remainingSlots(filled({ C: 2, LW: 2 })))).toBe("BN");
  });

  it("benches skaters when their starters are full", () => {
    const rem = remainingSlots(filled({ C: 2, LW: 2, RW: 2, D: 4 }));
    expect(assignSlot(["C"], rem)).toBe("BN");
    expect(assignSlot(["D"], rem)).toBe("BN");
    expect(assignSlot(["RW", "LW"], rem)).toBe("BN");
  });

  it("never benches a goalie — G only into G slots", () => {
    const rem = remainingSlots(filled({ G: 2 }));
    expect(assignSlot(["G"], rem)).toBeNull();
    expect(assignSlot(["G"], remainingSlots(filled({ G: 1 })))).toBe("G");
  });

  it("applyPick updates counts and rejects illegal goalie overflow", () => {
    let roster = createEmptyRosters(1)[0];
    const g1 = player("g1", "Andrei Vasilevskiy", ["G"], 11);
    const g2 = player("g2", "Connor Hellebuyck", ["G"], 25);
    const g3 = player("g3", "Igor Shesterkin", ["G"], 30);
    roster = applyPick(roster, g1, 0)!;
    roster = applyPick(roster, g2, 1)!;
    expect(roster.filled.G).toBe(2);
    expect(applyPick(roster, g3, 2)).toBeNull();
    expect(rosterRespectsLimits(roster)).toBe(true);
  });
});

describe("bot pick", () => {
  const pool = [
    player("1", "Connor McDavid", ["C"], 1.5),
    player("2", "Nikita Kucherov", ["RW"], 3.8),
    player("3", "Leon Draisaitl", ["C", "LW"], 5.8),
    player("4", "Cale Makar", ["D"], 6.4),
    player("5", "Andrei Vasilevskiy", ["G"], 11.1),
    player("6", "No Adp Skater", ["C"], null),
  ];

  it("sorts missing ADP to the end", () => {
    const sorted = sortByAdp(pool);
    expect(sorted.map((p) => p.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(compareAdp(pool[5], pool[0])).toBeGreaterThan(0);
  });

  it("takes the lowest-ADP player who fills an open starter when rng picks first", () => {
    const rem = remainingSlots(filled({}));
    const pick = chooseBotPick(pool, rem, () => 0);
    expect(pick?.id).toBe("1");
  });

  it("skips filled positions and still prefers starter needs over bench", () => {
    const rem = remainingSlots(filled({ C: 2, LW: 2 }));
    const candidates = needAwareCandidates(pool, rem);
    expect(candidates.map((p) => p.id)).toEqual(["2", "4", "5"]);
    const pick = chooseBotPick(pool, rem, () => 0);
    expect(pick?.id).toBe("2");
  });

  it("uses BN only after starters that this pool can fill are gone", () => {
    const rem = remainingSlots(filled({ C: 2, LW: 2, RW: 2, D: 4, G: 2 }));
    const candidates = needAwareCandidates(pool, rem);
    expect(candidates.every((p) => p.positions.includes("G") === false)).toBe(true);
    expect(chooseBotPick(pool, rem, () => 0)?.id).toBe("1");
  });

  it("rolls among the top 3 need-aware names", () => {
    const rem = remainingSlots(filled({}));
    expect(chooseBotPick(pool, rem, () => 0)?.name).toBe("Connor McDavid");
    expect(chooseBotPick(pool, rem, () => 0.5)?.name).toBe("Nikita Kucherov");
    expect(chooseBotPick(pool, rem, () => 0.99)?.name).toBe("Leon Draisaitl");
  });

  it("weightedIndex stays inside the pool", () => {
    expect(weightedIndex(3, () => 0)).toBe(0);
    expect(weightedIndex(3, () => 0.9999)).toBe(2);
    expect(weightedIndex(1, () => 0.5)).toBe(0);
  });
});

describe("full 20-team snake mock", () => {
  it("completes 320 picks with legal slot counts", () => {
    const positions: FantasyPosition[][] = [
      ["C"],
      ["C"],
      ["LW"],
      ["RW"],
      ["D"],
      ["D"],
      ["D"],
      ["G"],
      ["C", "LW"],
      ["LW", "RW"],
    ];
    const pool: MockPlayer[] = Array.from({ length: 450 }, (_, i) => {
      const pos = positions[i % positions.length];
      return player(`p${i}`, `Player ${i}`, pos, i + 1);
    });

    const { rosters, board } = simulateMockDraft(pool, { rng: () => 0 });
    expect(board).toHaveLength(MOCK_TOTAL_PICKS);
    expect(new Set(board.map((p) => p.player.id)).size).toBe(MOCK_TOTAL_PICKS);
    expect(rosters).toHaveLength(20);
    for (const roster of rosters) {
      expect(roster.picks).toHaveLength(MOCK_ROUNDS);
      expect(rosterRespectsLimits(roster)).toBe(true);
      expect(roster.filled.C).toBeLessThanOrEqual(MOCK_SLOT_LIMITS.C);
      expect(roster.filled.LW).toBeLessThanOrEqual(MOCK_SLOT_LIMITS.LW);
      expect(roster.filled.RW).toBeLessThanOrEqual(MOCK_SLOT_LIMITS.RW);
      expect(roster.filled.D).toBeLessThanOrEqual(MOCK_SLOT_LIMITS.D);
      expect(roster.filled.G).toBeLessThanOrEqual(MOCK_SLOT_LIMITS.G);
      expect(roster.filled.BN).toBeLessThanOrEqual(MOCK_SLOT_LIMITS.BN);
      const sum =
        roster.filled.C +
        roster.filled.LW +
        roster.filled.RW +
        roster.filled.D +
        roster.filled.G +
        roster.filled.BN;
      expect(sum).toBe(16);
    }
  });

  it("lets a human at slot 7 pick when it is their turn", () => {
    const positions: FantasyPosition[][] = [
      ["C"],
      ["C"],
      ["LW"],
      ["RW"],
      ["D"],
      ["D"],
      ["D"],
      ["G"],
      ["C", "LW"],
      ["LW", "RW"],
    ];
    const pool: MockPlayer[] = Array.from({ length: 450 }, (_, i) =>
      player(`p${i}`, `Player ${i}`, positions[i % positions.length], i + 1),
    );
    const humanIds: string[] = [];
    const { board, rosters } = simulateMockDraft(pool, {
      userSlot: 7,
      rng: () => 0,
      humanPick: (remaining, roster) => {
        const rem = remainingSlots(roster.filled);
        const pick =
          remaining.find((p) => assignSlot(p.positions, rem) !== null) ?? remaining[0];
        humanIds.push(pick.id);
        return pick;
      },
    });
    const humanPicks = board.filter((p) => p.by === "human");
    expect(humanPicks).toHaveLength(16);
    expect(humanPicks.every((p) => p.teamIndex === 6)).toBe(true);
    expect(humanIds).toHaveLength(16);
    expect(rosterRespectsLimits(rosters[6])).toBe(true);
  });
});

describe("last 10 picks", () => {
  function rec(pickIndex: number, teamIndex: number, name: string): MockDraftPickRecord {
    return {
      pickIndex,
      teamIndex,
      player: player(String(pickIndex), name, ["C"], pickIndex + 1),
      slot: "C",
      by: "bot",
    };
  }

  it("returns the most recent picks first and caps at 10", () => {
    const picks = Array.from({ length: 12 }, (_, i) => rec(i, i % 20, `P${i}`));
    const last = lastNPicks(picks, 10);
    expect(last).toHaveLength(10);
    expect(last.map((p) => p.pickIndex)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(lastNPicks(picks.slice(0, 3), 10).map((p) => p.pickIndex)).toEqual([2, 1, 0]);
    expect(lastNPicks([], 10)).toEqual([]);
    expect(lastNPicks(picks, 0)).toEqual([]);
  });

  it("skips holes in a sparse board", () => {
    const board = Array.from({ length: 40 }, () => null as MockDraftPickRecord | null);
    board[0] = rec(0, 0, "A");
    board[5] = rec(5, 5, "B");
    expect(lastNPicks(board, 10).map((p) => p.player.name)).toEqual(["B", "A"]);
  });
});

describe("roster-by-team view model", () => {
  it("shows all 20 seats and highlights the user's team", () => {
    const picks: MockDraftPickRecord[] = [
      {
        pickIndex: 0,
        teamIndex: 0,
        player: player("1", "Connor McDavid", ["C"], 1.5, 1),
        slot: "C",
        by: "human",
      },
      {
        pickIndex: 1,
        teamIndex: 1,
        player: player("2", "Cale Makar", ["D"], 6, 5),
        slot: "D",
        by: "bot",
      },
      {
        pickIndex: 39,
        teamIndex: 0,
        player: player("3", "Leon Draisaitl", ["C", "LW"], 5, 3),
        slot: "LW",
        by: "human",
      },
    ];
    const views = rosterByTeamViews(picks, 0);
    expect(views).toHaveLength(20);
    expect(views[0].isUser).toBe(true);
    expect(views[0].seat).toBe(1);
    expect(views[0].picks.map((p) => p.player.name)).toEqual(["Connor McDavid", "Leon Draisaitl"]);
    expect(views[0].filled.C).toBe(1);
    expect(views[0].filled.LW).toBe(1);
    expect(views[1].isUser).toBe(false);
    expect(views[1].picks).toHaveLength(1);
    expect(views[2].picks).toHaveLength(0);
    expect(rosterByTeamViews(picks, null).every((v) => v.isUser === false)).toBe(true);
  });
});

describe("own-roster drafted label", () => {
  it("joins full name, NHL team abbr, and Yahoo eligible positions", () => {
    expect(
      formatDraftedLabel({
        name: "Elias Pettersson",
        team: "VAN",
        positions: ["C", "LW"],
      }),
    ).toBe("Elias Pettersson, VAN, C/LW");
    expect(
      formatDraftedLabel({
        name: "Cale Makar",
        team: "COL",
        positions: ["D"],
      }),
    ).toBe("Cale Makar, COL, D");
    expect(formatDraftedLabel({ name: "Unknown", team: "", positions: ["G"] })).toBe("Unknown, G");
    expect(
      formatDraftedLabel({
        name: "Auston Matthews",
        team: "TOR",
        positions: ["LW", "C"],
      }),
    ).toBe("Auston Matthews, TOR, C/LW");
  });
});

describe("yahoo-like name lines", () => {
  it("shortens to initial + last name and POS • TEAM", () => {
    expect(
      formatShortName({ firstName: "Zach", lastName: "Werenski", name: "Zach Werenski" }),
    ).toBe("Z. WERENSKI");
    expect(
      formatPosTeam({ positions: ["C", "LW"], team: "NJ" }),
    ).toBe("C,LW • NJ");
    expect(
      formatLastPickTicker({
        firstName: "Auston",
        lastName: "Matthews",
        name: "Auston Matthews",
        positions: ["C"],
        team: "TOR",
      }),
    ).toBe("A. MATTHEWS (C • TOR)");
  });
});

describe("picks until turn and board labels", () => {
  it("counts snake seats until the user is on the clock", () => {
    expect(picksUntilTurn(0, 0)).toBe(0);
    expect(picksUntilTurn(0, 2)).toBe(2);
    expect(picksUntilTurn(13, 13)).toBe(0);
    expect(picksUntilTurn(19, 0)).toBe(20);
    expect(picksUntilTurn(0, null)).toBe(-1);
  });

  it("labels snake cells as round.pickInRound", () => {
    expect(boardCellLabel(0, 0)).toBe("1.1");
    expect(boardCellLabel(19, 0)).toBe("1.20");
    expect(boardCellLabel(0, 1)).toBe("2.20");
    expect(boardCellLabel(19, 1)).toBe("2.1");
    expect(boardCellLabel(0, 2)).toBe("3.1");
  });

  it("filters skaters vs goalies", () => {
    const c = player("1", "Connor McDavid", ["C"], 1.5);
    const g = player("2", "Andrei Vasilevskiy", ["G"], 11);
    expect(matchesPosFilter(c, "ALL")).toBe(true);
    expect(matchesPosFilter(c, "FD")).toBe(true);
    expect(matchesPosFilter(g, "FD")).toBe(false);
    expect(matchesPosFilter(g, "G")).toBe(true);
    expect(matchesPosFilter(c, "C")).toBe(true);
  });

  it("fills the roster strip in slot order", () => {
    const p1 = player("1", "Elias Pettersson", ["C", "LW"], 12, 12);
    p1.team = "VAN";
    const roster = applyPick(createEmptyRosters(1)[0], p1, 0)!;
    const byId = new Map([[p1.id, p1]]);
    const strip = stripSlotsFromRoster(roster, byId);
    expect(strip[0]).toMatchObject({ slot: "C", player: p1, pickIndex: 0 });
    expect(strip[1].player).toBeNull();
    expect(strip.filter((s) => s.slot === "C")).toHaveLength(2);
  });
});

describe("yahoo rank sort", () => {
  it("defaults to ADP, sorts by Yahoo-rank independently, and puts missing values last", () => {
    const pool = [
      player("a", "High Adp Low Rank", ["C"], 20, 2),
      player("b", "Low Adp High Rank", ["C"], 1.5, 10),
      player("c", "No Rank", ["C"], 3, null),
      player("d", "No Adp", ["C"], null, 4),
    ];
    expect(sortPlayers(pool).map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
    expect(sortPlayers(pool, "adp").map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
    expect(sortPlayers(pool, "yahooRank").map((p) => p.id)).toEqual(["a", "d", "b", "c"]);
    expect(compareYahooRank(pool[2], pool[0])).toBeGreaterThan(0);
    expect(compareAdp(pool[3], pool[0])).toBeGreaterThan(0);
  });
});
