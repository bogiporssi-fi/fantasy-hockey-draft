import {
  applyPick,
  chooseBotPick,
  createEmptyRosters,
  MOCK_TEAM_COUNT,
  MOCK_TOTAL_PICKS,
  remainingFromPicks,
  remainingSlots,
  rostersFromPicks,
  snakeTeamIndex,
  type MockDraftPickRecord,
  type MockPlayer,
} from "./mockDraft";

export const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_ID_LENGTH = 6;

export type SeatKind = "empty" | "human" | "bot";
export type RoomStatus = "lobby" | "drafting" | "done";
export type RoomStorageKind = "redis" | "memory";

export interface RoomSeat {
  teamIndex: number;
  kind: SeatKind;
  participantId: string | null;
}

export interface RoomState {
  id: string;
  createdAt: string;
  hostParticipantId: string;
  status: RoomStatus;
  seats: RoomSeat[];
  picks: MockDraftPickRecord[];
  version: number;
  updatedAt: string;
}

export type RoomErrorCode =
  | "not_found"
  | "invalid_slot"
  | "invalid_participant"
  | "invalid_room"
  | "seat_taken"
  | "not_lobby"
  | "not_host"
  | "already_started"
  | "not_your_turn"
  | "player_gone"
  | "no_slot"
  | "busy";

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomErrorCode };

export function generateRoomId(
  randomBytes: () => Uint8Array = () => {
    const buf = new Uint8Array(ROOM_ID_LENGTH);
    crypto.getRandomValues(buf);
    return buf;
  },
): string {
  const buf = randomBytes();
  let out = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    out += ROOM_ID_ALPHABET[buf[i % buf.length] % ROOM_ID_ALPHABET.length];
  }
  return out;
}

export function normalizeRoomId(raw: string): string | null {
  const id = raw.trim().toUpperCase();
  if (id.length !== ROOM_ID_LENGTH) return null;
  for (const ch of id) {
    if (!ROOM_ID_ALPHABET.includes(ch)) return null;
  }
  return id;
}

export function isParticipantId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 80;
}

function fail(error: RoomErrorCode): RoomResult<never> {
  return { ok: false, error };
}

function emptySeats(teamCount: number = MOCK_TEAM_COUNT): RoomSeat[] {
  return Array.from({ length: teamCount }, (_, teamIndex) => ({
    teamIndex,
    kind: "empty" as const,
    participantId: null,
  }));
}

export function createLobby(
  id: string,
  hostParticipantId: string,
  hostSlot: number,
  now: string = new Date().toISOString(),
  teamCount: number = MOCK_TEAM_COUNT,
): RoomResult<RoomState> {
  if (!isParticipantId(hostParticipantId)) return fail("invalid_participant");
  if (!Number.isInteger(hostSlot) || hostSlot < 1 || hostSlot > teamCount) return fail("invalid_slot");
  const seats = emptySeats(teamCount);
  seats[hostSlot - 1] = {
    teamIndex: hostSlot - 1,
    kind: "human",
    participantId: hostParticipantId.trim(),
  };
  return {
    ok: true,
    value: {
      id,
      createdAt: now,
      hostParticipantId: hostParticipantId.trim(),
      status: "lobby",
      seats,
      picks: [],
      version: 1,
      updatedAt: now,
    },
  };
}

export function freeSeatCount(room: RoomState): number {
  return room.seats.filter((s) => s.kind === "empty").length;
}

export function seatForParticipant(room: RoomState, participantId: string): RoomSeat | null {
  return room.seats.find((s) => s.participantId === participantId) ?? null;
}

export function claimSeat(
  room: RoomState,
  participantId: string,
  slot: number,
): RoomResult<RoomState> {
  if (!isParticipantId(participantId)) return fail("invalid_participant");
  if (room.status !== "lobby") return fail("not_lobby");
  if (!Number.isInteger(slot) || slot < 1 || slot > room.seats.length) return fail("invalid_slot");
  const pid = participantId.trim();
  const teamIndex = slot - 1;
  const target = room.seats[teamIndex];
  if (target.kind === "human" && target.participantId && target.participantId !== pid) {
    return fail("seat_taken");
  }
  const seats = room.seats.map((s) => {
    if (s.participantId === pid && s.teamIndex !== teamIndex) {
      return { ...s, kind: "empty" as const, participantId: null };
    }
    return s;
  });
  seats[teamIndex] = { teamIndex, kind: "human", participantId: pid };
  return { ok: true, value: { ...room, seats } };
}

export function startRoom(room: RoomState, participantId: string): RoomResult<RoomState> {
  if (!isParticipantId(participantId)) return fail("invalid_participant");
  if (room.status !== "lobby") return fail("already_started");
  if (room.hostParticipantId !== participantId.trim()) return fail("not_host");
  const seats = room.seats.map((s) =>
    s.kind === "empty" ? { ...s, kind: "bot" as const, participantId: null } : s,
  );
  return { ok: true, value: { ...room, status: "drafting", seats } };
}

function appendPick(
  room: RoomState,
  player: MockPlayer,
  by: "human" | "bot",
): RoomResult<RoomState> {
  if (room.status !== "drafting") return fail("already_started");
  if (room.picks.length >= MOCK_TOTAL_PICKS) return fail("not_your_turn");
  if (room.picks.some((p) => p.player.id === player.id)) return fail("player_gone");
  const pickIndex = room.picks.length;
  const teamIndex = snakeTeamIndex(pickIndex, room.seats.length);
  const rosters =
    room.picks.length === 0 ? createEmptyRosters(room.seats.length) : rostersFromPicks(room.picks, room.seats.length);
  const nextRoster = applyPick(rosters[teamIndex], player, pickIndex);
  if (!nextRoster) return fail("no_slot");
  const record: MockDraftPickRecord = {
    pickIndex,
    teamIndex,
    player,
    slot: nextRoster.picks[nextRoster.picks.length - 1].slot,
    by,
  };
  const picks = [...room.picks, record];
  return {
    ok: true,
    value: {
      ...room,
      picks,
      status: picks.length >= MOCK_TOTAL_PICKS ? "done" : "drafting",
    },
  };
}

export function applyHumanPick(
  room: RoomState,
  participantId: string,
  player: MockPlayer,
): RoomResult<RoomState> {
  if (!isParticipantId(participantId)) return fail("invalid_participant");
  if (room.status !== "drafting") return fail("not_your_turn");
  if (room.picks.length >= MOCK_TOTAL_PICKS) return fail("not_your_turn");
  const teamIndex = snakeTeamIndex(room.picks.length, room.seats.length);
  const seat = room.seats[teamIndex];
  if (seat.kind !== "human" || seat.participantId !== participantId.trim()) {
    return fail("not_your_turn");
  }
  return appendPick(room, player, "human");
}

/** Fill bot seats until the next human is on the clock (or the draft ends). */
export function advanceBots(
  room: RoomState,
  pool: MockPlayer[],
  rng: () => number = Math.random,
): RoomState {
  if (room.status !== "drafting") return room;
  let current = room;
  while (current.status === "drafting" && current.picks.length < MOCK_TOTAL_PICKS) {
    const teamIndex = snakeTeamIndex(current.picks.length, current.seats.length);
    const seat = current.seats[teamIndex];
    if (seat.kind === "human") break;
    const remaining = remainingFromPicks(pool, current.picks);
    const rosters = rostersFromPicks(current.picks, current.seats.length);
    const player = chooseBotPick(remaining, remainingSlots(rosters[teamIndex].filled), rng);
    if (!player) break;
    const next = appendPick(current, player, "bot");
    if (!next.ok) break;
    current = next.value;
  }
  return current;
}
