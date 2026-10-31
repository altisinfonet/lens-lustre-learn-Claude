import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn(async (..._a: unknown[]) => ({ error: null }));
const getSession = vi.fn(async () => ({ data: { session: { user: { id: "u" } } } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => getSession() } },
}));

import {
  normaliseRoute, hashMessage, recordTiming, recordError, recordRealtime,
  flushTelemetry, __telemetryQueue, __resetTelemetry,
} from "@/lib/telemetry";

describe("S2-A telemetry", () => {
  beforeEach(() => { __resetTelemetry(); rpc.mockClear(); });

  it("reduces a route to a known first segment, never an id or a username", () => {
    expect(normaliseRoute("/post/7c1e-uuid?x=1")).toBe("/post/:x");
    expect(normaliseRoute("/feed")).toBe("/feed");
    expect(normaliseRoute("/someones-custom-url")).toBe("/other");
    expect(normaliseRoute("/")).toBe("/");
  });

  it("hashes error messages: 8 hex, numbers/ids/quoted values ignored, no text kept", () => {
    const h = hashMessage("Cannot read 'abc@x.com' of undefined at 12");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashMessage("Cannot read 'other' of undefined at 99")).toBe(h);
  });

  it("records timings clamped, errors deduped (3 per hash), realtime minus CLOSED", () => {
    recordTiming("rpc.get_broadcast_feed", 1e9, true);
    for (let i = 0; i < 5; i++) recordError("onerror", new TypeError("boom"));
    recordRealtime("CLOSED");
    recordRealtime("TIMED_OUT");
    const q = __telemetryQueue();
    expect(q.filter((e) => e.kind === "timing")[0].duration_ms).toBe(600000);
    expect(q.filter((e) => e.kind === "error")).toHaveLength(3);
    expect(q.filter((e) => e.kind === "error")[0]).toMatchObject({ error_name: "TypeError" });
    expect(q.filter((e) => e.kind === "realtime").map((e) => e.metric)).toEqual(["realtime.timed_out"]);
    expect(JSON.stringify(q)).not.toContain("boom");
  });

  it("sends in batches of 50 when signed in; drops when signed out", async () => {
    for (let i = 0; i < 120; i++) recordTiming("post.open", 10, true);
    await flushTelemetry();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0][0]).toBe("record_client_telemetry");
    getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    recordTiming("post.open", 10, true);
    await flushTelemetry();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(__telemetryQueue()).toHaveLength(0);
  });
});
