import { describe, expect, it } from "vitest";
import {
  classifyGoalieLuck,
  classifySkaterLuck,
  finishDirection,
  GOALIE_GA_XG,
  goalieReport,
  lookupLuck,
  pdo,
  pdoDirection,
  shootingPct,
  SKATER_MIN_GAMES,
  SKATER_MIN_SHOTS,
  skaterReport,
  type SkaterLuckInput,
} from "./luck";
import { indexLuckReports, parseCsv, reportsFromGoalieCsv, reportsFromSkaterCsv, splitCsvLine } from "./moneypuck";
import { normalizeName } from "./names";

const enough: SkaterLuckInput = {
  gamesPlayed: 70,
  goals: 30,
  xGoals: 30,
  shotsOnGoal: 200,
  onIceGoalsFor: 80,
  onIceShotsFor: 800,
  onIceGoalsAgainst: 80,
  onIceShotsAgainst: 800,
};

describe("shootingPct and pdo helpers", () => {
  it("returns null without shots", () => {
    expect(shootingPct(5, 0)).toBeNull();
    expect(pdo(10, 0, 10, 100)).toBeNull();
    expect(pdo(10, 100, 10, 50)).toBeNull();
  });

  it("computes SH% and ~100 PDO on even on-ice rates", () => {
    expect(shootingPct(33, 261)).toBe(12.6);
    expect(pdo(80, 800, 80, 800)).toBe(100);
    expect(pdo(100, 800, 60, 800)).toBe(105);
    expect(pdo(60, 800, 100, 800)).toBe(95);
  });
});

describe("finishDirection / pdoDirection", () => {
  it("flags finishing from goals vs xG or SH% gap", () => {
    expect(finishDirection(6, 15, 12)).toBe(1);
    expect(finishDirection(-6, 9, 12)).toBe(-1);
    expect(finishDirection(1, 16, 12)).toBe(1);
    expect(finishDirection(0, 12, 12.2)).toBe(0);
  });

  it("treats PDO within ±2 of 100 as neutral", () => {
    expect(pdoDirection(100)).toBe(0);
    expect(pdoDirection(101.9)).toBe(0);
    expect(pdoDirection(102)).toBe(1);
    expect(pdoDirection(98)).toBe(-1);
    expect(pdoDirection(null)).toBe(0);
  });
});

describe("classifySkaterLuck", () => {
  it("returns thin when games or shots are short", () => {
    expect(classifySkaterLuck({ ...enough, gamesPlayed: SKATER_MIN_GAMES - 1 }).label).toBe("thin");
    expect(classifySkaterLuck({ ...enough, shotsOnGoal: SKATER_MIN_SHOTS - 1 }).why).toBe("thin_sample");
  });

  it("labels lucky finishing when goals beat xG", () => {
    const r = classifySkaterLuck({ ...enough, goals: 40, xGoals: 28 });
    expect(r).toEqual({ label: "lucky", why: "finish_high" });
  });

  it("labels unlucky finishing when goals miss xG (Matthews-like)", () => {
    const r = classifySkaterLuck({
      ...enough,
      goals: 33,
      xGoals: 41,
      shotsOnGoal: 261,
      onIceGoalsFor: 90,
      onIceShotsFor: 800,
      onIceGoalsAgainst: 74,
      onIceShotsAgainst: 800,
    });
    expect(r.label).toBe("unlucky");
    expect(r.why).toBe("finish_low");
  });

  it("uses PDO when finishing is average", () => {
    expect(classifySkaterLuck({ ...enough, onIceGoalsFor: 110, onIceGoalsAgainst: 60 })).toEqual({
      label: "lucky",
      why: "pdo_high",
    });
    expect(classifySkaterLuck({ ...enough, onIceGoalsFor: 50, onIceGoalsAgainst: 110 })).toEqual({
      label: "unlucky",
      why: "pdo_low",
    });
  });

  it("combines finishing and PDO when they agree", () => {
    expect(
      classifySkaterLuck({
        ...enough,
        goals: 45,
        xGoals: 30,
        onIceGoalsFor: 110,
        onIceGoalsAgainst: 60,
      }),
    ).toEqual({ label: "lucky", why: "both_high" });
    expect(
      classifySkaterLuck({
        ...enough,
        goals: 15,
        xGoals: 28,
        onIceGoalsFor: 50,
        onIceGoalsAgainst: 110,
      }),
    ).toEqual({ label: "unlucky", why: "both_low" });
  });

  it("keeps finishing as the label when PDO is only mildly opposite", () => {
    const r = classifySkaterLuck({
      ...enough,
      goals: 33,
      xGoals: 41,
      shotsOnGoal: 261,
      onIceGoalsFor: 90,
      onIceShotsFor: 800,
      onIceGoalsAgainst: 74,
      onIceShotsAgainst: 800,
    });
    expect(pdo(90, 800, 74, 800)).toBe(102);
    expect(r).toEqual({ label: "unlucky", why: "finish_low" });
  });

  it("calls mixed only when PDO strongly disagrees with finishing", () => {
    const r = classifySkaterLuck({
      ...enough,
      goals: 40,
      xGoals: 28,
      onIceGoalsFor: 50,
      onIceGoalsAgainst: 110,
    });
    expect(r).toEqual({ label: "neutral", why: "mixed" });
  });

  it("is neutral near league averages", () => {
    expect(classifySkaterLuck(enough)).toEqual({ label: "neutral", why: "near_average" });
  });
});

