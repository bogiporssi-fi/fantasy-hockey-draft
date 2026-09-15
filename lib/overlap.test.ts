import { describe, expect, it } from "vitest";
import { DEFAULT_SLOTS } from "./defaults";
import { matchPastedPlayers, parsePastedNames, searchPlayers } from "./names";
import { assignNight, evaluateCandidate, pickSlot } from "./overlap";
import { formatEligibility, toggleFantasyPosition } from "./positions";
import type { NhlPlayer, SlotConfig } from "./types";
import { buildWeeks } from "./weeks";

const twoC: SlotConfig = { ...DEFAULT_SLOTS, C: 2, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0, BN: 4 };

describe("greedy nightly assignment", () => {
  it("fills position slots then benches overflow", () => {
    const fill = assignNight(
      [
        { id: "1", positions: ["C"] },
        { id: "2", positions: ["C"] },
        { id: "3", positions: ["C"] },
      ],
      twoC,
    );
    expect(fill.started.size).toBe(2);
    expect(fill.benched).toEqual(["3"]);
    expect(fill.remaining.C).toBe(0);
  });

  it("uses dual eligibility when primary slots are gone", () => {
    const fill = assignNight(
      [
        { id: "c1", positions: ["C"] },
        { id: "c2", positions: ["C"] },
        { id: "winger", positions: ["C", "LW"] },
      ],
      { ...DEFAULT_SLOTS, C: 2, LW: 1, RW: 0, D: 0, G: 0, UTIL: 0 },
    );
    expect(fill.started.get("winger")).toBe("LW");
    expect(fill.benched).toEqual([]);
  });

  it("falls back to UTIL after position slots", () => {
    const slot = pickSlot(["C"], {
      C: 0,
      LW: 0,
      RW: 0,
      D: 0,
      G: 0,
      UTIL: 1,
    });
    expect(slot).toBe("UTIL");
  });
});

describe("candidate overlap vs existing roster (priority to roster)", () => {
  it("counts a stacked same-team night as forced bench when slots are full", () => {
    const dates = ["2026-09-29", "2026-10-03", "2026-10-06"];
    const rosterGames = new Map<string, Set<string>>([
      ["r1", new Set(dates)],
      ["r2", new Set(dates)],
    ]);
    const metrics = evaluateCandidate({
      slots: twoC,
      roster: [
        { id: "r1", positions: ["C"] },
        { id: "r2", positions: ["C"] },
      ],
      rosterGames,
      candidate: { id: "c", positions: ["C"] },
      candidateGames: dates.map((date) => ({ date, opponent: "MTL", home: true })),
      weeks: buildWeeks("2026-09-28", "2026-10-11", 1),
    });
    expect(metrics.totalGames).toBe(3);
    expect(metrics.usefulStarts).toBe(0);
    expect(metrics.forcedBenchNights).toBe(3);
    expect(metrics.complementarity).toBe(0);
  });

  it("counts complementary nights as useful starts", () => {
    const rosterDates = ["2026-09-29", "2026-10-03"];
    const candidateDates = ["2026-09-30", "2026-10-03", "2026-10-05"];
    const rosterGames = new Map<string, Set<string>>([
      ["r1", new Set(rosterDates)],
      ["r2", new Set(rosterDates)],
    ]);
    const metrics = evaluateCandidate({
      slots: twoC,
      roster: [
        { id: "r1", positions: ["C"] },
        { id: "r2", positions: ["C"] },
      ],
      rosterGames,
      candidate: { id: "c", positions: ["C"] },
      candidateGames: candidateDates.map((date) => ({ date, opponent: "EDM", home: false })),
      weeks: buildWeeks("2026-09-28", "2026-10-11", 1),
    });
    expect(metrics.usefulStarts).toBe(2);
    expect(metrics.forcedBenchNights).toBe(1);
    expect(metrics.nights.find((n) => n.date === "2026-10-03")?.result).toBe("bench");
    expect(metrics.nights.find((n) => n.date === "2026-09-30")?.result).toBe("useful");
  });

  it("Yahoo C/LW eligibility uses an open LW slot when C is full", () => {
    const dates = ["2026-09-29", "2026-10-03"];
    const rosterGames = new Map<string, Set<string>>([
      ["r1", new Set(dates)],
      ["r2", new Set(dates)],
    ]);
    const slots = { ...DEFAULT_SLOTS, C: 2, LW: 1, RW: 0, D: 0, G: 0, UTIL: 0, BN: 4 };
    const dual = evaluateCandidate({
      slots,
      roster: [
        { id: "r1", positions: ["C"] },
        { id: "r2", positions: ["C"] },
      ],
      rosterGames,
      candidate: { id: "c", positions: ["C", "LW"] },
      candidateGames: dates.map((date) => ({ date, opponent: "EDM", home: false })),
      weeks: buildWeeks("2026-09-28", "2026-10-11", 1),
    });
    const centerOnly = evaluateCandidate({
      slots,
      roster: [
        { id: "r1", positions: ["C"] },
        { id: "r2", positions: ["C"] },
      ],
      rosterGames,
      candidate: { id: "c", positions: ["C"] },
      candidateGames: dates.map((date) => ({ date, opponent: "EDM", home: false })),
      weeks: buildWeeks("2026-09-28", "2026-10-11", 1),
    });
    expect(dual.usefulStarts).toBe(2);
    expect(dual.nights.every((n) => n.slot === "LW")).toBe(true);
    expect(centerOnly.usefulStarts).toBe(0);
  });
});

