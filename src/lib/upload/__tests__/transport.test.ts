/** S5-b · the shared PUT: backoff with jitter, re-presign on 403, abort, no retry on a wrong request. */
import { describe, it, expect, afterEach } from "vitest";
import { __setPutSend, putWithRetry, PUT_MAX_ATTEMPTS } from "../transport";

afterEach(() => __setPutSend(null));
const blob = new Blob([new Uint8Array(4)]);
const base = { label: "T", headers: {}, sleep: async (ms: number) => { waits.push(ms); }, rnd: () => 0.5 };
let waits: number[] = [];

describe("putWithRetry", () => {
  it("backs off exponentially between network failures, then succeeds", async () => {
    waits = [];
    let n = 0;
    __setPutSend(async () => { if (++n < 3) throw new TypeError("Failed to fetch"); return 200; });
    await putWithRetry("u", blob, base);
    expect(n).toBe(3);
    expect(waits).toEqual([1000, 2000]); // outbox backoffMs: 1 s, 2 s, … (rnd 0.5 = no jitter)
  });

  it("caps attempts on a server that keeps failing", async () => {
    waits = [];
    let n = 0;
    __setPutSend(async () => { n++; return 503; });
    await expect(putWithRetry("u", blob, base)).rejects.toThrow(/503/);
    expect(n).toBe(PUT_MAX_ATTEMPTS);
  });

  it("403 asks for a fresh URL (no back-off) and PUTs there", async () => {
    waits = [];
    const urls: string[] = [];
    __setPutSend(async (u) => { urls.push(u); return u === "old" ? 403 : 200; });
    await putWithRetry("old", blob, { ...base, represign: async () => "new" });
    expect(urls).toEqual(["old", "new"]);
    expect(waits).toEqual([]);
  });

  it("a 400 is not repeated; a cancel is not retried", async () => {
    let n = 0;
    __setPutSend(async () => { n++; return 400; });
    await expect(putWithRetry("u", blob, base)).rejects.toThrow(/400/);
    expect(n).toBe(1);
    const ac = new AbortController();
    ac.abort();
    await expect(putWithRetry("u", blob, { ...base, signal: ac.signal })).rejects.toThrow(/cancelled/);
  });
});