describe("classifyGoalieLuck", () => {
  it("returns thin under 15 games", () => {
    expect(classifyGoalieLuck({ gamesPlayed: 10, goalsAgainst: 40, xGoalsAgainst: 40, shotsOnGoalAgainst: 400 })).toEqual(
      { label: "thin", why: "thin_sample" },
    );
  });

  it("treats fewer goals against than xGA as lucky", () => {
    expect(
      classifyGoalieLuck({
        gamesPlayed: 50,
        goalsAgainst: 120,
        xGoalsAgainst: 120 + GOALIE_GA_XG + 1,
        shotsOnGoalAgainst: 1400,
      }),
    ).toEqual({ label: "lucky", why: "goalie_saves_high" });
  });

  it("treats more goals against than xGA as unlucky", () => {
    expect(
      classifyGoalieLuck({
        gamesPlayed: 50,
        goalsAgainst: 140,
        xGoalsAgainst: 140 - GOALIE_GA_XG - 1,
        shotsOnGoalAgainst: 1400,
      }),
    ).toEqual({ label: "unlucky", why: "goalie_saves_low" });
  });
});

const skaterFixture = `playerId,season,name,team,position,situation,games_played,I_F_xGoals,I_F_shotsOnGoal,I_F_goals,OnIce_F_goals,OnIce_F_shotsOnGoal,OnIce_A_goals,OnIce_A_shotsOnGoal
8479318,2024,Auston Matthews,TOR,C,all,67,41.0,261,33,0,0,0,0
8479318,2024,Auston Matthews,TOR,C,5on5,67,20,120,12,90,800,74,800
8478402,2024,Connor McDavid,EDM,C,all,67,26.9,196,26,0,0,0,0
8478402,2024,Connor McDavid,EDM,C,5on5,67,15,100,12,70,800,90,800
`;

const goalieFixture = `playerId,season,name,team,position,situation,games_played,xGoals,goals,ongoal
8476945,2024,Connor Hellebuyck,WPG,G,all,63,164.6,125,1664
8476945,2024,Connor Hellebuyck,WPG,G,5on5,63,100,80,1200
`;

describe("MoneyPuck CSV parse", () => {
  it("splits quoted commas", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("builds skater reports keyed by NHL id with 5v5 PDO", () => {
    const reports = reportsFromSkaterCsv(skaterFixture);
    const matthews = reports.find((r) => r.playerId === 8479318);
    expect(matthews?.kind).toBe("skater");
    expect(matthews?.goals).toBe(33);
    expect(matthews?.xGoals).toBe(41);
    expect(matthews?.goalsMinusXg).toBe(-8);
    expect(matthews?.label).toBe("unlucky");
    expect(matthews?.pdo).toBe(102);
  });

  it("builds goalie reports from all-situations rows", () => {
    const [g] = reportsFromGoalieCsv(goalieFixture);
    expect(g.playerId).toBe(8476945);
    expect(g.kind).toBe("goalie");
    expect(g.label).toBe("lucky");
    expect(g.goalsAgainst).toBe(125);
  });

  it("indexes unique names for fallback lookup", () => {
    const { byId, byName } = indexLuckReports(reportsFromSkaterCsv(skaterFixture));
    const hit = lookupLuck(byId, byName, 0, "Auston Matthews", normalizeName);
    expect(hit?.playerId).toBe(8479318);
    expect(lookupLuck(byId, byName, 8478402, "Nobody", normalizeName)?.name).toBe("Connor McDavid");
  });

  it("skips short malformed csv", () => {
    expect(parseCsv("only-header\n")).toEqual([]);
  });
});

describe("report builders", () => {
  it("fills skater display fields", () => {
    const r = skaterReport(1, "Test", enough, enough);
    expect(r.kind).toBe("skater");
    expect(r.goalsMinusXg).toBe(0);
    expect(r.pdo).toBe(100);
  });

  it("fills goalie display fields", () => {
    const r = goalieReport(2, "G", {
      gamesPlayed: 40,
      goalsAgainst: 100,
      xGoalsAgainst: 110,
      shotsOnGoalAgainst: 1000,
    });
    expect(r.savePct).toBe(90);
    expect(r.expectedSavePct).toBe(89);
    expect(r.goalsMinusXg).toBe(10);
  });
});
