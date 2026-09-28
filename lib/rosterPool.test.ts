import { describe, expect, it } from "vitest";
import { injuryBadgeMeta, isListedInjury, isLongTermIr, yahooTeamToNhl } from "./injury";
import { t } from "./i18n";
import { matchPastedPlayers, searchPlayers } from "./names";
import { previousSeasonId, seasonIdForDate } from "./nhl";
import { buildPlayerPool, type InjuryIndexEntry, type RosterSourcePlayer } from "./rosterPool";
import type { FantasyPosition } from "./types";

function src(
  id: number,
  firstName: string,
  lastName: string,
  team: string,
  positionCode: string,
  teamName = team,
): RosterSourcePlayer {
  return {
    id,
    firstName,
    lastName,
    positionCode,
    headshot: null,
    sweaterNumber: null,
    team,
    teamName,
  };
}

const injuries: InjuryIndexEntry[] = [
  { name: "Seth Jarvis", team: "CAR", injury: { code: "IR-NR", note: "Shoulder" } },
  { name: "Mathew Barzal", team: "NYI", injury: { code: "DTD", note: "Knee" } },
  { name: "Jake Oettinger", team: "DAL", injury: { code: "DTD", note: "Lower Body" } },
  { name: "Casey Trade", team: "NYI", injury: { code: "IR", note: "Hip" } },
  { name: "Noah Warren", team: "ANA", injury: { code: "NA", note: null } },
];

describe("injured players missing from the active NHL roster", () => {
  const pool = buildPlayerPool({
    current: [
      src(1, "Sebastian", "Aho", "CAR", "C"),
      src(2, "Bo", "Horvat", "NYI", "C"),
      src(3, "Jake", "Oettinger", "DAL", "G"),
    ],
    previous: [
      src(1, "Sebastian", "Aho", "CAR", "C"),
      src(8482093, "Seth", "Jarvis", "CAR", "R", "Carolina Hurricanes"),
      src(8483521, "Noah", "Warren", "ANA", "D"),
      src(2, "Bo", "Horvat", "NYI", "C"),
      src(8478445, "Mathew", "Barzal", "NYI", "C", "New York Islanders"),
      src(99, "Casey", "Trade", "CAR", "L"),
    ],
    injuries,
    teamNames: new Map([
      ["CAR", "Carolina Hurricanes"],
      ["NYI", "New York Islanders"],
      ["DAL", "Dallas Stars"],
    ]),
  });

  it("adds Seth Jarvis (CAR, IR) and Mathew Barzal (NYI, DTD) so they can be searched and rostered", () => {
    const jarvis = pool.find((p) => p.fullName === "Seth Jarvis");
    const barzal = pool.find((p) => p.fullName === "Mathew Barzal");
    expect(jarvis).toMatchObject({
      id: 8482093,
      team: "CAR",
      teamName: "Carolina Hurricanes",
      position: "RW" satisfies FantasyPosition,
      injury: { code: "IR-NR", note: "Shoulder" },
    });
    expect(barzal).toMatchObject({
      id: 8478445,
      team: "NYI",
      teamName: "New York Islanders",
      position: "C",
      injury: { code: "DTD", note: "Knee" },
    });

    expect(searchPlayers("jarvis", pool).map((p) => p.id)).toEqual([8482093]);
    expect(searchPlayers("barzal", pool).map((p) => p.id)).toEqual([8478445]);
    const pasted = matchPastedPlayers(["Seth Jarvis", "Mathew Barzal"], pool);
    expect(pasted.unmatched).toEqual([]);
    expect(pasted.matched.map((p) => p.id).sort()).toEqual([8478445, 8482093]);

    const roster: { id: number; positions: FantasyPosition[] }[] = [];
    for (const player of [jarvis, barzal]) {
      expect(player).toBeTruthy();
      if (!player) continue;
      expect(roster.some((row) => row.id === player.id)).toBe(false);
      roster.push({ id: player.id, positions: [player.position] });
    }
    expect(roster).toEqual([
      { id: 8482093, positions: ["RW"] },
      { id: 8478445, positions: ["C"] },
    ]);
  });

  it("badges injured players who are already on the active roster and skips prospects", () => {
    expect(pool.find((p) => p.fullName === "Jake Oettinger")?.injury).toEqual({
      code: "DTD",
      note: "Lower Body",
    });
    expect(pool.filter((p) => p.fullName === "Sebastian Aho")).toHaveLength(1);
    expect(pool.find((p) => p.lastName === "Warren")).toBeUndefined();
    expect(pool.find((p) => p.fullName === "Casey Trade")).toMatchObject({
      team: "NYI",
      teamName: "New York Islanders",
      injury: { code: "IR", note: "Hip" },
    });
  });
});

describe("injury badges and season ids", () => {
  it("maps Yahoo statuses to Finnish-friendly badge strings", () => {
    expect(injuryBadgeMeta("IR-NR")).toEqual({ label: "injuryIR", hint: "injuryIRHint" });
    expect(injuryBadgeMeta("IR-LT")?.label).toBe("injuryIRLT");
    expect(injuryBadgeMeta("DTD")?.label).toBe("injuryDTD");
    expect(injuryBadgeMeta("O")?.label).toBe("injuryOut");
    expect(injuryBadgeMeta("NA")).toBeNull();
    expect(isListedInjury("O")).toBe(true);
    expect(isListedInjury("NA")).toBe(false);
    expect(isLongTermIr("IR-NR")).toBe(true);
    expect(isLongTermIr("DTD")).toBe(false);
    expect(t("fi").injuryDTDHint).toBe("Päivästä päivään");
    expect(t("fi").injuryIRHint).toBe("Loukkaantuneiden lista");
    expect(t("fi").injuryOut).toBe("OUT");
    expect(t("en").injuryOutHint).toBe("Out");
    expect(t("en").injuryIRLTHint).toBe("Long-term injured reserve");
  });

  it("normalizes Yahoo team abbreviations and the previous NHL season", () => {
    expect(yahooTeamToNhl("LA")).toBe("LAK");
    expect(yahooTeamToNhl("NJ")).toBe("NJD");
    expect(yahooTeamToNhl("SJ")).toBe("SJS");
    expect(yahooTeamToNhl("TB")).toBe("TBL");
    expect(yahooTeamToNhl("CAR")).toBe("CAR");
    expect(seasonIdForDate(new Date(2026, 8, 28))).toBe(20262027);
    expect(previousSeasonId(20262027)).toBe(20252026);
  });
});
