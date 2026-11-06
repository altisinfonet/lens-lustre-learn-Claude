/**
 * Owner, 6 Nov 2026 (app 1.2.39): Dipannita's profile in the APP listed her
 * posts only up to 3 days back — her 6 newer posts were missing, while the
 * count (28) and the feed were current. Sign-out (wipes the copies saved on the
 * phone, OFF-1) fixed it. So the wall's saved copy was shown and never
 * replaced. These tests replay the app's real path: the app's QueryClient
 * defaults, the device store, the persistence writer and the hydration, and
 * the real wall query (useUserPostsQuery) against a server that has new posts.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";

const server = vi.hoisted(() => ({ posts: [] as Record<string, unknown>[], gate: null as null | Promise<void> }));
vi.mock("@/integrations/supabase/client", () => {
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "lt", "or", "not", "is", "neq", "gte", "lte", "match", "filter"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      (async () => {
        if (table === "posts" && server.gate) await server.gate;
        return { data: table === "posts" ? server.posts.map((p) => ({ ...p })) : [], error: null };
      })().then(resolve, reject);
    return chain;
  };
  return {
    supabase: {
      from: (t: string) => make(t),
      rpc: async () => ({ data: [], error: null }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});

import { setBackend, memoryBackend, putRecord, readAll } from "@/lib/offline/deviceStore";
import { hydrateFromDevice, setPersistenceUser, startQueryPersistence } from "@/lib/offline/queryPersistence";
import { useUserPostsQuery, flattenUserPosts } from "@/hooks/feed/useUserPostsQuery";

const ME = "11111111-1111-4111-8111-111111111111";
const HER = "cc691988-699f-4da5-9b2e-f2346c7303be";
const KEY = ["user-wall-posts", HER];
const post = (id: string, at: string) => ({ id, user_id: HER, content: id, created_at: at, privacy: "public", image_urls: [], likes_count: 0, comments_count: 0, shares_count: 0 });
const OLD = [post("p-3nov", "2026-11-03T02:08:21Z")];
const NEW = [post("p-6nov", "2026-11-06T08:40:05Z"), post("p-5nov", "2026-11-05T15:31:16Z"), ...OLD];
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

/** The app's QueryClient defaults (src/App.tsx). */
const appClient = () => new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000, retry: false } } });

let mem: ReturnType<typeof memoryBackend>;
async function saveOldCopy(ageMs: number) {
  await putRecord(ME, KEY, { pages: [{ posts: OLD, nextCursor: null }], pageParams: [null] });
  for (const r of mem.map.values()) r.updatedAt = Date.now() - ageMs; // saved `ageMs` ago
}
const ids = (qc: QueryClient) => flattenUserPosts((qc.getQueryData(KEY) as { pages: never[] } | undefined)?.pages).map((p) => (p as { id: string }).id);

beforeEach(() => { mem = memoryBackend(); setBackend(mem); server.posts = NEW; server.gate = null; });
afterEach(() => { setBackend(undefined); setPersistenceUser(null); });

function mountWall(qc: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useUserPostsQuery(HER, ME), { wrapper });
}

describe("the wall's saved copy is replaced by the server's wall", () => {
  it("copy restored BEFORE the wall opens → the wall refreshes", async () => {
    await saveOldCopy(THREE_DAYS);
    const qc = appClient();
    setPersistenceUser(ME);
    startQueryPersistence(qc, (fn) => fn());
    await hydrateFromDevice(qc, ME);
    mountWall(qc);
    await waitFor(() => expect(ids(qc)).toEqual(["p-6nov", "p-5nov", "p-3nov"]));
  });

  it("copy restored WHILE the wall's first read is on its way → the server's wall still wins", async () => {
    await saveOldCopy(THREE_DAYS);
    const qc = appClient();
    setPersistenceUser(ME);
    startQueryPersistence(qc, (fn) => fn());
    let open!: () => void;
    server.gate = new Promise<void>((r) => { open = r; });
    mountWall(qc);
    await act(async () => { await hydrateFromDevice(qc, ME); });
    await act(async () => { open(); });
    await waitFor(() => expect(ids(qc)).toEqual(["p-6nov", "p-5nov", "p-3nov"]));
  });

  it("THE PHONE'S CASE: 3-day-old posts in a copy re-saved at the last app open (1 min ago) → the wall still refreshes", async () => {
    await saveOldCopy(60 * 1000);
    const qc = appClient();
    setPersistenceUser(ME);
    startQueryPersistence(qc, (fn) => fn());
    await hydrateFromDevice(qc, ME);
    mountWall(qc);
    await waitFor(() => expect(ids(qc)).toEqual(["p-6nov", "p-5nov", "p-3nov"]));
  });

  it("restoring a copy does not make it look newly saved (it must still age and refresh)", async () => {
    await saveOldCopy(THREE_DAYS);
    const before = (await readAll(ME))[0].updatedAt;
    const qc = appClient();
    setPersistenceUser(ME);
    startQueryPersistence(qc, (fn) => fn());
    await hydrateFromDevice(qc, ME);
    await new Promise((r) => setTimeout(r, 10));
    const after = (await readAll(ME))[0].updatedAt;
    expect(after).toBe(before);
  });
});
