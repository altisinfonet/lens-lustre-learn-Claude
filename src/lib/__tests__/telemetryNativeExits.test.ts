import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.fn(async () => ({ data: 1, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) }, rpc },
}));

type W = { Capacitor?: unknown };

describe("S2 telemetry — an Android app start reports earlier native exits", () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockClear();
    localStorage.clear();
  });
  afterEach(() => {
    delete (window as W).Capacitor;
  });

  it("queues app.start for this build and app.exit.* for the build that crashed, and sends at once", async () => {
    localStorage.setItem("s2.exit.since", "100");
    localStorage.setItem("s2.exit.build", "v1132");
    (window as W).Capacitor = {
      getPlatform: () => "android",
      Plugins: {
        App: { getInfo: async () => ({ build: "1133" }) },
        ExitInfo: { recent: async () => ({ supported: true, exits: [{ reason: "crash_native", timestamp: 200, foreground: true }, { reason: "low_memory", timestamp: 300, foreground: true }] }) },
      },
    };
    const t = await import("@/lib/telemetry");
    t.installTelemetry();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    const sent = (rpc.mock.calls as unknown as [string, { _events: { metric: string; app_build: string; kind: string }[] }][])
      .flatMap(([, a]) => a._events);
    expect(sent).toContainEqual(expect.objectContaining({ kind: "session", metric: "app.start", app_build: "v1133" }));
    expect(sent).toContainEqual(expect.objectContaining({ kind: "session", metric: "app.exit.crash_native", app_build: "v1132", platform: "android" }));
    expect(sent).toContainEqual(expect.objectContaining({ kind: "session", metric: "app.exit.low_memory", app_build: "v1132" }));
    expect(localStorage.getItem("s2.exit.build")).toBe("v1133");
  });

  it("web (even with an ExitInfo object present): the exit reader is never asked, only app.start is queued", async () => {
    const recent = vi.fn(async () => ({ supported: true, exits: [{ reason: "crash", timestamp: 200 }] }));
    localStorage.setItem("s2.exit.since", "100");
    (window as W).Capacitor = { getPlatform: () => "web", Plugins: { ExitInfo: { recent } } };
    const t = await import("@/lib/telemetry");
    t.installTelemetry();
    await new Promise((r) => setTimeout(r, 20));
    expect(recent).not.toHaveBeenCalled();
    expect(t.__telemetryQueue().map((e) => e.metric)).toEqual(["app.start"]);
  });
});
