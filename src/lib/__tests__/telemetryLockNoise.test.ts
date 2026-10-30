/**
 * S11 drill finding · Firefox reports supabase-js's auth-lock contention as an
 * unhandled rejection: "Acquiring an exclusive Navigator LockManager lock
 * "lock:sb-…-auth-token" immediately failed". auth-js already handles it (the
 * token refresh tick catches `isAcquireTimeout` and simply tries next tick),
 * but Firefox also surfaces the lock callback's rejection. Every Firefox page
 * load — signed in or not — showed it in drills D2–D6 and the baseline, so it
 * was counted as a script error in client telemetry. It is not one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ error: null })) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

import { installTelemetry, __telemetryQueue, __resetTelemetry, isHandledAuthLockContention } from "@/lib/telemetry";

const lockError = () => Object.assign(new Error('Acquiring an exclusive Navigator LockManager lock "lock:sb-x-auth-token" immediately failed'), { name: "NavigatorLockAcquireTimeoutError", isAcquireTimeout: true });
const rejection = (reason: unknown) => {
  const ev = new Event("unhandledrejection") as Event & { reason: unknown; promise: Promise<unknown> };
  Object.assign(ev, { reason, promise: Promise.resolve() });
  window.dispatchEvent(ev);
};

describe("telemetry ignores handled auth-lock contention", () => {
  beforeEach(() => __resetTelemetry());

  it("recognises auth-js's documented isAcquireTimeout flag, nothing else", () => {
    expect(isHandledAuthLockContention(lockError())).toBe(true);
    expect(isHandledAuthLockContention(Object.assign(new Error("x"), { isAcquireTimeout: true }))).toBe(true);
    expect(isHandledAuthLockContention(new Error("Acquiring an exclusive Navigator LockManager lock immediately failed"))).toBe(false);
    expect(isHandledAuthLockContention(new TypeError("Failed to fetch"))).toBe(false);
    expect(isHandledAuthLockContention(null)).toBe(false);
  });

  it("an unhandled lock-contention rejection records nothing; a real one still does", () => {
    installTelemetry();
    rejection(lockError());
    expect(__telemetryQueue().filter((e) => e.kind === "error")).toHaveLength(0);
    rejection(new TypeError("boom"));
    expect(__telemetryQueue().filter((e) => e.kind === "error")).toHaveLength(1);
  });
});
