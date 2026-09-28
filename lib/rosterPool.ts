import { isListedInjury } from "./injury";
import { nhlToFantasyPosition, normalizeName } from "./names";
import type { NhlPlayer, PlayerInjury } from "./types";

/** One skater or goalie from an NHL roster payload, before fantasy shaping. */
export interface RosterSourcePlayer {
  id: number;
  firstName: string;
  lastName: string;
  positionCode: string;
  headshot: string | null;
  sweaterNumber: number | null;
  team: string;
  teamName: string;
}

/** Yahoo row used to badge injuries and to pull IR players missing from the active roster. */
export interface InjuryIndexEntry {
  name: string;
  /** NHL team abbreviation (LAK, not Yahoo's LA). */
  team: string;
  injury: PlayerInjury;
}

function toNhlPlayer(
  src: RosterSourcePlayer,
  injury: PlayerInjury | null,
  team = src.team,
  teamName = src.teamName,
): NhlPlayer {
  const firstName = src.firstName.trim();
  const lastName = src.lastName.trim();
  return {
    id: src.id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    team,
    teamName,
    position: nhlToFantasyPosition(src.positionCode || "C"),
    headshot: src.headshot,
    sweaterNumber: src.sweaterNumber,
    injury,
  };
}

function indexInjuries(injuries: InjuryIndexEntry[]): Map<string, InjuryIndexEntry[]> {
  const map = new Map<string, InjuryIndexEntry[]>();
  for (const row of injuries) {
    if (!isListedInjury(row.injury.code)) continue;
    const key = normalizeName(row.name);
    if (!key || !row.team) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

function injuryOnTeam(
  index: Map<string, InjuryIndexEntry[]>,
  name: string,
  team: string,
): PlayerInjury | null {
  const hits = index.get(normalizeName(name)) ?? [];
  return hits.find((hit) => hit.team === team)?.injury ?? null;
}

/**
 * Player is on last season's roster but not the active one.
 * Prefer a Yahoo row on that same team. A unique name may have moved; use Yahoo's team.
 */
function gapPlacement(
  index: Map<string, InjuryIndexEntry[]>,
  name: string,
  previousTeam: string,
): { injury: PlayerInjury; team: string } | null {
  const hits = index.get(normalizeName(name)) ?? [];
  const onTeam = hits.find((hit) => hit.team === previousTeam);
  if (onTeam) return { injury: onTeam.injury, team: onTeam.team };
  if (hits.length === 1) return { injury: hits[0].injury, team: hits[0].team };
  return null;
}

/**
 * Active NHL roster, plus injured players Yahoo still lists who are absent from it
 * (they show up on the previous-season roster instead). Prospects without an IR/DTD/Out
 * status stay out.
 */
export function buildPlayerPool(input: {
  current: RosterSourcePlayer[];
  previous: RosterSourcePlayer[];
  injuries: InjuryIndexEntry[];
  teamNames?: ReadonlyMap<string, string>;
}): NhlPlayer[] {
  const index = indexInjuries(input.injuries);
  const teamNames = input.teamNames ?? new Map<string, string>();
  const seen = new Set<number>();
  const players: NhlPlayer[] = [];

  for (const src of input.current) {
    if (!src.id || seen.has(src.id)) continue;
    seen.add(src.id);
    players.push(toNhlPlayer(src, injuryOnTeam(index, `${src.firstName} ${src.lastName}`, src.team)));
  }

  for (const src of input.previous) {
    if (!src.id || seen.has(src.id)) continue;
    const placed = gapPlacement(index, `${src.firstName} ${src.lastName}`, src.team);
    if (!placed) continue;
    seen.add(src.id);
    const teamName =
      placed.team === src.team ? src.teamName : (teamNames.get(placed.team) ?? placed.team);
    players.push(toNhlPlayer(src, placed.injury, placed.team, teamName));
  }

  players.sort(
    (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
  );
  return players;
}
