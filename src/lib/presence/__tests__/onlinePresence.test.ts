/**
 * THE GREEN DOT: WHAT REACHES THE WIRE, AND WHAT NEVER DOES.
 *
 * `docs/gates/P1-interface.md` §1 is the frozen contract. Two of its clauses are
 * the reason this file exists rather than a screenshot:
 *
 *   PRIVACY (added by R-62) — "a client whose own privacy_settings->>
 *   'active_status' = 'off' never calls track(). If the member turns it off
 *   mid-session: untrack() immediately. If they turn it on: track()."
 *
 *   FAILURE — "channel error or disconnect -> isOnline returns false (fail to
 *   'not online'). It never throws and never blocks render."
 *
 * Both are statements about ABSENCE. "The dot did not appear" is not evidence:
 * a dot can fail to appear because the member is hidden, because the channel is
 * down, or because the component was never rendered. So these assertions read
 * the calls made on the channel itself — `track` was or was not invoked — which
 * is the only place the privacy rule is actually enforced.
 *
 * ── C-34 MUTATION RECORD ─────────────────────────────────────────────────────
 * Each assertion below was shown red against an implementation carrying exactly
 * its own defect. The run is committed at
 * `docs/evidence/d2/phase2/p1-client-mutation-record.md`:
 *
 *   MUTANT A  drop `!selfVisible` from trackSelf()      → privacy tests red
 *   MUTANT B  setOwnActiveStatusVisible ignores `false` → mid-session-off red
 *   MUTANT C  publish(presenceState) on CHANNEL_ERROR   → fail-to-offline red
 *   MUTANT D  usePresenceOnline ignores the fetched preference → wiring red
 *   MUTANT E  track() before SUBSCRIBED                 → ordering assertion red
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const hub = vi.hoisted(() => ({
  name: "",
  opts: null as unknown,
  handlers: {} as Record<string, () => void>,
  subscribeCb: null as ((status: string) => void) | null,
  presence: {} as Record<string, unknown[]>,
  track: vi.fn(),
  untrack: vi.fn(),
  removed: 0,
  /** What the profiles read returns for the member's own privacy_settings. */
  privacy: null as Record<string, unknown> | null,
  profileSelects: 0,
  auth: { id: null as string | null },
}));

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({
    user: hub.auth.id ? { id: hub.auth.id } : null,
    session: null,
    loading: false,
    signOut: async () => {},
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel: Record<string, unknown> = {};
  Object.assign(channel, {
    on: (_kind: string, filter: { event: string }, cb: () => void) => {
      hub.handlers[filter.event] = cb;
      return channel;
    },
    subscribe: (cb: (status: string) => void) => {
      hub.subscribeCb = cb;
      return channel;
    },
    track: hub.track,
    untrack: hub.untrack,
    presenceState: () => hub.presence,
  });
  return {
    supabase: {
      channel: (name: string, opts: unknown) => {
        hub.name = name;
        hub.opts = opts;
        return channel;
      },
      removeChannel: () => {
        hub.removed += 1;
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              hub.profileSelects += 1;
              return { data: { privacy_settings: hub.privacy }, error: null };
            },
          }),
        }),
      }),
    },
  };
});

const online = await import("@/lib/presence/online");

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

/** Brings the channel up exactly the way supabase-js does. */
function subscribed() {
  hub.subscribeCb?.("SUBSCRIBED");
}

let teardown: (() => void) | null = null;

beforeEach(() => {
  hub.handlers = {};
  hub.subscribeCb = null;
  hub.presence = {};
  hub.track.mockReset().mockResolvedValue("ok");
  hub.untrack.mockReset().mockResolvedValue("ok");
  hub.removed = 0;
  hub.privacy = null;
  hub.profileSelects = 0;
  hub.auth.id = null;
});

afterEach(() => {
  if (teardown) teardown();
  teardown = null;
  online.disconnectPresence();
});

describe("P1 §1 PRIVACY — a hidden member is never announced", () => {
  it("never calls track() when the member's own active_status is off", () => {
    teardown = online.connectPresence(ME, { visible: false });
    subscribed();

    expect(
      hub.track,
      "the channel announced a member who has hidden their active status. The " +
        "privacy rule is not a display filter — once track() has been called, " +
        "every other client on the channel has the fact.",
    ).not.toHaveBeenCalled();
  });

  it("still lets that member see everyone else — hiding is not blinding", () => {
    teardown = online.connectPresence(ME, { visible: false });
    hub.presence = { [THEM]: [{ u: THEM }] };
    subscribed();

    expect(online.isOnline(THEM)).toBe(true);
    expect(online.isOnline(ME), "a member who never tracked cannot be online").toBe(false);
  });

  it("untracks immediately when the member turns it off mid-session", () => {
    teardown = online.connectPresence(ME, { visible: true });
    subscribed();
    expect(hub.track).toHaveBeenCalledTimes(1);

    online.setOwnActiveStatusVisible(false);

    expect(
      hub.untrack,
      "turning the setting off left the member announced for the rest of the " +
        "session, immediately after telling them it was saved.",
    ).toHaveBeenCalledTimes(1);
  });

  it("tracks again when the member turns it back on", () => {
    teardown = online.connectPresence(ME, { visible: false });
    subscribed();
    expect(hub.track).not.toHaveBeenCalled();

    online.setOwnActiveStatusVisible(true);

    expect(hub.track).toHaveBeenCalledTimes(1);
    expect(hub.track).toHaveBeenCalledWith({ u: ME });
  });

  it("reads the setting the way the database does: absent means on", () => {
    expect(online.activeStatusVisible(null)).toBe(true);
    expect(online.activeStatusVisible({})).toBe(true);
    expect(online.activeStatusVisible({ active_status: "on" })).toBe(true);
    expect(online.activeStatusVisible({ active_status: "off" })).toBe(false);
    // Not a string, not "off" — the migrations COALESCE(ps->>'active_status','on').
    expect(online.activeStatusVisible({ active_status: 1 as unknown as string })).toBe(true);
  });
});

