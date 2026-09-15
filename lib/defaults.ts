import type { AppState, LeagueProfile, SlotConfig } from "./types";

export const DEFAULT_SLOTS: SlotConfig = {
  C: 2,
  LW: 2,
  RW: 2,
  D: 4,
  G: 2,
  UTIL: 0,
  BN: 4,
};

export const STORAGE_KEY = "luistin.v1";

export function newProfileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createProfile(name: string, slots: SlotConfig = DEFAULT_SLOTS): LeagueProfile {
  return {
    id: newProfileId(),
    name,
    slots: { ...slots },
    weekStartsOn: 1,
    roster: [],
  };
}

export function defaultState(): AppState {
  const profile = createProfile("Kimppa");
  profile.id = "default";
  return {
    lang: "fi",
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

export function activeRosterLimit(slots: SlotConfig): number {
  return slots.C + slots.LW + slots.RW + slots.D + slots.G + slots.UTIL;
}

export function totalRosterLimit(slots: SlotConfig): number {
  return activeRosterLimit(slots) + slots.BN;
}
