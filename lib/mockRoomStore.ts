import { Redis } from "@upstash/redis";
import type { RoomState, RoomStorageKind } from "./mockRoom";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;
const KEY_PREFIX = "luistin:mock:";

function envUrl(): string {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
}

function envToken(): string {
  return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
}

export function getRoomStorageKind(): RoomStorageKind {
  return envUrl() && envToken() ? "redis" : "memory";
}

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = envUrl();
  const token = envToken();
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

type MemRow = { room: RoomState; expiresAt: number };
const memRooms = new Map<string, MemRow>();
const memLocks = new Map<string, Promise<void>>();

function memGet(id: string): RoomState | null {
  const row = memRooms.get(id);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    memRooms.delete(id);
    return null;
  }
  return row.room;
}

function memSet(room: RoomState) {
  memRooms.set(room.id, { room, expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 });
}

export async function readRoom(id: string): Promise<RoomState | null> {
  const redis = getRedis();
  if (redis) {
    const room = await redis.get<RoomState>(KEY_PREFIX + id);
    return room ?? null;
  }
  return memGet(id);
}

export async function createRoomIfAbsent(room: RoomState): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const got = await redis.set(KEY_PREFIX + room.id, room, { nx: true, ex: ROOM_TTL_SECONDS });
    return Boolean(got);
  }
  if (memGet(room.id)) return false;
  memSet(room);
  return true;
}

export type MutatorResult =
  | { ok: true; room: RoomState }
  | { ok: false; error: string; status: number };

async function acquireRedisLock(redis: Redis, lockKey: string, token: string): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const got = await redis.set(lockKey, token, { nx: true, ex: 8 });
    if (got) return true;
    await new Promise((r) => setTimeout(r, 25 * (i + 1)));
  }
  return false;
}

export async function mutateRoom(
  id: string,
  mutator: (room: RoomState) => MutatorResult,
): Promise<MutatorResult> {
  const redis = getRedis();
  if (redis) {
    const lockKey = `${KEY_PREFIX}${id}:lock`;
    const token = crypto.randomUUID();
    const locked = await acquireRedisLock(redis, lockKey, token);
    if (!locked) return { ok: false, error: "busy", status: 409 };
    try {
      const current = await redis.get<RoomState>(KEY_PREFIX + id);
      if (!current) return { ok: false, error: "not_found", status: 404 };
      const result = mutator(current);
      if (!result.ok) return result;
      if (result.room === current) return result;
      const stamped: RoomState = {
        ...result.room,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      await redis.set(KEY_PREFIX + id, stamped, { ex: ROOM_TTL_SECONDS });
      return { ok: true, room: stamped };
    } finally {
      const held = await redis.get<string>(lockKey);
      if (held === token) await redis.del(lockKey);
    }
  }

  const prev = memLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  memLocks.set(id, prev.then(() => gate));
  await prev;
  try {
    const current = memGet(id);
    if (!current) return { ok: false, error: "not_found", status: 404 };
    const result = mutator(current);
    if (!result.ok) return result;
    if (result.room === current) return result;
    const stamped: RoomState = {
      ...result.room,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    memSet(stamped);
    return { ok: true, room: stamped };
  } finally {
    release();
  }
}
