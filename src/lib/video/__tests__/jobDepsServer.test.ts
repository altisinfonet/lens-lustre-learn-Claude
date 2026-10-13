/**
 * Server conversion · the real adapters (jobDeps.ts):
 *   • the original's PUT goes through XMLHttpRequest (fetch has no upload
 *     progress), with EXACTLY the headers the URL was signed with, the file
 *     itself as the body, progress reported, and Cancel aborting it;
 *   • the member's own source row is read through RLS with only the columns
 *     granted to them (20261012_0002: never claim_token, lease or ETag).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const reads: Array<{ table: string; columns: string; eq: [string, unknown] }> = [];
let row: Record<string, unknown> | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (c: string, v: unknown) => ({
          maybeSingle: async () => { reads.push({ table, columns, eq: [c, v] }); return { data: row, error: null }; },
        }),
      }),
    }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/lib/offline/networkQuality", () => ({ getNetState: () => ({ online: true }) }));

import { realJobDeps, xhrPut } from "../jobDeps";

class FakeXhr {
  static last: FakeXhr;
  method = ""; url = ""; headers: Record<string, string> = {}; body: unknown = null; status = 0; aborted = false;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null; ontimeout: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: unknown) { this.body = b; }
  abort() { this.aborted = true; this.onabort?.(); }
}

beforeEach(() => {
  reads.length = 0; row = null;
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});

describe("xhrPut — the original's upload", () => {
  it("PUTs the file with exactly the signed headers, reports progress, answers the status", async () => {
    const file = new Blob([new Uint8Array(1000)]);
    const seen: Array<[number, number]> = [];
    const p = xhrPut("https://acct.r2.cloudflarestorage.com/b/upload/source/x/source?X-Amz-Signature=s",
      { "content-type": "application/octet-stream" }, file, (a, b) => seen.push([a, b]), new AbortController().signal);
    const x = FakeXhr.last;
    expect(x.method).toBe("PUT");
    expect(x.url).toContain("/upload/source/x/source");
    expect(x.headers).toEqual({ "content-type": "application/octet-stream" });
    expect(x.body).toBe(file);
    x.upload.onprogress!({ loaded: 400, total: 1000, lengthComputable: true });
    x.upload.onprogress!({ loaded: 700, total: 0, lengthComputable: false });
    x.status = 200; x.onload!();
    expect(await p).toBe(200);
    expect(seen).toEqual([[400, 1000], [700, 1000]]);
  });

  it("a dropped link rejects as a network error (the job retries it like any other)", async () => {
    const p = xhrPut("https://h/u", {}, new Blob([]), () => {}, new AbortController().signal);
    FakeXhr.last.onerror!();
    await expect(p).rejects.toThrow("Failed to fetch");
  });

  it("Cancel aborts the request", async () => {
    const ctl = new AbortController();
    const p = xhrPut("https://h/u", {}, new Blob([]), () => {}, ctl.signal);
    ctl.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("realJobDeps.upload is this adapter", () => {
    expect(realJobDeps.upload).toBeTypeOf("function");
  });
});

describe("realJobDeps.sourceRow — the member's own row", () => {
  it("reads video_sources by id, only status / video_id / error", async () => {
    row = { status: "failed", video_id: null, error: "This file has no video in it." };
    expect(await realJobDeps.sourceRow!("55555555-5555-4555-8555-555555555555"))
      .toEqual({ status: "failed", video_id: null, error: "This file has no video in it." });
    expect(reads).toEqual([{ table: "video_sources", columns: "status, video_id, error", eq: ["id", "55555555-5555-4555-8555-555555555555"] }]);
  });

  it("no row (RLS hid it, or it was purged) → null", async () => {
    expect(await realJobDeps.sourceRow!("55555555-5555-4555-8555-555555555555")).toBeNull();
  });
});
