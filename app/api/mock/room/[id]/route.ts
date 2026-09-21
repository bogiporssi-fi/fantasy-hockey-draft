import {
  advanceBots,
  applyHumanPick,
  claimSeat,
  isParticipantId,
  normalizeRoomId,
  startRoom,
  type RoomErrorCode,
} from "@/lib/mockRoom";
import { getRoomStorageKind, mutateRoom, readRoom, RoomStorageError } from "@/lib/mockRoomStore";
import { loadYahooPlayers } from "@/lib/yahooPlayers";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const runtime = "nodejs";

function noStore(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function statusFor(error: RoomErrorCode): number {
  switch (error) {
    case "not_found":
    case "invalid_room":
      return 404;
    case "busy":
      return 409;
    case "storage_unavailable":
      return 503;
    case "seat_taken":
    case "not_lobby":
    case "not_host":
    case "already_started":
    case "not_your_turn":
    case "player_gone":
    case "no_slot":
      return 409;
    default:
      return 400;
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = normalizeRoomId(raw);
  if (!id) return noStore({ error: "invalid_room" }, 404);

  try {
    const existing = await readRoom(id);
    if (!existing) return noStore({ error: "not_found" }, 404);

    if (existing.status !== "drafting") {
      return noStore({ room: existing, storage: getRoomStorageKind() });
    }

    let pool;
    try {
      pool = await loadYahooPlayers();
    } catch {
      return noStore({ room: existing, storage: getRoomStorageKind() });
    }

    const result = await mutateRoom(id, (room) => {
      const next = advanceBots(room, pool.players);
      return { ok: true, room: next };
    });
    if (!result.ok) return noStore({ error: result.error }, result.status);
    return noStore({ room: result.room, storage: getRoomStorageKind() });
  } catch (err) {
    const code = err instanceof RoomStorageError ? err.code : "storage_unavailable";
    return noStore({ error: code }, 503);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = normalizeRoomId(raw);
  if (!id) return noStore({ error: "invalid_room" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "invalid_participant" }, 400);
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const action = String(rec.action ?? "");
  const participantId = rec.participantId;
  if (!isParticipantId(participantId)) return noStore({ error: "invalid_participant" }, 400);

  try {
    return await handleRoomAction(id, action, rec, participantId);
  } catch (err) {
    const code = err instanceof RoomStorageError ? err.code : "storage_unavailable";
    return noStore({ error: code }, 503);
  }
}

async function handleRoomAction(
  id: string,
  action: string,
  rec: Record<string, unknown>,
  participantId: string,
) {
  if (action === "join") {
    const slot = typeof rec.slot === "number" ? rec.slot : Number.parseInt(String(rec.slot ?? ""), 10);
    const result = await mutateRoom(id, (room) => {
      const next = claimSeat(room, participantId, slot);
      if (!next.ok) return { ok: false, error: next.error, status: statusFor(next.error) };
      return { ok: true, room: next.value };
    });
    if (!result.ok) return noStore({ error: result.error }, result.status);
    return noStore({ room: result.room, storage: getRoomStorageKind() });
  }

  if (action === "start") {
    let pool;
    try {
      pool = await loadYahooPlayers();
    } catch {
      return noStore({ error: "not_found" }, 502);
    }
    const result = await mutateRoom(id, (room) => {
      const started = startRoom(room, participantId);
      if (!started.ok) return { ok: false, error: started.error, status: statusFor(started.error) };
      return { ok: true, room: advanceBots(started.value, pool.players) };
    });
    if (!result.ok) return noStore({ error: result.error }, result.status);
    return noStore({ room: result.room, storage: getRoomStorageKind() });
  }

  if (action === "pick") {
    const playerId = String(rec.playerId ?? "").trim();
    if (!playerId) return noStore({ error: "player_gone" }, 400);
    let pool;
    try {
      pool = await loadYahooPlayers();
    } catch {
      return noStore({ error: "player_gone" }, 502);
    }
    const player = pool.players.find((p) => p.id === playerId);
    if (!player) return noStore({ error: "player_gone" }, 409);
    const result = await mutateRoom(id, (room) => {
      const picked = applyHumanPick(room, participantId, player);
      if (!picked.ok) return { ok: false, error: picked.error, status: statusFor(picked.error) };
      return { ok: true, room: advanceBots(picked.value, pool.players) };
    });
    if (!result.ok) return noStore({ error: result.error }, result.status);
    return noStore({ room: result.room, storage: getRoomStorageKind() });
  }

  return noStore({ error: "invalid_participant" }, 400);
}
