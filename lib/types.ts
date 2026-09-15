export const FANTASY_POSITIONS = ["C", "LW", "RW", "D", "G"] as const;
export type FantasyPosition = (typeof FANTASY_POSITIONS)[number];

export type StartSlot = FantasyPosition | "UTIL";
export const START_SLOTS: StartSlot[] = ["C", "LW", "RW", "D", "G", "UTIL"];

export interface SlotConfig {
  C: number;
  LW: number;
  RW: number;
  D: number;
  G: number;
  UTIL: number;
  BN: number;
}

export interface NhlGame {
  date: string;
  opponent: string;
  home: boolean;
}

export interface NhlPlayer {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  team: string;
  teamName: string;
  position: FantasyPosition;
  headshot: string | null;
  sweaterNumber: number | null;
}

export interface NhlPayload {
  season: number;
  seasonLabel: string;
  regularSeasonStart: string;
  regularSeasonEnd: string;
  fetchedAt: string;
  teams: { abbrev: string; name: string }[];
  players: NhlPlayer[];
  teamGames: Record<string, NhlGame[]>;
  missingTeams: string[];
}

export interface RosterPlayer {
  id: number;
  positions: FantasyPosition[];
}

export interface LeagueProfile {
  id: string;
  name: string;
  slots: SlotConfig;
  weekStartsOn: 0 | 1;
  roster: RosterPlayer[];
}

export type Lang = "fi" | "en";

export interface AppState {
  lang: Lang;
  activeProfileId: string;
  profiles: LeagueProfile[];
}

export interface WeekWindow {
  index: number;
  start: string;
  end: string;
}

export type NightResult = "useful" | "bench";

export interface NightOutcome {
  date: string;
  result: NightResult;
  slot: StartSlot | null;
  rosterPlaying: number;
  openEligibleSlots: number;
  opponent: string;
  home: boolean;
}

export interface WeekMetrics {
  week: WeekWindow;
  candidateGames: number;
  useful: number;
  bench: number;
  rosterPlayerGames: number;
  emptyEligibleNights: number;
}

export interface CandidateMetrics {
  totalGames: number;
  usefulStarts: number;
  forcedBenchNights: number;
  utilization: number;
  complementarity: number;
  avgOpenEligibleSlots: number;
  nights: NightOutcome[];
  byWeek: WeekMetrics[];
}
