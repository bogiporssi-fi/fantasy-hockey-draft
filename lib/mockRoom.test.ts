import { describe, expect, it } from "vitest";
import type { FantasyPosition } from "./types";
import {
  MOCK_TEAM_COUNT,
  MOCK_TOTAL_PICKS,
  MOCK_ROUNDS,
  assignSlot,
  remainingSlots,
  rostersFromPicks,
  type MockPlayer,
} from "./mockDraft";
import {
  advanceBots,
  applyHumanPick,
  claimSeat,
  createLobby,
  freeSeatCount,
  generateRoomId,
  normalizeRoomId,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  seatForParticipant,
  startRoom,
} from "./mockRoom";

const HOST = "host-participant-01";
const GUEST = "guest-participant-02";
const GUEST_B = "guest-participant-03";

function player(
  id: string,
  name: string,
  positions: FantasyPosition[],
  adp: number,
  yahooRank: number | null = adp,
): MockPlayer {
  const [first, ...rest] = name.split(" ");
  return {
    id,
    name,
    firstName: first ?? name,
    lastName: rest.join(" ") || name,
    team: "EDM",
    displayPosition: positions.join(","),
    positions,
    adp,
    yahooRank,
  };
}

function lobby(hostSlot = 7) {
  const created = createLobby("ABC234", HOST, hostSlot);
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

function pool(n = 450): MockPlayer[] {
  const positions: FantasyPosition[][] = [
    ["C"],
    ["C"],
    ["LW"],
    ["RW"],
    ["D"],
    ["D"],
    ["D"],
    ["G"],
    ["C", "LW"],
    ["LW", "RW"],
  ];
  return Array.from({ length: n }, (_, i) =>
    player(`p${i}`, `Player ${i}`, positions[i % positions.length], i + 1),
  );
}

describe("room ids", () => {
  it("generates 6-char codes from the alphabet", () => {
    const id = generateRoomId(() => new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(id).toHaveLength(ROOM_ID_LENGTH);
    for (const ch of id) expect(ROOM_ID_ALPHABET).toContain(ch);
  });

  it("normalizes case and rejects junk", () => {
    expect(normalizeRoomId("abc234")).toBe("ABC234");
    expect(normalizeRoomId(" ABC234 ")).toBe("ABC234");
    expect(normalizeRoomId("ABC12")).toBeNull();
    expect(normalizeRoomId("ABC10I")).toBeNull();
  });
});

describe("seat claim", () => {
  it("lets the host occupy their slot and guests claim empty seats", () => {
    const room = lobby(7);
    expect(room.seats).toHaveLength(MOCK_TEAM_COUNT);
    expect(seatForParticipant(room, HOST)?.teamIndex).toBe(6);
    expect(freeSeatCount(room)).toBe(19);

    const joined = claimSeat(room, GUEST, 1);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.seats[0]).toMatchObject({ kind: "human", participantId: GUEST });
    expect(joined.value.seats[6]).toMatchObject({ kind: "human", participantId: HOST });
    expect(freeSeatCount(joined.value)).toBe(18);
  });

  it("rejects a taken seat, a bad slot, and claims after start", () => {
    const room = lobby(1);
    const taken = claimSeat(room, GUEST, 1);
    expect(taken).toEqual({ ok: false, error: "seat_taken" });
    expect(claimSeat(room, GUEST, 0)).toEqual({ ok: false, error: "invalid_slot" });
    expect(claimSeat(room, GUEST, 21)).toEqual({ ok: false, error: "invalid_slot" });
    expect(claimSeat(room, "x", 2)).toEqual({ ok: false, error: "invalid_participant" });

    const guest = claimSeat(room, GUEST, 2);
    expect(guest.ok).toBe(true);
    if (!guest.ok) return;
    const started = startRoom(guest.value, HOST);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.seats.filter((s) => s.kind === "bot")).toHaveLength(18);
    expect(started.value.seats[0].kind).toBe("human");
    expect(started.value.seats[1].kind).toBe("human");
    expect(claimSeat(started.value, GUEST_B, 3)).toEqual({ ok: false, error: "not_lobby" });
  });

  it("lets a guest move to another empty seat in the lobby", () => {
    const room = lobby(7);
    const first = claimSeat(room, GUEST, 2);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const moved = claimSeat(first.value, GUEST, 20);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.seats[1].kind).toBe("empty");
    expect(moved.value.seats[19]).toMatchObject({ kind: "human", participantId: GUEST });
    expect(seatForParticipant(moved.value, GUEST)?.teamIndex).toBe(19);
  });

  it("only the host can start", () => {
    const room = lobby(3);
    expect(startRoom(room, GUEST)).toEqual({ ok: false, error: "not_host" });
    const started = startRoom(room, HOST);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(startRoom(started.value, HOST)).toEqual({ ok: false, error: "already_started" });
  });
});

describe("shared snake picks", () => {
  it("rejects a pick that is not this human's turn", () => {
    const room = lobby(2);
    const withGuest = claimSeat(room, GUEST, 1);
    expect(withGuest.ok).toBe(true);
    if (!withGuest.ok) return;
    const started = startRoom(withGuest.value, HOST);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const pick = applyHumanPick(started.value, HOST, pool()[0]);
    expect(pick).toEqual({ ok: false, error: "not_your_turn" });
  });

  it("advances bots until the next human and then accepts their pick", () => {
    let room = lobby(7);
    const joined = claimSeat(room, GUEST, 1);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const started = startRoom(joined.value, HOST);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const players = pool();
    room = advanceBots(started.value, players, () => 0);
    expect(room.picks).toHaveLength(0);
    const first = applyHumanPick(room, GUEST, players[10]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    room = advanceBots(first.value, players, () => 0);
    expect(room.picks.length).toBe(6);
    expect(room.picks[0].by).toBe("human");
    expect(room.picks[0].teamIndex).toBe(0);
    expect(room.picks.slice(1).every((p) => p.by === "bot")).toBe(true);
    const hostPick = applyHumanPick(room, HOST, players[20]);
    expect(hostPick.ok).toBe(true);
    if (!hostPick.ok) return;
    expect(hostPick.value.picks.at(-1)?.teamIndex).toBe(6);
    expect(hostPick.value.picks.at(-1)?.by).toBe("human");
  });

  it("fills a full snake when the only human keeps picking and bots fill the rest", () => {
    const started = startRoom(lobby(1), HOST);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const players = pool();
    let room = started.value;
    for (let i = 0; i < MOCK_ROUNDS; i++) {
      const remaining = players.filter((p) => !room.picks.some((x) => x.player.id === p.id));
      const rem = remainingSlots(rostersFromPicks(room.picks)[0].filled);
      const choice = remaining.find((p) => assignSlot(p.positions, rem) !== null) ?? remaining[0];
      const human = applyHumanPick(room, HOST, choice);
      expect(human.ok).toBe(true);
      if (!human.ok) return;
      room = advanceBots(human.value, players, () => 0);
    }
    expect(room.status).toBe("done");
    expect(room.picks).toHaveLength(MOCK_TOTAL_PICKS);
    expect(room.picks.filter((p) => p.by === "human")).toHaveLength(MOCK_ROUNDS);
  });
});
