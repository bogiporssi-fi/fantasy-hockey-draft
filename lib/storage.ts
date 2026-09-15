import { DEFAULT_SLOTS, defaultState, STORAGE_KEY } from "./defaults";
import type { AppState, LeagueProfile, SlotConfig } from "./types";

function mergeSlots(raw: Partial<SlotConfig> | undefined): SlotConfig {
  return { ...DEFAULT_SLOTS, ...(raw ?? {}) };
}

function revive(parsed: unknown): AppState {
  const fallback = defaultState();
  if (!parsed || typeof parsed !== "object") return fallback;
  const o = parsed as Partial<AppState>;
  const profilesIn = Array.isArray(o.profiles) ? o.profiles : [];
  const profiles: LeagueProfile[] = profilesIn
    .filter((p) => p && typeof p === "object" && typeof (p as LeagueProfile).id === "string")
    .map((p) => {
      const row = p as LeagueProfile;
      return {
        id: row.id,
        name: row.name || "Kimppa",
        slots: mergeSlots(row.slots),
        weekStartsOn: row.weekStartsOn === 0 ? 0 : 1,
        roster: Array.isArray(row.roster)
          ? row.roster
              .filter((r) => r && typeof r.id === "number")
              .map((r) => ({
                id: r.id,
                positions: Array.isArray(r.positions) && r.positions.length ? r.positions : ["C"],
              }))
          : [],
      };
    });
  if (profiles.length === 0) return fallback;
  const activeProfileId = profiles.some((p) => p.id === o.activeProfileId)
    ? (o.activeProfileId as string)
    : profiles[0].id;
  return {
    lang: o.lang === "en" ? "en" : "fi",
    activeProfileId,
    profiles,
  };
}

export function loadState(): AppState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return revive(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

type Listener = () => void;
const listeners = new Set<Listener>();
let clientCache: AppState | null = null;
const SERVER_SNAPSHOT = defaultState();

export function subscribeState(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStateSnapshot(): AppState {
  if (!clientCache) clientCache = loadState();
  return clientCache;
}

export function getServerStateSnapshot(): AppState {
  return SERVER_SNAPSHOT;
}

export function setAppState(next: AppState) {
  clientCache = next;
  saveState(next);
  listeners.forEach((listener) => listener());
}
