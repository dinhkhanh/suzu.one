import { describe, expect, it } from "vitest";
import { databaseReachable } from "./health";

describe("databaseReachable", () => {
  it("is true when the database answers", async () => {
    expect(await databaseReachable(1000, { execute: async () => [{ "?column?": 1 }] })).toBe(true);
  });

  it("is false when the database refuses", async () => {
    expect(await databaseReachable(1000, { execute: async () => Promise.reject(new Error("ECONNREFUSED")) })).toBe(false);
  });

  it("is false when the database does not answer in time, without waiting for it", async () => {
    const started = Date.now();
    expect(await databaseReachable(50, { execute: () => new Promise(() => undefined) })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
