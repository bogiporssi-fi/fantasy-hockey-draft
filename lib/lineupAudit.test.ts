import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gamesForTeam, fantasyGameDate } from "./nhl";
import { assignNight, evaluateCandidate } from "./overlap";
import { nhlDefaultEligibility } from "./positions";
import { buildPlayerPool, type InjuryIndexEntry, type RosterSourcePlayer } from "./rosterPool";
import { revivePositions, reviveState } from "./storage";
import type { FantasyPosition, NhlPayload, SlotConfig } from "./types";
import { addDays, buildWeeks, localIsoDate, weekContaining } from "./weeks";

function slots(partial: Partial<SlotConfig>): SlotConfig {
  return { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0, BN: 0, ...partial };
}

describe("league slot counts", () => {
  it("uses custom C/LW/RW/D/G counts and ignores BN", () => {
    const custom = slots({ C: 1, LW: 3, D: 2, G: 1, UTIL: 0, BN: 12 });
    const fill = assignNight(
      [
        { id: "c1", positions: ["C"] },
        { id: "c2", positions: ["C"] },
        { id: "lw", positions: ["LW"] },
        { id: "d", positions: ["D"] },
        { id: "g", positions: ["G"] },
        { id: "extra", positions: ["RW"] },
      ],
      custom,
    );
    expect(fill.started.get("c1")).toBe("C");
    expect(fill.benched).toContain("c2");
    expect(fill.benched).toContain("extra");
    expect(fill.started.get("lw")).toBe("LW");
    expect(fill.started.get("d")).toBe("D");
    expect(fill.started.get("g")).toBe("G");
    expect(fill.started.size).toBe(4);
  });

  it("floors fractional slot counts and treats negatives as zero", () => {
    const fill = assignNight(
      [
        { id: "a", positions: ["C"] },
        { id: "b", positions: ["C"] },
        { id: "c", positions: ["C"] },
      ],
      slots({ C: 2.9, LW: -3 }),
    );
    expect(fill.started.size).toBe(2);
    expect(fill.remaining.C).toBe(0);
  });
});

describe("goalies, UTIL, and eligibility width", () => {
  it("keeps goalies out of skater slots and skaters out of G", () => {
    const fill = assignNight(
      [
        { id: "goalie", positions: ["G"] },
        { id: "center", positions: ["C"] },
      ],
      slots({ C: 1, G: 1, LW: 2 }),
    );
    expect(fill.started.get("goalie")).toBe("G");
    expect(fill.started.get("center")).toBe("C");

    const parked = assignNight([{ id: "goalie", positions: ["G"] }], slots({ C: 2, LW: 2, G: 0 }));
    expect(parked.benched).toEqual(["goalie"]);
    expect(parked.remaining.C).toBe(2);
  });

  it("lets a goalie use UTIL only when G is full and the league has UTIL", () => {
    const noUtil = assignNight(
      [
        { id: "g1", positions: ["G"] },
        { id: "g2", positions: ["G"] },
      ],
      slots({ G: 1, UTIL: 0, C: 1 }),
    );
    expect(noUtil.started.size).toBe(1);
    expect(noUtil.benched).toEqual(["g2"]);

    const withUtil = assignNight(
      [
        { id: "g1", positions: ["G"] },
        { id: "g2", positions: ["G"] },
      ],
      slots({ G: 1, UTIL: 1 }),
    );
    expect(withUtil.started.get("g1")).toBe("G");
    expect(withUtil.started.get("g2")).toBe("UTIL");
  });

  it("starts players with 0 marks only in UTIL, and 3 marks in any of those slots", () => {
    const empty = assignNight([{ id: "blank", positions: [] }], slots({ C: 2, UTIL: 0 }));
    expect(empty.benched).toEqual(["blank"]);
    const utilOnly = assignNight([{ id: "blank", positions: [] }], slots({ UTIL: 1 }));
    expect(utilOnly.started.get("blank")).toBe("UTIL");

    const wing = assignNight([{ id: "flex", positions: ["C", "LW", "RW"] }], slots({ RW: 1 }));
    expect(wing.started.get("flex")).toBe("RW");
  });

  it("plays a D/C player on D when C is full and on C when both are open", () => {
    const both = assignNight([{ id: "mix", positions: ["D", "C"] }], slots({ C: 1, D: 1 }));
    expect(both.started.get("mix")).toBe("C");
    const defense = assignNight(
      [
        { id: "center", positions: ["C"] },
        { id: "mix", positions: ["D", "C"] },
      ],
      slots({ C: 1, D: 1 }),
    );
    expect(defense.started.get("center")).toBe("C");
    expect(defense.started.get("mix")).toBe("D");
  });
});

