/**
 * RUNTIME REGRESSION — PUBLISHING A RESUMED DRAFT.
 *
 * ⚠ THIS IS NOT A SOURCE-CODE ASSERTION. It builds a REAL supabase-js client,
 * renders the REAL `usePublishDraft` hook, and runs the REAL mutation. The only
 * thing stubbed is the network socket at the very bottom.
 *
 * WHY IT EXISTS. On 2026-08-17 members could not publish from the Android app:
 *
 *     Could not publish
 *     Cannot read properties of undefined (reading 'rest')
 *
 * `usePostDrafts.ts` held `const rpc = supabase.rpc`, which copies the method
 * away from the client it belongs to. supabase-js defines it as
 * `rpc(fn, args, o) { return this.rest.rpc(...) }`, so the copy ran with
 * `this === undefined` and died on `this.rest` — before any network call.
 *
 * A source pin ("does the file contain the safe form?") would have caught the
 * shape and not the behaviour. This test fails against the old implementation
 * and passes against the fixed one, because it actually invokes the method the
 * same way production does. Mutation-verified both ways on the day it was
 * written.
 *
 * THE DEEPER LESSON, recorded so it is not repeated: the resumed-draft publish
 * journey had never been executed by any test. The bug did not hide in a
 * subtle branch — it sat on the one line of the one path nothing ran.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";

const PUBLISHED_POST_ID = "11111111-2222-4333-8444-555555555555";

/** Every request the client makes, so the assertions can read them. */
const calls: { url: string; method: string; body: unknown }[] = [];

/**
 * The socket, and nothing above it. A REAL SupabaseClient is constructed here —
 * so `rpc()` is supabase-js's own method, `this.rest` is a real PostgrestClient,
 * and the detached-receiver fault reproduces exactly as it did in the app.
 */
function makeRealClient() {
  const fetchStub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    let body: unknown = null;
    try { body = init?.body ? JSON.parse(init.body as string) : null; } catch { /* not json */ }
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), body });

    if (url.includes("/rest/v1/rpc/publish_post_draft")) {
      // One draft id is wired to answer with null, so the hook's own
      // "returned no id" guard can be exercised for real rather than assumed.
      const draftId = (body as { _draft_id?: string } | null)?._draft_id;
      const payload = draftId === "draft-does-not-return-an-id" ? null : PUBLISHED_POST_ID;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  return createClient("https://stub.supabase.co", "stub-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub },
  });
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: makeRealClient() }));
vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-000000000001" } }),
}));

import { usePublishDraft } from "@/hooks/feed/usePostDrafts";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("publishing a resumed draft — the real path, run for real", () => {
  beforeEach(() => { calls.length = 0; });

  it("reaches Supabase and returns the new post id", async () => {
    const { result } = renderHook(() => usePublishDraft(), { wrapper });

    // THE ACTION UNDER TEST. Against the old `const rpc = supabase.rpc` this
    // rejects with "Cannot read properties of undefined (reading 'rest')".
    const postId = await result.current.mutateAsync("draft-abc");

    expect(postId).toBe(PUBLISHED_POST_ID);
  });

  it("actually issued the RPC over the wire — proof the call was not merely constructed", async () => {
    const { result } = renderHook(() => usePublishDraft(), { wrapper });
    await result.current.mutateAsync("draft-abc");

    const rpcCall = calls.find((c) => c.url.includes("/rest/v1/rpc/publish_post_draft"));
    expect(rpcCall, "no request reached the network for publish_post_draft").toBeTruthy();
    expect(rpcCall!.method).toBe("POST");
    // The draft id must be the one the member is publishing — not a default,
    // not another member's.
    expect(rpcCall!.body).toEqual({ _draft_id: "draft-abc" });
  });

  it("surfaces a real server refusal instead of swallowing it", async () => {
    const { result } = renderHook(() => usePublishDraft(), { wrapper });
    await expect(result.current.mutateAsync("draft-does-not-return-an-id")).rejects.toBeTruthy();
  });

  /**
   * The shape guard, kept as SECONDARY protection only. The three tests above
   * are the proof; this one just makes the specific mistake loud if it returns.
   */
  it("secondary: no Supabase method is copied into a variable in this module", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(join(__dirname, "..", "usePostDrafts.ts"), "utf8");
    const code = src.replace(/^\s*\*.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/(const|let|var)\s+\w+\s*(:[^=]+)?=\s*supabase\.(rpc|from|storage|auth)\s*(as|;|$)/m);
  });
});
