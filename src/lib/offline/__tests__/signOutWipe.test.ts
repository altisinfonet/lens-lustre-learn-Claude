/**
 * OFF-4 · every member-content store is wiped on sign-out, and the device's own
 * preferences are not. Before OFF-4 the feed's localStorage page was only
 * cleared by the Log out button, so an involuntary sign-out (expired refresh,
 * another tab, account deleted) left it on the device.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { wipeMemberDataOnSignOut } from "../signOutWipe";
import { setBackend, memoryBackend, putRecord } from "../deviceStore";
import { setPersistenceUser, startQueryPersistence } from "../queryPersistence";
import { persistFeedPage, getCachedFeed } from "@/lib/feedCache";

type C = { keys: () => Promise<string[]>; delete: (n: string) => Promise<boolean>; names: Set<string> };
const fakeCaches = (names: string[]): C => {
  const set = new Set(names);
  return { names: set, keys: async () => [...set], delete: async (n) => set.delete(n) };
};

let mem: ReturnType<typeof memoryBackend>;
const realCaches = (globalThis as { caches?: unknown }).caches;
beforeEach(() => { mem = memoryBackend(); setBackend(mem); localStorage.clear(); });
afterEach(() => { setBackend(undefined); (globalThis as { caches?: unknown }).caches = realCaches; });

describe("wipeMemberDataOnSignOut", () => {
  it("wipes image caches, the device store and the feed cache; keeps device preferences", async () => {
    const c = fakeCaches(["gallery-images-v3", "unrelated"]);
    (globalThis as { caches?: unknown }).caches = c;
    await putRecord("me", ["notifications", "me"], { n: 1 });
    persistFeedPage([{ id: "p1" }], [], "me");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("app_lang", "hi");

    const r = await wipeMemberDataOnSignOut();

    expect(r).toEqual({ imageCaches: ["gallery-images-v3"], deviceStore: true, feedCache: true });
    expect([...c.names]).toEqual(["unrelated"]);
    expect(mem.map.size).toBe(0);
    expect(getCachedFeed("me")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("app_lang")).toBe("hi");
  });

  it("stops the OFF-1 writer first, so a pending write cannot re-store the member's data", async () => {
    const qc = new QueryClient();
    const runs: (() => void)[] = [];
    setPersistenceUser("me");
    startQueryPersistence(qc, (fn) => runs.push(fn));
    await qc.fetchQuery({ queryKey: ["notifications", "me"], queryFn: async () => ({ n: 1 }) });
    await wipeMemberDataOnSignOut();
    runs.forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));
    expect(mem.map.size).toBe(0);
  });

  it("never throws when nothing is available", async () => {
    (globalThis as { caches?: unknown }).caches = undefined;
    setBackend(null);
    await expect(wipeMemberDataOnSignOut()).resolves.toEqual({ imageCaches: null, deviceStore: false, feedCache: true });
  });
});
