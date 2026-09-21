import { Redis } from "@upstash/redis";
import type { RoomState, RoomStorageKind } from "./mockRoom";

export const ROOM_TTL_SECONDS = 6 * 60 * 60;
const KEY_PREFIX = "luistin:mock:";

/** Vercel Marketplace sometimes prefixes Upstash KV names with the resource id. */
const REDIS_REST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ["UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"],
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
];

export class RoomStorageError extends Error {
  readonly code = "storage_unavailable" as const;
  constructor(cause?: unknown) {
    super("storage_unavailable", { cause });
    this.name = "RoomStorageError";
  }
}

function readEnv(env: NodeJS.Dict<string>, key: string): string {
  const raw = env[key];
  return typeof raw === "string" ? raw.trim() : "";
}

/** HTTPS REST URL + token. Skips TCP `rediss://` URLs that crash @upstash/redis. */
export function pickRedisRestConfig(
  env: NodeJS.Dict<string> = process.env,
): { url: string; token: string } | null {
  for (const [urlKey, tokenKey] of REDIS_REST_PAIRS) {
    const url = readEnv(env, urlKey);
    const token = readEnv(env, tokenKey);
    if (url.startsWith("https://") && token) return { url, token };
  }
  return null;
}

export function getRoomStorageKind(env: NodeJS.Dict<string> = process.env): RoomStorageKind {
  return pickRedisRestConfig(env) ? "redis" : "memory";
}

let redisClient: Redis | null | undefined;

function asStorageError(err: unknown): RoomStorageError {
  return err instanceof RoomStorageError ? err : new RoomStorageError(err);
}

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const cfg = pickRedisRestConfig();
  if (!cfg) {
    redisClient = null;
    return null;
  }
  try {
    redisClient = new Redis({
      url: cfg.url,
      token: cfg.token,
      cache: "no-store",
      retry: false,
    });
    return redisClient;
  } catch (err) {
    redisClient = undefined;
    throw asStorageError(err);
  }
}

/** Test-only: forget the cached Redis client after env stubs. */
export function resetRoomStoreForTests() {
  redisClient = undefined;
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
  let redis: Redis | null;
  try {
    redis = getRedis();
  } catch (err) {
    throw asStorageError(err);
  }
  if (redis) {
    try {
      const room = await redis.get<RoomState>(KEY_PREFIX + id);
      return room ?? null;
    } catch (err) {
      throw asStorageError(err);
    }
  }
  return memGet(id);
}

export async function createRoomIfAbsent(room: RoomState): Promise<boolean> {
  let redis: Redis | null;
  try {
    redis = getRedis();
  } catch (err) {
    throw asStorageError(err);
  }
  if (redis) {
    try {
      const got = await redis.set(KEY_PREFIX + room.id, room, { nx: true, ex: ROOM_TTL_SECONDS });
      return Boolean(got);
    } catch (err) {
      throw asStorageError(err);
    }
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
  let redis: Redis | null;
  try {
    redis = getRedis();
  } catch (err) {
    throw asStorageError(err);
  }
  if (redis) {
    const lockKey = `${KEY_PREFIX}${id}:lock`;
    const token = crypto.randomUUID();
    let locked = false;
    try {
      locked = await acquireRedisLock(redis, lockKey, token);
    } catch (err) {
      throw asStorageError(err);
    }
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
    } catch (err) {
      throw asStorageError(err);
    } finally {
      try {
        const held = await redis.get<string>(lockKey);
        if (held === token) await redis.del(lockKey);
      } catch {
        // lock TTL covers a failed unlock
      }
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
