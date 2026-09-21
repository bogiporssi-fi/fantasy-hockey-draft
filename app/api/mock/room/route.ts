import { createLobby, generateRoomId, isParticipantId } from "@/lib/mockRoom";
import { createRoomIfAbsent, getRoomStorageKind, RoomStorageError } from "@/lib/mockRoomStore";
import { MOCK_TEAM_COUNT } from "@/lib/mockDraft";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;
export const runtime = "nodejs";

function noStore(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "invalid_participant" }, 400);
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const participantId = rec.participantId;
  const slot = typeof rec.slot === "number" ? rec.slot : Number.parseInt(String(rec.slot ?? ""), 10);
  if (!isParticipantId(participantId)) return noStore({ error: "invalid_participant" }, 400);
  if (!Number.isInteger(slot) || slot < 1 || slot > MOCK_TEAM_COUNT) {
    return noStore({ error: "invalid_slot" }, 400);
  }

  try {
    for (let i = 0; i < 8; i++) {
      const id = generateRoomId();
      const created = createLobby(id, participantId, slot);
      if (!created.ok) return noStore({ error: created.error }, 400);
      const ok = await createRoomIfAbsent(created.value);
      if (ok) {
        return noStore({ room: created.value, storage: getRoomStorageKind() }, 201);
      }
    }
    return noStore({ error: "busy" }, 503);
  } catch (err) {
    const code = err instanceof RoomStorageError ? err.code : "storage_unavailable";
    return noStore({ error: code }, 503);
  }
}
