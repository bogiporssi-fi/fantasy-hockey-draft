import { afterEach, describe, expect, it } from "vitest";
import { getRoomStorageKind, pickRedisRestConfig, resetRoomStoreForTests } from "./mockRoomStore";

afterEach(() => {
  resetRoomStoreForTests();
});

describe("pickRedisRestConfig", () => {
  it("prefers standard Upstash REST names", () => {
    expect(
      pickRedisRestConfig({
        UPSTASH_REDIS_REST_URL: "https://good.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "tok",
        KV_REST_API_URL: "rediss://should-not-win",
        KV_REST_API_TOKEN: "other",
      }),
    ).toEqual({ url: "https://good.upstash.io", token: "tok" });
  });

  it("reads Vercel Marketplace prefixed KV REST names", () => {
    expect(
      pickRedisRestConfig({
        UPSTASH_REDIS_REST_KV_REST_API_URL: "https://prefixed.upstash.io",
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "prefixed-tok",
        UPSTASH_REDIS_REST_KV_URL: "rediss://default:pass@host:6379",
        UPSTASH_REDIS_REST_REDIS_URL: "rediss://default:pass@host:6379",
      }),
    ).toEqual({ url: "https://prefixed.upstash.io", token: "prefixed-tok" });
  });

  it("skips TCP rediss URLs even when KV_REST_API_URL is set", () => {
    expect(
      pickRedisRestConfig({
        KV_REST_API_URL: "rediss://default:pass@host:6379",
        KV_REST_API_TOKEN: "tcp-password",
        UPSTASH_REDIS_REST_KV_REST_API_URL: " https://rest.upstash.io ",
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: " rest-tok ",
      }),
    ).toEqual({ url: "https://rest.upstash.io", token: "rest-tok" });
  });

  it("accepts classic KV REST names when they are HTTPS", () => {
    expect(
      pickRedisRestConfig({
        KV_REST_API_URL: "https://kv.upstash.io",
        KV_REST_API_TOKEN: "kv-tok",
      }),
    ).toEqual({ url: "https://kv.upstash.io", token: "kv-tok" });
  });

  it("returns null when only TCP URLs exist", () => {
    expect(
      pickRedisRestConfig({
        UPSTASH_REDIS_REST_KV_URL: "rediss://default:pass@host:6379",
        KV_REST_API_URL: "redis://localhost:6379",
        KV_REST_API_TOKEN: "x",
      }),
    ).toBeNull();
    expect(getRoomStorageKind({})).toBe("memory");
  });
});