describe("P1 §1 — the channel", () => {
  it("is one channel, named as the interface names it, keyed on the user id", () => {
    teardown = online.connectPresence(ME, { visible: true });
    expect(hub.name).toBe("presence:online");
    expect(hub.opts).toEqual({ config: { presence: { key: ME } } });
  });

  it("announces only after SUBSCRIBED, never before", () => {
    teardown = online.connectPresence(ME, { visible: true });
    expect(
      hub.track,
      "track() was called before the channel was up. supabase-js drops it, and " +
        "the member is then silently absent for the whole session.",
    ).not.toHaveBeenCalled();

    subscribed();
    expect(hub.track).toHaveBeenCalledTimes(1);
  });

  it("reports the members in presenceState, and nobody else", () => {
    teardown = online.connectPresence(ME, { visible: true });
    hub.presence = { [ME]: [{ u: ME }], [THEM]: [{ u: THEM }] };
    subscribed();

    expect(online.isOnline(ME)).toBe(true);
    expect(online.isOnline(THEM)).toBe(true);
    expect(online.isOnline("33333333-3333-4333-8333-333333333333")).toBe(false);
    expect(online.onlineUserIds().size).toBe(2);
  });

  it("re-reads on join and on leave, not only on the first sync", () => {
    teardown = online.connectPresence(ME, { visible: true });
    hub.presence = { [ME]: [{ u: ME }] };
    subscribed();
    expect(online.isOnline(THEM)).toBe(false);

    hub.presence = { [ME]: [{ u: ME }], [THEM]: [{ u: THEM }] };
    hub.handlers["join"]?.();
    expect(online.isOnline(THEM)).toBe(true);

    hub.presence = { [ME]: [{ u: ME }] };
    hub.handlers["leave"]?.();
    expect(online.isOnline(THEM)).toBe(false);
  });
});

describe("P1 §1 — every failure ends in 'not online'", () => {
  it("empties the set on CHANNEL_ERROR", () => {
    teardown = online.connectPresence(ME, { visible: true });
    hub.presence = { [THEM]: [{ u: THEM }] };
    subscribed();
    expect(online.isOnline(THEM)).toBe(true);

    hub.subscribeCb?.("CHANNEL_ERROR");

    expect(
      online.isOnline(THEM),
      "a broken channel left the last known state on screen. A stale green dot " +
        "is worse than no dot: nothing tells the reader it stopped being true.",
    ).toBe(false);
  });

  it("empties the set on TIMED_OUT and on CLOSED", () => {
    for (const status of ["TIMED_OUT", "CLOSED"]) {
      online.disconnectPresence();
      teardown = online.connectPresence(ME, { visible: true });
      hub.presence = { [THEM]: [{ u: THEM }] };
      subscribed();
      expect(online.isOnline(THEM)).toBe(true);
      hub.subscribeCb?.(status);
      expect(online.isOnline(THEM), `${status} did not fail to offline`).toBe(false);
    }
  });

  it("survives a presenceState that throws", () => {
    teardown = online.connectPresence(ME, { visible: true });
    Object.defineProperty(hub, "presence", {
      configurable: true,
      get() {
        throw new Error("socket went away mid-read");
      },
    });
    expect(() => subscribed()).not.toThrow();
    expect(online.isOnline(THEM)).toBe(false);
    Object.defineProperty(hub, "presence", { configurable: true, value: {}, writable: true });
  });

  it("answers false, and does not throw, when no channel was ever opened", () => {
    online.disconnectPresence();
    expect(online.isOnline(THEM)).toBe(false);
    expect(online.isOnline(null)).toBe(false);
    expect(online.isOnline(undefined)).toBe(false);
  });

  it("leaves the channel on teardown", () => {
    const stop = online.connectPresence(ME, { visible: true });
    subscribed();
    stop();
    expect(hub.removed).toBeGreaterThanOrEqual(1);
    expect(online.isOnline(ME)).toBe(false);
  });
});

