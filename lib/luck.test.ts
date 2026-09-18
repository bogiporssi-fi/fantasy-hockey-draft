import { describe, expect, it } from "vitest";
import {
  classifyGoalieLuck,
  classifySkaterLuck,
  finishDirection,
  GOALIE_GA_XG,
  goalieReport,
  ipp,
  lookupLuck,
  metricDelta,
  ozStartPct,
  pdo,
  pdoDirection,
  per60,
  ppSharePct,
  secondaryAssistPct,
  shareToPct,
  shootingPct,
  SKATER_MIN_GAMES,
  SKATER_MIN_SHOTS,
  skaterReport,
  trendMetric,
  type SkaterLuckInput,
} from "./luck";
import {
  indexLuckReports,
  mergeSkaterYears,
  parseCsv,
  parseSkaterSeasonCsv,
  parseTeamPpCsv,
  reportsFromGoalieCsv,
  reportsFromSkaterCsv,
  splitCsvLine,
} from "./moneypuck";
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
    expect(r.sh5v5.current).toBeNull();
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
    expect(r.ipp.current).toBeNull();
  });
});

describe("IPP / 5v5 SH% / trends", () => {
  it("computes IPP with a minimum on-ice goal sample", () => {
    expect(ipp(38, 51)).toBe(74.5);
    expect(ipp(3, 5)).toBeNull();
    expect(ipp(4, 5, 5)).toBe(80);
  });

  it("builds deltas vs prior 1–2 seasons", () => {
    expect(metricDelta(9.4, 11.5)).toBe(-2.1);
    expect(metricDelta(9.4, null)).toBeNull();
    const t = trendMetric([8.8, 11.5, 9.4]);
    expect(t.current).toBe(9.4);
    expect(t.delta).toBe(-2.1);
    expect(t.delta2).toBe(0.6);
    expect(t.trend).toEqual([8.8, 11.5, 9.4]);
  });

  it("assembles Frozen Tools-style 5v5 SH%, IPP and PP-IPP with a 3-season trend", () => {
    const csv = `playerId,season,name,situation,games_played,icetime,I_F_goals,I_F_xGoals,I_F_shotsOnGoal,I_F_points,OnIce_F_goals,OnIce_F_shotsOnGoal,OnIce_A_goals,OnIce_A_shotsOnGoal
1,2022,Test,all,80,96000,20,20,200,60,80,800,80,800
1,2022,Test,5on5,80,72000,12,12,120,40,55,550,50,550
1,2022,Test,5on4,80,9600,6,6,40,16,22,120,2,20
1,2023,Test,all,80,96000,28,22,200,70,90,800,80,800
1,2023,Test,5on5,80,72000,18,14,120,50,60,550,50,550
1,2023,Test,5on4,80,9600,8,6,40,20,25,120,2,20
1,2024,Test,all,80,96000,20,26,200,55,80,800,80,800
1,2024,Test,5on5,80,72000,12,16,160,38,51,550,50,550
1,2024,Test,5on4,80,9600,6,7,40,24,30,120,2,20
`;
    const [r] = mergeSkaterYears([parseSkaterSeasonCsv(csv)]);
    expect(r.sh5v5.current).toBe(7.5); // 12/160
    expect(r.sh5v5.delta).toBe(-7.5); // vs 18/120 = 15
    expect(r.sh5v5.trend).toEqual([10, 15, 7.5]);
    expect(r.ipp.current).toBe(68.8); // 55/80
    expect(r.ipp5v5.current).toBe(74.5); // 38/51
    expect(r.ppIpp.current).toBe(80); // 24/30
    expect(r.ppIpp.trend[0]).toBe(72.7); // 16/22
    expect(r.toi5v5).toBe(15);
    expect(r.toiPp).toBe(2);
    expect(r.label).toBe("unlucky");
  });

  it("computes %PP, PTS/60, OZ Start%, xG% 5v5 and secondary assist %", () => {
    expect(per60(78, 36629)).toBe(7.7);
    expect(per60(10, 1000)).toBeNull();
    expect(ozStartPct(60, 40)).toBe(60);
    expect(ozStartPct(10, 5)).toBeNull();
    expect(shareToPct(0.56)).toBe(56);
    expect(secondaryAssistPct(27, 18)).toBe(40);
    expect(ppSharePct(4914, 30, 21642, 82)).toBe(62.1);
  });

  it("assembles usage/rate/process metrics with team PP ice and multi-year Δ", () => {
    const csv = `playerId,season,name,team,situation,games_played,icetime,I_F_goals,I_F_xGoals,I_F_shotsOnGoal,I_F_points,OnIce_F_goals,OnIce_F_shotsOnGoal,OnIce_A_goals,OnIce_A_shotsOnGoal,I_F_primaryAssists,I_F_secondaryAssists,I_F_oZoneShiftStarts,I_F_dZoneShiftStarts,onIce_xGoalsPercentage,onIce_corsiPercentage
1,2023,Test,TOR,all,80,96000,28,22,200,70,90,800,80,800,30,12,0,0,0.5,0.5
1,2023,Test,TOR,5on5,80,72000,18,14,120,50,60,550,50,550,20,10,80,70,0.52,0.5
1,2023,Test,TOR,5on4,80,8000,8,6,40,20,25,120,2,20,8,4,10,0,0.85,0.8
1,2024,Test,TOR,all,80,96000,20,26,200,55,80,800,80,800,20,15,0,0,0.5,0.5
1,2024,Test,TOR,5on5,80,72000,12,16,160,38,51,550,50,550,14,9,90,60,0.56,0.51
1,2024,Test,TOR,5on4,80,9600,6,7,40,24,30,120,2,20,8,6,10,0,0.87,0.8
`;
    const teams = parseTeamPpCsv(`team,season,name,situation,games_played,iceTime
TOR,2023,TOR,5on4,82,18000
TOR,2024,TOR,5on4,82,20000
`);
    const [r] = mergeSkaterYears([parseSkaterSeasonCsv(csv)], teams);
    expect(r.ptsPer60.current).toBe(2.1); // 3600*55/96000
    expect(r.ptsPer60.delta).toBe(-0.5); // vs 3600*70/96000 = 2.6
    expect(r.sogPer60.current).toBe(7.5);
    expect(r.ozStart.current).toBe(60); // 90/150
    expect(r.ozStart.delta).toBe(6.7); // vs 80/150=53.3
    expect(r.xgPct5v5.current).toBe(56);
    expect(r.xgPct5v5.delta).toBe(4);
    expect(r.secondaryAssistPct.current).toBe(42.9); // 15/35
    expect(r.ppShare.current).toBe(49.2); // (9600/80) / (20000/82)
    expect(r.ppShare.delta).toBe(3.6); // vs (8000/80)/(18000/82)=45.6
  });

  it("falls back to 5v5 CF% when xG% is missing", () => {
    const csv = `playerId,season,name,team,situation,games_played,icetime,I_F_goals,I_F_xGoals,I_F_shotsOnGoal,I_F_points,OnIce_F_goals,OnIce_F_shotsOnGoal,OnIce_A_goals,OnIce_A_shotsOnGoal,I_F_primaryAssists,I_F_secondaryAssists,I_F_oZoneShiftStarts,I_F_dZoneShiftStarts,onIce_xGoalsPercentage,onIce_corsiPercentage
1,2024,Test,TOR,all,80,96000,20,26,200,55,80,800,80,800,20,15,0,0,0,0
1,2024,Test,TOR,5on5,80,72000,12,16,160,38,51,550,50,550,14,9,90,60,0,0.54
`;
    const [r] = mergeSkaterYears([parseSkaterSeasonCsv(csv)]);
    expect(r.xgPct5v5.current).toBe(54);
  });
});

