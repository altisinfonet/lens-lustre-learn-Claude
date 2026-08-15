/**
 * THE UPLOAD PUT RETRIES — AND ONLY WHERE RETRYING IS FREE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Documented defect F3, first half: the presign call retried but the PUT did
 * not — one dropped packet threw immediately, and because object keys are
 * Date.now()+random, the member's next attempt re-uploaded everything under
 * NEW names, stranding the old bytes as unreclaimable orphans.
 *
 * Retrying the same presigned URL is exactly idempotent (same key, same
 * bytes), so the retry is free. The discipline is in what is NOT retried:
 * a 400 means the request is wrong, and repeating a wrong request just
 * repeats the mistake. Behavioural tests with a mocked fetch — the retry
 * loop is logic, and logic gets value tests, not grep.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// supabase client import inside s3Upload pulls env; mock it before import.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { uploadToS3 } from "@/lib/s3Upload";
import { supabase } from "@/integrations/supabase/client";

const okPresign = {
  data: { uploadUrl: "https://r2.example/signed-1", publicUrl: "https://cdn.example/k", key: "k" },
  error: null,
};

describe("putWithRetry via uploadToS3", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(okPresign);
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });

  it("a network drop mid-transfer is retried and succeeds — same URL, same key", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      if (calls.length === 1) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    }) as any;

    const p = uploadToS3(file, "post-images/u/a.webp", "a.webp");
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.key).toBe("k");
    expect(calls).toEqual(["https://r2.example/signed-1", "https://r2.example/signed-1"]);
  });

  it("a 500 is retried; persistent 500 eventually throws the retry error", async () => {
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const p = uploadToS3(file, "post-images/u/a.webp", "a.webp");
    p.catch(() => {}); // observed below; avoids unhandled-rejection noise under fake timers
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/500/);
    expect((global.fetch as any).mock.calls.length).toBe(3); // capped, not infinite
  });

  it("a 400 is NOT retried — a wrong request repeated is still wrong", async () => {
    global.fetch = vi.fn(async () => new Response("bad", { status: 400 })) as any;
    const p = uploadToS3(file, "post-images/u/a.webp", "a.webp");
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/400/);
    expect((global.fetch as any).mock.calls.length).toBe(1);
  });

  it("403 re-presigns ONCE (expired URL) and retries the SAME path", async () => {
    const fresh = {
      data: { uploadUrl: "https://r2.example/signed-2", publicUrl: "https://cdn.example/k", key: "k" },
      error: null,
    };
    (supabase.functions.invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okPresign) // initial presign
      .mockResolvedValueOnce(fresh); // the re-presign
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      if (String(url).endsWith("signed-1")) return new Response(null, { status: 403 });
      return new Response(null, { status: 200 });
    }) as any;

    const p = uploadToS3(file, "post-images/u/a.webp", "a.webp");
    await vi.runAllTimersAsync();
    await p;
    expect(calls[0]).toContain("signed-1");
    expect(calls[calls.length - 1]).toContain("signed-2");
    // The re-presign asked for the SAME path — same key, no new orphan.
    const represignBody = (supabase.functions.invoke as any).mock.calls[1][1].body;
    expect(represignBody.path).toBe("post-images/u/a.webp");
  });
});