describe("roster edges", () => {
  it("starts a candidate against an empty roster and benches overflow", () => {
    const dates = ["2026-10-15"];
    const metrics = evaluateCandidate({
      slots: slots({ C: 2 }),
      roster: [],
      rosterGames: new Map(),
      candidate: { id: "solo", positions: ["C"] },
      candidateGames: dates.map((date) => ({ date, opponent: "BOS", home: true })),
      weeks: buildWeeks("2026-10-12", "2026-10-18", 1),
    });
    expect(metrics.usefulStarts).toBe(1);
    expect(metrics.nights[0]?.slot).toBe("C");

    const overflow = assignNight(
      ["a", "b", "c", "d", "e"].map((id) => ({ id, positions: ["C" as const] })),
      slots({ C: 2 }),
    );
    expect(overflow.started.size).toBe(2);
    expect(overflow.benched).toEqual(["c", "d", "e"]);
  });

  it("keeps the first copy when ids are duplicated and does not count the candidate twice", () => {
    const dupes = assignNight(
      [
        { id: "b", positions: ["C"] },
        { id: "a", positions: ["C"] },
        { id: "b", positions: ["LW"] },
      ],
      slots({ C: 1, LW: 1 }),
    );
    expect(dupes.started.get("a")).toBe("C");
    expect(dupes.started.has("b")).toBe(false);
    expect(dupes.benched).toEqual(["b"]);

    const dates = ["2026-10-15"];
    const metrics = evaluateCandidate({
      slots: slots({ C: 1, LW: 1 }),
      roster: [
        { id: "other", positions: ["C"] },
        { id: "mack", positions: ["C"] },
      ],
      rosterGames: new Map([
        ["other", new Set(dates)],
        ["mack", new Set(dates)],
      ]),
      candidate: { id: "mack", positions: ["C", "LW"] },
      candidateGames: [{ date: dates[0], opponent: "BOS", home: true }],
      weeks: buildWeeks("2026-10-12", "2026-10-18", 1),
    });
    expect(metrics.usefulStarts).toBe(1);
    expect(metrics.nights[0]?.rosterPlaying).toBe(1);
    expect(metrics.nights[0]?.slot).toBe("LW");
  });

  it("counts a repeated game date once", () => {
    const game = { date: "2026-10-15", opponent: "BOS", home: true };
    const metrics = evaluateCandidate({
      slots: slots({ C: 1 }),
      roster: [],
      rosterGames: new Map(),
      candidate: { id: "solo", positions: ["C"] },
      candidateGames: [game, { ...game }],
      weeks: buildWeeks("2026-10-12", "2026-10-18", 1),
    });
    expect(metrics.totalGames).toBe(1);
    expect(metrics.usefulStarts).toBe(1);
  });
});

describe("schedule dates, weeks, and team lookup", () => {
  it("keeps a US evening game on NHL gameDate, not the next UTC day", () => {
    const date = fantasyGameDate({
      gameDate: "2026-10-18",
      startTimeUTC: "2026-10-19T02:30:00Z",
    });
    expect(date).toBe("2026-10-18");
    const weeks = buildWeeks("2026-10-12", "2026-11-08", 1);
    expect(weekContaining(weeks, "2026-10-18")?.start).toBe("2026-10-12");
    expect(weekContaining(weeks, "2026-10-19")?.start).toBe("2026-10-19");
    expect(fantasyGameDate({ gameDate: "not-a-date", startTimeUTC: "2026-10-19T02:30:00Z" })).toBeNull();
  });

  it("splits Monday-start weeks on the calendar date and counts back-to-backs separately", () => {
    const weeks = buildWeeks("2026-10-12", "2026-10-25", 1);
    const sunday = "2026-10-18";
    const monday = "2026-10-19";
    expect(weekContaining(weeks, sunday)?.end).toBe(sunday);
    expect(weekContaining(weeks, monday)?.start).toBe(monday);

    const metrics = evaluateCandidate({
      slots: slots({ C: 1 }),
      roster: [],
      rosterGames: new Map(),
      candidate: { id: "b2b", positions: ["C"] },
      candidateGames: [sunday, monday].map((date) => ({ date, opponent: "DET", home: false })),
      weeks,
    });
    expect(metrics.totalGames).toBe(2);
    expect(metrics.usefulStarts).toBe(2);
    expect(metrics.byWeek.map((week) => week.candidateGames)).toEqual([1, 1]);
    expect(addDays(sunday, 1)).toBe(monday);
  });

  it("resolves local today in America/New_York for a post-midnight UTC instant", () => {
    const file = path.resolve("lib/weeks.ts");
    const code = `import { localIsoDate } from ${JSON.stringify(file)};
const instant = new Date("2026-10-19T02:30:00Z");
console.log(localIsoDate(instant));
console.log(instant.toISOString().slice(0, 10));`;
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", code],
      { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" },
    )
      .trim()
      .split("\n");
    expect(out[0]).toBe("2026-10-18");
    expect(out[1]).toBe("2026-10-19");
    expect(localIsoDate(new Date("2026-10-19T02:30:00Z"))).toBe(
      `${new Date("2026-10-19T02:30:00Z").getFullYear()}-${String(new Date("2026-10-19T02:30:00Z").getMonth() + 1).padStart(2, "0")}-${String(new Date("2026-10-19T02:30:00Z").getDate()).padStart(2, "0")}`,
    );
  });

  it("looks up the schedule by current NHL abbreviation after a team change", () => {
    const src = (
      id: number,
      firstName: string,
      lastName: string,
      team: string,
      positionCode: string,
    ): RosterSourcePlayer => ({
      id,
      firstName,
      lastName,
      positionCode,
      headshot: null,
      sweaterNumber: null,
      team,
      teamName: team,
    });
    const injuries: InjuryIndexEntry[] = [
      { name: "Casey Trade", team: "NYI", injury: { code: "IR", note: "Hip" } },
    ];
    const pool = buildPlayerPool({
      current: [],
      previous: [src(99, "Casey", "Trade", "CAR", "L")],
      injuries,
      teamNames: new Map([["NYI", "New York Islanders"]]),
    });
    const player = pool.find((row) => row.id === 99);
    expect(player?.team).toBe("NYI");
    const data = {
      teamGames: {
        NYI: [{ date: "2026-10-20", opponent: "PIT", home: true }],
        CAR: [{ date: "2026-10-15", opponent: "TBL", home: false }],
      },
    } as Pick<NhlPayload, "teamGames">;
    expect(gamesForTeam(data as NhlPayload, player?.team ?? "")).toEqual(data.teamGames.NYI);
    expect(gamesForTeam(data as NhlPayload, "LA")).toEqual([]);
    expect(gamesForTeam(data as NhlPayload, "CAR")).toEqual(data.teamGames.CAR);
  });
});

