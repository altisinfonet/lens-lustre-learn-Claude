/**
 * OFF-1 · the app opens from the device store and then refreshes.
 *
 * The decisive test is the last one: with the network OFF, a screen whose
 * query can never be answered still renders the member's stored notifications
 * — because the bridge restored them. Without the bridge (mutant: hydration
 * removed) the same screen shows only its loading state: a blank app offline,
 * which is what R-90 forbids.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query";
import { render, screen, act } from "@testing-library/react";
import { setBackend, memoryBackend, putRecord, readAll } from "../deviceStore";
import { isPersisted, trimForStorage, startQueryPersistence, hydrateFromDevice, setPersistenceUser } from "../queryPersistence";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: auth.user, session: null, loading: false, signOut: async () => {} }) }));

import OfflineDeviceStoreBridge, { resetOfflineBridgeForTests } from "@/components/OfflineDeviceStoreBridge";

let mem: ReturnType<typeof memoryBackend>;
beforeEach(() => { mem = memoryBackend(); setBackend(mem); setPersistenceUser(null); resetOfflineBridgeForTests(); });
afterEach(() => { setBackend(undefined); onlineManager.setOnline(true); });

describe("what is kept", () => {
  it.each([
    [["feed", null], true],
    [["feed", ["landscape"]], true],
    [["profile-core", "someone"], true],
    [["user-wall-posts", "me"], true],
    [["user-wall-posts", "someone-else"], false],
    [["notifications", "me"], true],
    [["notifications", "someone-else"], false],
    [["is-admin", "me"], false],
    [["search", "x"], false],
    [["post-drafts", "me"], false],
  ])("%j -> %s", (key, want) => {
    expect(isPersisted(key as unknown[], "me")).toBe(want);
  });

  it("nothing is kept without a signed-in member", () => {
    expect(isPersisted(["feed", null], null)).toBe(false);
  });

  it("infinite data keeps its first page only", () => {
    expect(trimForStorage({ pages: [1, 2, 3], pageParams: [0, 1, 2] })).toEqual({ pages: [1], pageParams: [0] });
    expect(trimForStorage({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("write and restore", () => {
  it("a successful allow-listed fetch is written; others are not", async () => {
    const qc = new QueryClient();
    const runs: (() => void)[] = [];
    setPersistenceUser("me");
    startQueryPersistence(qc, (fn) => runs.push(fn));
    await qc.fetchQuery({ queryKey: ["notifications", "me"], queryFn: async () => ({ n: 3 }) });
    await qc.fetchQuery({ queryKey: ["is-admin", "me"], queryFn: async () => true });
    await qc.fetchInfiniteQuery({ queryKey: ["feed", null], queryFn: async () => ({ posts: ["a"] }), initialPageParam: 0 });
    runs.forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));
    const keys = (await readAll("me")).map((r) => JSON.stringify(r.key)).sort();
    expect(keys).toEqual([JSON.stringify(["feed", null]), JSON.stringify(["notifications", "me"])]);
  });

  it("a write scheduled for a member who has since signed out is dropped", async () => {
    const qc = new QueryClient();
    const runs: (() => void)[] = [];
    setPersistenceUser("me");
    startQueryPersistence(qc, (fn) => runs.push(fn));
    await qc.fetchQuery({ queryKey: ["notifications", "me"], queryFn: async () => ({ n: 3 }) });
    setPersistenceUser(null);
    runs.forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));
    expect(mem.map.size).toBe(0);
  });

  it("restore fills only empty queries, as OLD data (so it refreshes)", async () => {
    const then = Date.now() - 60_000;
    await putRecord("me", ["notifications", "me"], { n: "stored" }, then);
    await putRecord("me", ["profile-core", "me"], { name: "stored" }, then);
    const qc = new QueryClient();
    qc.setQueryData(["profile-core", "me"], { name: "live" });
    const restored = await hydrateFromDevice(qc, "me");
    expect(restored).toEqual([JSON.stringify(["notifications", "me"])]);
    expect(qc.getQueryData(["profile-core", "me"])).toEqual({ name: "live" });
    expect(qc.getQueryState(["notifications", "me"])?.dataUpdatedAt).toBe(then);
    expect(qc.getQueryCache().find({ queryKey: ["notifications", "me"] })?.isStaleByTime(5 * 60 * 1000)).toBe(false);
    expect(qc.getQueryCache().find({ queryKey: ["notifications", "me"] })?.isStaleByTime(0)).toBe(true);
  });
});

function Notifications() {
  const q = useQuery({ queryKey: ["notifications", "me"], queryFn: () => new Promise<{ n: string }>(() => {}), staleTime: 0 });
  return <p>{q.data ? `notifications: ${q.data.n}` : "loading"}</p>;
}

describe("offline: the app opens from the device", () => {
  it("network OFF -> the stored notifications render (bridge restores them)", async () => {
    await putRecord("me", ["notifications", "me"], { n: "from-device" }, Date.now() - 60_000);
    onlineManager.setOnline(false);
    auth.user = { id: "me" };
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <OfflineDeviceStoreBridge />
        <Notifications />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("notifications: from-device")).toBeTruthy();
  });

  it("without the bridge the same screen is stuck on loading (what OFF-1 fixes)", async () => {
    await putRecord("me", ["notifications", "me"], { n: "from-device" }, Date.now() - 60_000);
    onlineManager.setOnline(false);
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><Notifications /></QueryClientProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByText("loading")).toBeTruthy();
  });
});
