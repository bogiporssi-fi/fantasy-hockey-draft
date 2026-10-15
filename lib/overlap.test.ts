import { describe, expect, it } from "vitest";
import { DEFAULT_SLOTS } from "./defaults";
import { matchPastedPlayers, parsePastedNames, searchPlayers } from "./names";
import { assignNight, evaluateCandidate, pickSlot } from "./overlap";
import { formatEligibility, toggleFantasyPosition } from "./positions";
import type { FantasyPosition, NhlPlayer, SlotConfig } from "./types";
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

describe("Yahoo marks fully respected by scoring", () => {
  const dates = ["2026-09-29", "2026-10-03", "2026-10-06"];
  const weeks = buildWeeks("2026-09-28", "2026-10-11", 1);
  const slots = {
    ...DEFAULT_SLOTS,
    C: 2,
    LW: 2,
    RW: 0,
    D: 0,
    G: 0,
    UTIL: 0,
    BN: 4,
  };
  const rosterGames = new Map<string, Set<string>>([
    ["c1", new Set(dates)],
    ["c2", new Set(dates)],
  ]);
  const twoCenters = [
    { id: "c1", positions: ["C" as const] },
    { id: "c2", positions: ["C" as const] },
  ];
  const games = dates.map((date) => ({ date, opponent: "EDM" as const, home: false }));

  it("LW-only cannot consume a C slot even when C is open", () => {
    const fill = assignNight([{ id: "winger", positions: ["LW"] }], {
      ...DEFAULT_SLOTS,
      C: 2,
      LW: 2,
      UTIL: 0,
    });
    expect(fill.started.get("winger")).toBe("LW");
    expect(fill.remaining.C).toBe(2);
    expect(fill.remaining.LW).toBe(1);

    const noLw = assignNight([{ id: "winger", positions: ["LW"] }], {
      ...DEFAULT_SLOTS,
      C: 2,
      LW: 0,
      UTIL: 0,
    });
    expect(noLw.started.has("winger")).toBe(false);
    expect(noLw.benched).toEqual(["winger"]);
    expect(noLw.remaining.C).toBe(2);

    const metrics = evaluateCandidate({
      slots: { ...DEFAULT_SLOTS, C: 2, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0, BN: 4 },
      roster: [],
      rosterGames: new Map(),
      candidate: { id: "x", positions: ["LW"] },
      candidateGames: games,
      weeks,
    });
    expect(metrics.usefulStarts).toBe(0);
    expect(metrics.forcedBenchNights).toBe(3);
    expect(metrics.nights.every((n) => n.slot === null)).toBe(true);
  });

  it("C/LW can fill C when open, or LW when C is already full", () => {
    const openC = assignNight([{ id: "dual", positions: ["C", "LW"] }], {
      ...DEFAULT_SLOTS,
      C: 1,
      LW: 1,
      UTIL: 0,
    });
    expect(openC.started.get("dual")).toBe("C");

    const cFull = assignNight(
      [
        { id: "c1", positions: ["C"] },
        { id: "dual", positions: ["C", "LW"] },
      ],
      { ...DEFAULT_SLOTS, C: 1, LW: 1, UTIL: 0 },
    );
    expect(cFull.started.get("c1")).toBe("C");
    expect(cFull.started.get("dual")).toBe("LW");
  });

  it("changing Yahoo marks changes useful vs forced-bench counts", () => {
    const base = {
      slots,
      roster: twoCenters,
      rosterGames,
      candidateGames: games,
      weeks,
    };
    const asC = evaluateCandidate({ ...base, candidate: { id: "x", positions: ["C"] } });
    const asLw = evaluateCandidate({ ...base, candidate: { id: "x", positions: ["LW"] } });
    const asDual = evaluateCandidate({
      ...base,
      candidate: { id: "x", positions: ["C", "LW"] },
    });

    expect(asC.usefulStarts).toBe(0);
    expect(asC.forcedBenchNights).toBe(3);
    expect(asC.nights.every((n) => n.slot === null)).toBe(true);

    expect(asLw.usefulStarts).toBe(3);
    expect(asLw.forcedBenchNights).toBe(0);
    expect(asLw.nights.every((n) => n.slot === "LW")).toBe(true);

    expect(asDual.usefulStarts).toBe(3);
    expect(asDual.forcedBenchNights).toBe(0);
    expect(asDual.nights.every((n) => n.slot === "LW")).toBe(true);

    expect(asLw.usefulStarts).toBeGreaterThan(asC.usefulStarts);
    expect(asDual.forcedBenchNights).toBeLessThan(asC.forcedBenchNights);
  });

  it("UTIL is only used when the league profile has remaining UTIL", () => {
    const cFullNoUtil = pickSlot(["C"], {
      C: 0,
      LW: 2,
      RW: 0,
      D: 0,
      G: 0,
      UTIL: 0,
    });
    expect(cFullNoUtil).toBeNull();

    const cFullWithUtil = pickSlot(["C"], {
      C: 0,
      LW: 2,
      RW: 0,
      D: 0,
      G: 0,
      UTIL: 1,
    });
    expect(cFullWithUtil).toBe("UTIL");

    const lwOnlyIgnoresOpenC = pickSlot(["LW"], {
      C: 2,
      LW: 0,
      RW: 0,
      D: 0,
      G: 0,
      UTIL: 0,
    });
    expect(lwOnlyIgnoresOpenC).toBeNull();
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

function caps(partial: Partial<SlotConfig>): SlotConfig {
  return { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0, BN: 0, ...partial };
}

/** Independent exhaustive search. Not the production matcher. */
function bruteStarts(
  players: { id: string; positions: FantasyPosition[] }[],
  slots: SlotConfig,
): number {
  const order = ["C", "LW", "RW", "D", "G", "UTIL"] as const;
  const fantasy = new Set(["C", "LW", "RW", "D", "G"]);
  const cap: Record<(typeof order)[number], number> = {
    C: 0,
    LW: 0,
    RW: 0,
    D: 0,
    G: 0,
    UTIL: 0,
  };
  for (const slot of order) {
    const n = slots[slot];
    cap[slot] = typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  const seen = new Set<string>();
  const unique = players.filter((player) => {
    if (seen.has(player.id)) return false;
    seen.add(player.id);
    return true;
  });
  function legal(positions: FantasyPosition[], slot: (typeof order)[number]): boolean {
    if (slot === "UTIL") return true;
    return positions.some((pos) => pos === slot && fantasy.has(pos));
  }
  function rec(index: number): number {
    if (index === unique.length) return 0;
    const player = unique[index];
    let best = rec(index + 1);
    for (const slot of order) {
      if (cap[slot] <= 0 || !legal(player.positions, slot)) continue;
      cap[slot] -= 1;
      best = Math.max(best, 1 + rec(index + 1));
      cap[slot] += 1;
    }
    return best;
  }
  return rec(0);
}

describe("maximum matching", () => {
  const dates = ["2026-10-15", "2026-10-17", "2026-10-20"];
  const weeks = buildWeeks("2026-10-12", "2026-10-25", 1);
  const games = dates.map((date) => ({ date, opponent: "EDM", home: true }));

  it("starts MacKinnon at C and moves Hughes C/LW to LW", () => {
    const slots = caps({ C: 2, LW: 2 });
    const roster = [
      { id: "crosby", positions: ["C" as const] },
      { id: "hughes", positions: ["C" as const, "LW" as const] },
    ];
    const candidate = { id: "mack", positions: ["C" as const] };
    const fill = assignNight([...roster, candidate], slots);
    expect(fill.started.size).toBe(3);
    expect(fill.started.get("crosby")).toBe("C");
    expect(fill.started.get("mack")).toBe("C");
    expect(fill.started.get("hughes")).toBe("LW");

    const rosterGames = new Map(dates.map(() => ["x", new Set<string>()]));
    rosterGames.clear();
    for (const player of roster) rosterGames.set(player.id, new Set(dates));
    const metrics = evaluateCandidate({
      slots,
      roster,
      rosterGames,
      candidate,
      candidateGames: games,
      weeks,
    });
    expect(metrics.usefulStarts).toBe(3);
    expect(metrics.forcedBenchNights).toBe(0);
    expect(metrics.nights.every((night) => night.slot === "C" && night.result === "useful")).toBe(true);
    expect(metrics.byWeek.reduce((sum, week) => sum + week.useful, 0)).toBe(metrics.usefulStarts);
    expect(metrics.byWeek.reduce((sum, week) => sum + week.bench, 0)).toBe(0);
    expect(metrics.byWeek.reduce((sum, week) => sum + week.candidateGames, 0)).toBe(3);
  });

  it("starts 5 on the night greedy assignment left at 4", () => {
    const slots = caps({ C: 2, LW: 2, RW: 2 });
    const players = [
      { id: "p0", positions: ["C" as const] },
      { id: "p1", positions: ["C" as const] },
      { id: "p2", positions: ["C" as const] },
      { id: "p3", positions: ["LW" as const] },
      { id: "p4", positions: ["LW" as const, "RW" as const] },
      { id: "p5", positions: ["C" as const, "LW" as const] },
    ];
    const fill = assignNight(players, slots);
    expect(fill.started.size).toBe(5);
    expect(bruteStarts(players, slots)).toBe(5);
    expect(fill.started.has("p2")).toBe(false);
    expect(fill.started.get("p4")).toBe("RW");
    expect(fill.started.get("p5")).toBe("LW");
    expect(fill.benched).toEqual(["p2"]);
  });

  it("matches brute force on random legal lineups", () => {
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const marks: FantasyPosition[][] = [
      [],
      ["C"],
      ["LW"],
      ["RW"],
      ["D"],
      ["G"],
      ["C", "LW"],
      ["LW", "RW"],
      ["C", "LW", "RW"],
      ["D", "C"],
    ];
    let checked = 0;
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(rand() * 5);
      const players = Array.from({ length: n }, (_, i) => ({
        id: `r${i}`,
        positions: marks[Math.floor(rand() * marks.length)],
      }));
      const slots = caps({
        C: Math.floor(rand() * 2),
        LW: Math.floor(rand() * 2),
        RW: Math.floor(rand() * 2),
        D: Math.floor(rand() * 2),
        G: Math.floor(rand() * 2),
        UTIL: Math.floor(rand() * 2),
      });
      const fill = assignNight(players, slots);
      expect(fill.started.size).toBe(bruteStarts(players, slots));
      for (const [id, slot] of fill.started) {
        const player = players.find((row) => row.id === id);
        expect(player).toBeTruthy();
        if (slot === "UTIL") continue;
        expect(player?.positions).toContain(slot);
      }
      checked++;
    }
    expect(checked).toBe(40);
  });
});
