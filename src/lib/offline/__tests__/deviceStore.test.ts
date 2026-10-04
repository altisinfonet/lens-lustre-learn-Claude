/**
 * OFF-1 · the device store's rules, driven through the in-memory backend.
 * (The IndexedDB backend is proved in a real Chromium; see the evidence.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  putRecord, readAll, clearDeviceStore, setBackend, memoryBackend,
  MAX_RECORDS_PER_USER, MAX_RECORD_BYTES, MAX_AGE_MS, type Backend,
} from "../deviceStore";

let mem: ReturnType<typeof memoryBackend>;
beforeEach(() => { mem = memoryBackend(); setBackend(mem); });
afterEach(() => setBackend(undefined));

describe("deviceStore", () => {
  it("stores and reads back a member's record", async () => {
    expect(await putRecord("u1", ["notifications", "u1"], { items: [1, 2] }, 1000)).toBe(true);
    const all = await readAll("u1", 2000);
    expect(all).toHaveLength(1);
    expect(all[0].data).toEqual({ items: [1, 2] });
    expect(all[0].updatedAt).toBe(1000);
  });

  it("never returns another member's records", async () => {
    await putRecord("u1", ["profile-core", "x"], { name: "A" });
    expect(await readAll("u2")).toEqual([]);
  });

  it("refuses a record over MAX_RECORD_BYTES", async () => {
    expect(await putRecord("u1", ["feed", null], "x".repeat(MAX_RECORD_BYTES))).toBe(false);
    expect(mem.map.size).toBe(0);
  });

  it(`keeps at most ${MAX_RECORDS_PER_USER} records per member, evicting the oldest`, async () => {
    for (let i = 0; i <= MAX_RECORDS_PER_USER; i++) await putRecord("u1", ["profile-core", `p${i}`], { i }, 1000 + i);
    const all = await readAll("u1", 5000);
    expect(all).toHaveLength(MAX_RECORDS_PER_USER);
    expect(all.some((r) => (r.data as { i: number }).i === 0)).toBe(false);
  });

  it("drops records older than MAX_AGE_MS on read", async () => {
    await putRecord("u1", ["feed", null], { a: 1 }, 0);
    expect(await readAll("u1", MAX_AGE_MS + 1)).toEqual([]);
    expect(mem.map.size).toBe(0);
  });

  it("clearDeviceStore deletes every member's records", async () => {
    await putRecord("u1", ["feed", null], 1);
    await putRecord("u2", ["feed", null], 2);
    expect(await clearDeviceStore()).toBe(true);
    expect(mem.map.size).toBe(0);
  });

  it("no storage on the device -> no cache, never an error", async () => {
    setBackend(null);
    expect(await putRecord("u1", ["feed", null], 1)).toBe(false);
    expect(await readAll("u1")).toEqual([]);
    expect(await clearDeviceStore()).toBe(false);
  });

  it("a failing backend -> no cache, never an error", async () => {
    const broken: Backend = {
      getAll: async () => { throw new Error("corrupt"); },
      put: async () => { throw new Error("full"); },
      delete: async () => { throw new Error("x"); },
      clear: async () => { throw new Error("x"); },
    };
    setBackend(broken);
    expect(await putRecord("u1", ["feed", null], 1)).toBe(false);
    expect(await readAll("u1")).toEqual([]);
    expect(await clearDeviceStore()).toBe(false);
  });
});
