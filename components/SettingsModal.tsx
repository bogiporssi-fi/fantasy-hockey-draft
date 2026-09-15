"use client";

import { createProfile, totalRosterLimit } from "@/lib/defaults";
import { t } from "@/lib/i18n";
import { FANTASY_POSITIONS } from "@/lib/types";
import type { AppState, Lang, LeagueProfile, SlotConfig } from "@/lib/types";

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
      <span className="font-mono text-sm text-ice">{label}</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          className="h-7 w-7 rounded border border-line text-white hover:bg-white/5"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </button>
        <span className="w-6 text-center tabular">{value}</span>
        <button
          type="button"
          className="h-7 w-7 rounded border border-line text-white hover:bg-white/5"
          onClick={() => onChange(Math.min(8, value + 1))}
        >
          +
        </button>
      </span>
    </label>
  );
}

export function SettingsModal({
  lang,
  state,
  onClose,
  onChange,
}: {
  lang: Lang;
  state: AppState;
  onClose: () => void;
  onChange: (next: AppState) => void;
}) {
  const c = t(lang);
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];

  function updateProfile(patch: Partial<LeagueProfile>) {
    onChange({
      ...state,
      profiles: state.profiles.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)),
    });
  }

  function updateSlot(key: keyof SlotConfig, value: number) {
    updateProfile({ slots: { ...profile.slots, [key]: value } });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-line bg-[#0b1822] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{c.settings}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-white">
            {c.close}
          </button>
        </div>

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted">{c.profile}</span>
            <select
              className="mt-1 w-full rounded-lg border border-line bg-[#08141d] px-3 py-2"
              value={profile.id}
              onChange={(e) => onChange({ ...state, activeProfileId: e.target.value })}
            >
              {state.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-muted">{c.profileName}</span>
            <input
              className="mt-1 w-full rounded-lg border border-line bg-[#08141d] px-3 py-2"
              value={profile.name}
              onChange={(e) => updateProfile({ name: e.target.value })}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ice"
              onClick={() => {
                const p = createProfile(
                  lang === "fi" ? `Kimppa ${state.profiles.length + 1}` : `League ${state.profiles.length + 1}`,
                );
                onChange({
                  ...state,
                  profiles: [...state.profiles, p],
                  activeProfileId: p.id,
                });
              }}
            >
              {c.newProfile}
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-3 py-1.5 text-xs"
              onClick={() => {
                const p = createProfile(`${profile.name} copy`, profile.slots);
                p.weekStartsOn = profile.weekStartsOn;
                p.roster = profile.roster.map((r) => ({ ...r, positions: [...r.positions] }));
                onChange({
                  ...state,
                  profiles: [...state.profiles, p],
                  activeProfileId: p.id,
                });
              }}
            >
              {c.duplicate}
            </button>
            {state.profiles.length > 1 && (
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs text-bad"
                onClick={() => {
                  if (!confirm(c.confirmDelete)) return;
                  const rest = state.profiles.filter((p) => p.id !== profile.id);
                  onChange({ ...state, profiles: rest, activeProfileId: rest[0].id });
                }}
              >
                {c.deleteProfile}
              </button>
            )}
          </div>

          <p className="text-xs text-muted">{c.slotHelp}</p>
          <div className="grid grid-cols-2 gap-2">
            {FANTASY_POSITIONS.map((pos) => (
              <Stepper
                key={pos}
                label={pos}
                value={profile.slots[pos]}
                onChange={(n) => updateSlot(pos, n)}
              />
            ))}
            <Stepper
              label={c.util}
              value={profile.slots.UTIL}
              onChange={(n) => updateSlot("UTIL", n)}
            />
            <Stepper
              label={c.bench}
              value={profile.slots.BN}
              onChange={(n) => updateSlot("BN", n)}
            />
          </div>
          <p className="text-xs text-muted">
            {c.active} {totalRosterLimit(profile.slots) - profile.slots.BN} + {c.bench}{" "}
            {profile.slots.BN} = {totalRosterLimit(profile.slots)}
          </p>

          <label className="block text-sm">
            <span className="text-muted">{c.weekStartsOn}</span>
            <select
              className="mt-1 w-full rounded-lg border border-line bg-[#08141d] px-3 py-2"
              value={profile.weekStartsOn}
              onChange={(e) =>
                updateProfile({ weekStartsOn: Number(e.target.value) as 0 | 1 })
              }
            >
              <option value={1}>{c.monday}</option>
              <option value={0}>{c.sunday}</option>
            </select>
          </label>

          <p className="text-xs leading-relaxed text-muted">{c.savedLocal}</p>
        </div>
      </div>
    </div>
  );
}