describe("Vertailu totals and persistence", () => {
  it("keeps Hyöty, Penkki, Aukot, and weekly totals on the same matching", () => {
    const days: string[] = [];
    for (let d = "2026-10-12"; d <= "2026-10-18"; d = addDays(d, 1)) days.push(d);
    const slotsC = slots({ C: 2, LW: 2 });
    const roster = [
      { id: "crosby", positions: ["C" as const] },
      { id: "hughes", positions: ["C" as const, "LW" as const] },
    ];
    const rosterGames = new Map(roster.map((player) => [player.id, new Set(days)]));
    const metrics = evaluateCandidate({
      slots: slotsC,
      roster,
      rosterGames,
      candidate: { id: "mack", positions: ["C"] },
      candidateGames: days.map((date) => ({ date, opponent: "BOS", home: true })),
      weeks: buildWeeks("2026-10-12", "2026-10-18", 1),
    });
    expect(metrics.usefulStarts).toBe(7);
    expect(metrics.forcedBenchNights).toBe(0);
    expect(metrics.usefulStarts + metrics.forcedBenchNights).toBe(metrics.totalGames);
    const week = metrics.byWeek[0];
    expect(week?.candidateGames).toBe(7);
    expect(week?.useful).toBe(7);
    expect(week?.bench).toBe(0);
    expect(week?.emptyEligibleNights).toBe(7);
    expect(week?.rosterPlayerGames).toBe(14);
    expect(metrics.byWeek.reduce((sum, row) => sum + row.useful, 0)).toBe(metrics.usefulStarts);
    expect(metrics.byWeek.reduce((sum, row) => sum + row.bench, 0)).toBe(metrics.forcedBenchNights);
    expect(metrics.byWeek.reduce((sum, row) => sum + row.candidateGames, 0)).toBe(metrics.totalGames);
    expect(metrics.nights.every((night) => night.openEligibleSlots === (night.result === "useful" ? 1 : 0))).toBe(
      true,
    );
  });

  it("revives multi-position marks, drops bad marks and duplicate ids, and does not keep Vertailu", () => {
    const state = reviveState({
      lang: "fi",
      activeProfileId: "kimppa",
      tray: [{ id: 7, positions: ["C", "LW"] }],
      profiles: [
        {
          id: "kimppa",
          name: "Kimppa",
          slots: { C: 3, BN: 2 },
          weekStartsOn: 1,
          roster: [
            { id: 10, positions: ["LW", "C", "F", "LW"] },
            { id: 10, positions: ["G"] },
            { id: 11, positions: [] },
            { id: 12, positions: "C" },
          ],
        },
      ],
    });
    expect("tray" in state).toBe(false);
    expect(state.profiles[0]?.slots.C).toBe(3);
    expect(state.profiles[0]?.slots.LW).toBe(2);
    expect(state.profiles[0]?.roster).toEqual([
      { id: 10, positions: ["LW", "C"] },
      { id: 11, positions: ["C"] },
      { id: 12, positions: ["C"] },
    ]);
    expect(revivePositions(["D", "RW", "D"])).toEqual(["D", "RW"]);
    expect(nhlDefaultEligibility("RW")).toEqual(["RW"]);
    const pasted: FantasyPosition[] = nhlDefaultEligibility("C");
    expect(pasted).not.toContain("LW");
  });
});

describe("injury is not an active-slot filter", () => {
  it("still starts a player who is only identified by id and Yahoo marks", () => {
    const fill = assignNight([{ id: "ir-player", positions: ["RW"] }], slots({ RW: 1, C: 1 }));
    expect(fill.started.get("ir-player")).toBe("RW");
  });
});