describe("P1 §1 — the hook that mounts it reads the member's own setting", () => {
  /* The rule is only as good as the wiring. `connectPresence(id, {visible:false})`
   * behaving correctly proves nothing if the one caller in the app never passes
   * `false` — which is exactly the shape a privacy bug takes in practice. */
  it("passes visible:false through when active_status is off, so track() never happens", async () => {
    hub.auth.id = ME;
    hub.privacy = { active_status: "off" };

    const view = renderHook(() => online.usePresenceOnline());
    await waitFor(() => expect(hub.subscribeCb).not.toBeNull());
    subscribed();

    expect(hub.profileSelects, "the hook never read the member's privacy setting").toBe(1);
    expect(hub.track).not.toHaveBeenCalled();

    view.unmount();
  });

  it("announces the member when the setting is absent — the database default is on", async () => {
    hub.auth.id = ME;
    hub.privacy = null;

    const view = renderHook(() => online.usePresenceOnline());
    await waitFor(() => expect(hub.subscribeCb).not.toBeNull());
    subscribed();

    expect(hub.track).toHaveBeenCalledWith({ u: ME });

    view.unmount();
  });

  it("opens no channel at all for a signed-out visitor", async () => {
    hub.auth.id = null;

    const view = renderHook(() => online.usePresenceOnline());
    await waitFor(() => expect(hub.profileSelects).toBe(0));

    expect(hub.subscribeCb, "a signed-out visitor is shown no dots and needs no socket").toBeNull();
    expect(online.isOnline(THEM)).toBe(false);

    view.unmount();
  });
});

describe("P1 §5 — the client no longer writes presence", () => {
  const ROOT = process.cwd();

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "test-utils" || name === "uiharness") continue;
        sources(full, out);
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }

  /* Comments are stripped, and that is not cosmetic: this very file and
   * `useLastActive.ts` both EXPLAIN what was deleted, in prose that contains the
   * words being searched for. A scan that reads its own explanation as a
   * violation is an instrument that cannot be used to document anything. */
  const FILES = sources(join(ROOT, "src")).map((f) => ({
    path: relative(ROOT, f).split(sep).join("/"),
    code: stripComments(readFileSync(f, "utf8")),
  }));

  it("writes last_active_at from nowhere in src/**", () => {
    /* A WRITE TO `profiles`, and both halves of that matter.
     *
     * Not a read: `select("id, last_active_at, last_platform")`,
     * `formatLastSeen(u.last_active_at)` and the row TYPES that carry the field
     * are all §4 and must keep working. So this looks only inside the argument of
     * an `update` / `upsert` / `insert`.
     *
     * And not any table: `user_devices` has its own `last_active_at`, written by
     * `useUserDevices.ts`, which is the member's signed-in-device list and has
     * nothing to do with presence. A scan that flagged it would be demanding a
     * change to an unrelated feature to stay green. */
    const offenders = FILES.filter(({ code }) =>
      [...code.matchAll(/from\(\s*["'`]profiles["'`][\s\S]{0,600}/g)].some((m) => {
        const window = m[0].slice(0, 600);
        return (
          /\.(update|upsert|insert)\(/.test(window) &&
          /last_active_at|last_platform/.test(window)
        );
      }),
    ).map((f) => f.path);

    expect(
      offenders,
      "P1 §5: 'No client code writes profiles.last_active_at or " +
        "profiles.last_platform.' The database writes both, in " +
        "record_session_end(_platform), and the two-tab rule resolves there.",
    ).toEqual([]);
  });

  it("has no client timer pointed at profiles", () => {
    const offenders = FILES.filter(({ code }) =>
      /startVisibilityInterval|useVisibilityInterval|setInterval/.test(code) &&
      /from\("profiles"\)/.test(code),
    ).map((f) => f.path);

    expect(
      offenders,
      "P1 §5: 'There is no client timer that touches profiles.'",
    ).toEqual([]);
  });

  it("calls record_session_end with the platform, and nothing else does the job", () => {
    const sessionEnd = FILES.filter(({ code }) => code.includes('"record_session_end"'));
    expect(sessionEnd.map((f) => f.path)).toEqual(["src/hooks/core/useSessionEnd.ts"]);
    expect(sessionEnd[0].code).toMatch(/_platform:\s*isNativeCapacitorApp\(\)\s*\?\s*"app"\s*:\s*"web"/);
    // The owner's app/web column still has to be filled, and it is filled by the
    // same call — not guessed from client_errors, which is not a sign-in record.
    expect(sessionEnd[0].code).not.toMatch(/from\s+["']@capacitor\//);
  });

  it("derives the dot from isOnline everywhere, and from a timestamp nowhere", () => {
    const offenders = FILES.filter(({ code }) => /isActiveNow\s*\(/.test(code)).map((f) => f.path);
    expect(
      offenders,
      "P1 §4: 'The green dot uses isOnline(userId), never " +
        "isActiveNow(last_active_at).' isActiveNow is deleted, so any caller is " +
        "either a compile error or a reintroduction.",
    ).toEqual([]);
  });
});
