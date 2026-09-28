import type { InjuryCode, PlayerInjury } from "./types";

/** Yahoo editorial abbreviations that differ from the NHL Web API. */
const YAHOO_TEAM_TO_NHL: Record<string, string> = {
  LA: "LAK",
  NJ: "NJD",
  SJ: "SJS",
  TB: "TBL",
};

const LISTED = new Set<InjuryCode>(["IR", "IR-LT", "IR-NR", "DTD", "O"]);

export type InjuryLabelKey = "injuryIR" | "injuryIRLT" | "injuryDTD" | "injuryOut";
export type InjuryHintKey = "injuryIRHint" | "injuryIRLTHint" | "injuryDTDHint" | "injuryOutHint";

const BADGE: Record<InjuryCode, { label: InjuryLabelKey; hint: InjuryHintKey } | null> = {
  IR: { label: "injuryIR", hint: "injuryIRHint" },
  "IR-NR": { label: "injuryIR", hint: "injuryIRHint" },
  "IR-LT": { label: "injuryIRLT", hint: "injuryIRLTHint" },
  DTD: { label: "injuryDTD", hint: "injuryDTDHint" },
  O: { label: "injuryOut", hint: "injuryOutHint" },
  NA: null,
};

export function yahooTeamToNhl(abbr: string): string {
  const team = abbr.trim().toUpperCase();
  return YAHOO_TEAM_TO_NHL[team] ?? team;
}

export function parseInjuryStatus(status: unknown, note: unknown): PlayerInjury | null {
  const code = String(status ?? "").trim().toUpperCase();
  if (!code || !Object.prototype.hasOwnProperty.call(BADGE, code)) return null;
  const text = typeof note === "string" ? note.trim() : "";
  return { code: code as InjuryCode, note: text || null };
}

/** IR / IR-LT / IR-NR / DTD / Out. NA (prospects, suspensions) is not a roster-gap injury. */
export function isListedInjury(code: InjuryCode | null | undefined): boolean {
  return code != null && LISTED.has(code);
}

/** Long-term reserve. Bots nudge these down; day-to-day and short-term Out stay on ADP. */
export function isLongTermIr(code: InjuryCode | null | undefined): boolean {
  return code === "IR" || code === "IR-LT" || code === "IR-NR";
}

export function injuryBadgeMeta(
  code: InjuryCode | null | undefined,
): { label: InjuryLabelKey; hint: InjuryHintKey } | null {
  if (!code) return null;
  return BADGE[code];
}
