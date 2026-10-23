import { describe, expect, it } from "vitest";
import { planSchedule } from "../src/schedule.js";

describe("planSchedule", () => {
  it("preserves lead order, rotates senders, and respects per-sender spacing", () => {
    const startAt = new Date("2026-01-01T10:00:00Z");
    const result = planSchedule({ leads:["a@x.com","b@x.com","c@x.com","d@x.com"], senders:[{id:"s1"},{id:"s2"}], startAt, delayMs:60_000, hourlyLimit:10 });
    expect(result.map(x=>x.to)).toEqual(["a@x.com","b@x.com","c@x.com","d@x.com"]);
    expect(result.map(x=>x.senderId)).toEqual(["s1","s2","s1","s2"]);
    expect(result[2].scheduledAt.getTime()-result[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(60_000);
  });
  it("moves capped sends into the next hour window", () => {
    const result=planSchedule({leads:["a","b","c","d"],senders:[{id:"one"}],startAt:new Date("2026-01-01T10:58:00Z"),delayMs:60_000,hourlyLimit:2});
    expect(result.map(x=>x.scheduledAt.toISOString())).toEqual(["2026-01-01T10:58:00.000Z","2026-01-01T10:59:00.000Z","2026-01-01T11:00:00.000Z","2026-01-01T11:01:00.000Z"]);
  });
  it("keeps each UTC hour at or below a limit of two with one-second spacing", () => {
    const result = planSchedule({
      leads: ["a", "b", "c", "d", "e"],
      senders: [{ id: "one" }],
      startAt: new Date("2026-01-01T10:00:00.000Z"),
      delayMs: 1_000,
      hourlyLimit: 2,
    });
    const byHour = new Map<number, number>();
    for (const email of result) {
      const startOfHour = Math.floor(email.scheduledAt.getTime() / 3_600_000);
      byHour.set(startOfHour, (byHour.get(startOfHour) ?? 0) + 1);
    }
    expect([...byHour.values()]).toEqual([2, 2, 1]);
    expect(result[2].scheduledAt.toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });
  it("rejects leads without a sender",()=>expect(()=>planSchedule({leads:["a"],senders:[],startAt:new Date(),delayMs:0,hourlyLimit:1})).toThrow());
});