describe("real NHL 2026–27 date snapshot (TOR vs MTL centers)", () => {
  // Frozen subset of api-web.nhle.com club-schedule-season 2026-27 regular season.
  const TOR = [
    "2026-09-29",
    "2026-09-30",
    "2026-10-03",
    "2026-10-06",
    "2026-10-08",
    "2026-10-10",
    "2026-10-13",
    "2026-10-15",
  ];
  const MTL = [
    "2026-09-29",
    "2026-10-03",
    "2026-10-06",
    "2026-10-08",
    "2026-10-10",
    "2026-10-13",
    "2026-10-14",
    "2026-10-17",
  ];

  it("same-team third center is fully benched; other-team center keeps off-nights", () => {
    const slots = twoC;
    const rosterGames = new Map<string, Set<string>>([
      ["matthews", new Set(TOR)],
      ["tavares", new Set(TOR)],
    ]);
    const roster = [
      { id: "matthews", positions: ["C" as const] },
      { id: "tavares", positions: ["C" as const] },
    ];
    const weeks = buildWeeks("2026-09-28", "2026-10-18", 1);

    const stacked = evaluateCandidate({
      slots,
      roster,
      rosterGames,
      candidate: { id: "nylander", positions: ["C"] },
      candidateGames: TOR.map((date) => ({ date, opponent: "MTL", home: true })),
      weeks,
    });
    expect(stacked.usefulStarts).toBe(0);
    expect(stacked.forcedBenchNights).toBe(TOR.length);

    const complementary = evaluateCandidate({
      slots,
      roster,
      rosterGames,
      candidate: { id: "suzuki", positions: ["C"] },
      candidateGames: MTL.map((date) => ({ date, opponent: "TOR", home: false })),
      weeks,
    });
    const overlap = MTL.filter((d) => TOR.includes(d)).length;
    const unique = MTL.length - overlap;
    expect(complementary.forcedBenchNights).toBe(overlap);
    expect(complementary.usefulStarts).toBe(unique);
    expect(complementary.usefulStarts).toBeGreaterThan(stacked.usefulStarts);
  });
});

describe("name paste / search", () => {
  const players: NhlPlayer[] = [
    {
      id: 1,
      firstName: "Auston",
      lastName: "Matthews",
      fullName: "Auston Matthews",
      team: "TOR",
      teamName: "Toronto Maple Leafs",
      position: "C",
      headshot: null,
      sweaterNumber: 34,
    },
    {
      id: 2,
      firstName: "Connor",
      lastName: "McDavid",
      fullName: "Connor McDavid",
      team: "EDM",
      teamName: "Edmonton Oilers",
      position: "C",
      headshot: null,
      sweaterNumber: 97,
    },
  ];

  it("parses yahoo-ish paste formats", () => {
    const names = parsePastedNames(
      "Player,Team,Pos\nMatthews, Auston,TOR,C\nConnor McDavid (EDM - C)\n",
    );
    expect(names.length).toBeGreaterThanOrEqual(1);
    const { matched } = matchPastedPlayers(["Auston Matthews", "McDavid, Connor"], players);
    expect(matched.map((p) => p.id).sort()).toEqual([1, 2]);
  });

  it("searches by last name prefix", () => {
    expect(searchPlayers("mcd", players)[0]?.lastName).toBe("McDavid");
  });
});

describe("Yahoo eligibility toggles", () => {
  it("keeps at least one position and canonical order", () => {
    expect(toggleFantasyPosition(["C"], "LW")).toEqual(["C", "LW"]);
    expect(formatEligibility(["LW", "C"])).toBe("C/LW");
    expect(toggleFantasyPosition(["C"], "C")).toEqual(["C"]);
    expect(toggleFantasyPosition(["C", "LW"], "C")).toEqual(["LW"]);
  });
});
