"use client";

import { CandidatePanel } from "@/components/CandidatePanel";
import { PasteModal } from "@/components/PasteModal";
import { RosterPanel } from "@/components/RosterPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { totalRosterLimit } from "@/lib/defaults";
import { t } from "@/lib/i18n";
import { evaluateCandidate } from "@/lib/overlap";
import {
  getServerStateSnapshot,
  getStateSnapshot,
  setAppState,
  subscribeState,
} from "@/lib/storage";
import type {
  AppState,
  FantasyPosition,
  Lang,
  NhlPayload,
  NhlPlayer,
  RosterPlayer,
} from "@/lib/types";
import { buildWeeks } from "@/lib/weeks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export function DraftApp() {
  const state = useSyncExternalStore(subscribeState, getStateSnapshot, getServerStateSnapshot);
  const [data, setData] = useState<NhlPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingNhl, setLoadingNhl] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [compareOn, setCompareOn] = useState(false);
  const [candidateA, setCandidateA] = useState<NhlPlayer | null>(null);
  const [candidateB, setCandidateB] = useState<NhlPlayer | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function loadNhl() {
    setLoadingNhl(true);
    fetch("/api/nhl/data")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "NHL error");
        setData(json as NhlPayload);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "error");
      })
      .finally(() => setLoadingNhl(false));
  }

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/nhl/data", { signal: ac.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "NHL error");
        setData(json as NhlPayload);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : "error");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoadingNhl(false);
      });
    return () => ac.abort();
  }, []);

  const lang: Lang = state.lang;
  const c = t(lang);
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];

  const weeks = useMemo(() => {
    if (!data || !profile) return [];
    return buildWeeks(data.regularSeasonStart, data.regularSeasonEnd, profile.weekStartsOn);
  }, [data, profile]);

  const playerById = useMemo(() => {
    return new Map(data?.players.map((p) => [p.id, p]) ?? []);
  }, [data]);

  function gamesOf(player: NhlPlayer | RosterPlayer | null | undefined) {
    if (!data || !player) return [];
    const nhl = "team" in player ? player : playerById.get(player.id);
    if (!nhl) return [];
    return data.teamGames[nhl.team] ?? [];
  }

  const rosterEligible = useMemo(() => {
    if (!profile) return [];
    return profile.roster.map((r) => ({
      id: String(r.id),
      positions: r.positions,
    }));
  }, [profile]);

  const rosterGames = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!profile || !data) return map;
    for (const r of profile.roster) {
      const dates = new Set(gamesOf(r).map((g) => g.date));
      map.set(String(r.id), dates);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gamesOf uses data/playerById
  }, [profile, data, playerById]);

  const metricsA = useMemo(() => {
    if (!profile || !candidateA) return null;
    const id = String(candidateA.id);
    return evaluateCandidate({
      slots: profile.slots,
      roster: rosterEligible.filter((p) => p.id !== id),
      rosterGames,
      candidate: { id, positions: [candidateA.position] },
      candidateGames: gamesOf(candidateA),
      weeks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, candidateA, rosterEligible, rosterGames, weeks, data]);

  const metricsB = useMemo(() => {
    if (!profile || !candidateB) return null;
    const id = String(candidateB.id);
    return evaluateCandidate({
      slots: profile.slots,
      roster: rosterEligible.filter((p) => p.id !== id),
      rosterGames,
      candidate: { id, positions: [candidateB.position] },
      candidateGames: gamesOf(candidateB),
      weeks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, candidateB, rosterEligible, rosterGames, weeks, data]);

  function updateState(next: AppState) {
    setAppState(next);
  }

  function patchProfile(roster: RosterPlayer[]) {
    if (!state || !profile) return;
    updateState({
      ...state,
      profiles: state.profiles.map((p) => (p.id === profile.id ? { ...p, roster } : p)),
    });
  }

  function addPlayer(player: NhlPlayer) {
    if (!profile) return;
    if (profile.roster.some((r) => r.id === player.id)) return;
    const cap = totalRosterLimit(profile.slots);
    if (profile.roster.length >= cap) {
      setFlash(c.rosterFull);
      return;
    }
    patchProfile([...profile.roster, { id: player.id, positions: [player.position] }]);
  }

  function removePlayer(id: number) {
    if (!profile) return;
    patchProfile(profile.roster.filter((r) => r.id !== id));
  }

  function togglePos(id: number, pos: FantasyPosition) {
    if (!profile) return;
    patchProfile(
      profile.roster.map((r) => {
        if (r.id !== id) return r;
        const has = r.positions.includes(pos);
        let positions = has ? r.positions.filter((p) => p !== pos) : [...r.positions, pos];
        if (positions.length === 0) positions = [pos];
        return { ...r, positions };
      }),
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">{c.loading}</div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-3 py-4 sm:px-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">{c.appTitle}</h1>
            <p className="text-xs text-muted">
              {c.appTagline}
              {data ? ` · NHL ${data.seasonLabel}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-line bg-[#08141d] px-2 py-1.5 text-sm"
            value={profile.id}
            onChange={(e) => updateState({ ...state, activeProfileId: e.target.value })}
          >
            {state.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5"
          >
            {c.settings}
          </button>
          <div className="flex rounded-lg border border-line text-xs">
            {(["fi", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => updateState({ ...state, lang: code })}
                className={`px-2 py-1.5 uppercase ${state.lang === code ? "bg-ice/20 text-ice" : "text-muted"}`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      {data && (
        <p className="mb-3 text-[11px] text-muted">
          {data.teams.length} {c.teams} · {data.players.length} {c.players} · {c.updated}{" "}
          {new Date(data.fetchedAt).toLocaleString(lang === "fi" ? "fi-FI" : "en-CA")}
          {data.missingTeams.length > 0 ? ` · ${data.missingTeams.join(", ")}` : ""}
        </p>
      )}
      {flash && (
        <p className="mb-3 text-sm text-warn">
          {flash}{" "}
          <button type="button" className="underline" onClick={() => setFlash(null)}>
            {c.close}
          </button>
        </p>
      )}

      {!data && !loadError && loadingNhl && (
        <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-muted">
          {c.loading}
        </p>
      )}
      {loadError && (
        <div className="rounded-xl border border-bad/40 bg-panel px-4 py-8 text-center">
          <p className="text-sm text-bad">{c.loadError}</p>
          <p className="mt-1 text-xs text-muted">{loadError}</p>
          <button
            type="button"
            onClick={() => loadNhl()}
            className="mt-3 rounded-md bg-ice px-3 py-1.5 text-sm text-rink"
          >
            {c.retry}
          </button>
        </div>
      )}

      {data && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
          <RosterPanel
            lang={lang}
            data={data}
            profile={profile}
            onAdd={addPlayer}
            onRemove={removePlayer}
            onTogglePos={togglePos}
            onPaste={() => setPasteOpen(true)}
            onClear={() => {
              if (confirm(c.confirmClear)) patchProfile([]);
            }}
          />
          <CandidatePanel
            lang={lang}
            players={data.players}
            candidateA={candidateA}
            candidateB={candidateB}
            metricsA={metricsA}
            metricsB={metricsB}
            weeks={weeks}
            weekStartsOn={profile.weekStartsOn}
            compareOn={compareOn}
            onToggleCompare={() => setCompareOn((v) => !v)}
            onPickA={setCandidateA}
            onPickB={setCandidateB}
            onAddToRoster={addPlayer}
            gamesA={gamesOf(candidateA)}
            gamesB={gamesOf(candidateB)}
          />
        </div>
      )}

      <footer className="mt-6 space-y-1 text-[11px] leading-relaxed text-muted">
        <p>{c.dataSource}</p>
        <p>{c.savedLocal}</p>
      </footer>

      {settingsOpen && (
        <SettingsModal
          lang={lang}
          state={state}
          onClose={() => setSettingsOpen(false)}
          onChange={updateState}
        />
      )}
      {pasteOpen && data && (
        <PasteModal
          lang={lang}
          players={data.players}
          existingIds={new Set(profile.roster.map((r) => r.id))}
          onClose={() => setPasteOpen(false)}
          onImport={(matched) => {
            const cap = totalRosterLimit(profile.slots);
            const room = Math.max(0, cap - profile.roster.length);
            const take = matched.slice(0, room);
            patchProfile([
              ...profile.roster,
              ...take.map((p) => ({ id: p.id, positions: [p.position] as FantasyPosition[] })),
            ]);
            setPasteOpen(false);
            setFlash(
              take.length ? c.imported.replace("{n}", String(take.length)) : c.noneImported,
            );
          }}
        />
      )}
    </div>
  );
}

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="34" height="34" rx="10" fill="#0c1a24" stroke="#2a6f6a" />
      <path
        d="M8 22c6-1 10-8 14-8 2 0 3 1 6 1"
        fill="none"
        stroke="#8ef0e6"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M10 24h12" stroke="#8ef0e6" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="14" r="2" fill="#8ef0e6" />
    </svg>
  );
}
