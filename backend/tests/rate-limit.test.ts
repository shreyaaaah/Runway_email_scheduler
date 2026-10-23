import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RATE_LIMIT_LUA } from "../src/rateLimit.js";

describe("hourly Redis Lua reservation", () => {
  const connection = new Redis(process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    connectTimeout: 2_000,
    retryStrategy: attempt => attempt < 2 ? 100 : null,
    maxRetriesPerRequest: null,
  });
  const key = `test:rate-limit:${process.pid}:${Date.now()}`;

  beforeAll(async () => {
    await connection.connect();
    await connection.ping();
  });

  afterAll(async () => {
    if (connection.status === "ready") {
      await connection.del(key);
      await connection.quit();
      return;
    }
    connection.disconnect();
  });

  it("allows up to the cap and undoes an over-limit increment in Redis", async () => {
    expect(Number(await connection.eval(RATE_LIMIT_LUA, 1, key, 2))).toBe(1);
    expect(Number(await connection.eval(RATE_LIMIT_LUA, 1, key, 2))).toBe(2);
    expect(Number(await connection.eval(RATE_LIMIT_LUA, 1, key, 2))).toBe(0);
    expect(await connection.get(key)).toBe("2");
  });
});
