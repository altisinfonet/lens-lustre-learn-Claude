/**
 * THE TEARDOWN RELEASE MUST GO OUT AS THE JUDGE, OR NOT GO OUT AT ALL.
 *
 * ⚠ NOT A SOURCE-CODE ASSERTION. This renders the REAL `useJudgingLock`, builds
 * a REAL supabase-js client for the lock it acquires, and stubs only the socket.
 * The assertions read the headers of the request that actually left the hook.
 *
 * WHY IT EXISTS. The unload release used to carry `apikey` and nothing else, so
 * PostgREST ran it as `anon`. PR #276 closes `release_judge_lock` to `anon`;
 * from the moment it lands, every one of those releases would return `42501`.
 * Nothing in the app would have reported it — the fetch is not awaited, the
 * `catch` was empty, and no test had ever run that line. A judge's lock would
 * simply have stopped being released, and the only visible trace would be a
 * round held for its full TTL after the judge had gone.
 *
 * So the three properties below are the unit. Each one was confirmed failing
 * against the pre-fix hook before it was allowed to pass (C-34); the run is
 * committed at docs/evidence/d2/phase1/unit1-c34-red.txt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";

const JUDGE_ID = "9f6f0a3e-1111-4222-8333-444444444444";
const ENTRY_ID = "1b2c3d4e-5555-4666-8777-888888888888";
const PHOTO_INDEX = 2;
const ACCESS_TOKEN = "header.judge-access-token.signature";

/** Every request that left the process, client or hook, in order. */
const sent = vi.hoisted(() => [] as { url: string; headers: Record<string, string> }[]);

/** The session the app's single auth subscription would be holding. */
const authState = vi.hoisted(() => ({ session: null as { access_token: string } | null }));

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({
    session: authState.session,
    user: null,
    loading: false,
    signOut: async () => {},
  }),
}));

/** The socket, and nothing above it. */
const socket: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const headers: Record<string, string> = {};
  const raw = init?.headers;
  if (raw) {
    if (typeof (raw as Headers).forEach === "function" && !Array.isArray(raw)) {
      // Headers instance (supabase-js) or a plain object (the hook).
      if (raw instanceof Headers) raw.forEach((v, k) => (headers[k.toLowerCase()] = v));
      else for (const [k, v] of Object.entries(raw as Record<string, string>)) headers[k.toLowerCase()] = v;
    } else {
      for (const [k, v] of Object.entries(raw as Record<string, string>)) headers[k.toLowerCase()] = v;
    }
  }
  sent.push({ url, headers });

  if (url.includes("/rpc/acquire_judge_lock")) {
    return new Response(JSON.stringify({ acquired: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: createClient("https://stub.supabase.co", "stub-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: socket },
  }),
}));

// Imported after the mocks so the hook picks them up.
const { useJudgingLock } = await import("@/hooks/judging/useJudgingLock");

/** The release requests only — the acquire is the client's, not the handler's. */
const releases = () => sent.filter((r) => r.url.includes("/rpc/release_judge_lock"));

function firePagehide(persisted: boolean) {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

/** Renders the hook and waits until it actually holds the lock. */
async function withHeldLock() {
  const view = renderHook(() => useJudgingLock(JUDGE_ID, ENTRY_ID, PHOTO_INDEX));
  await waitFor(() => expect(view.result.current.isLocked).toBe(true));
  return view;
}

let realFetch: typeof fetch;

beforeEach(() => {
  sent.length = 0;
  authState.session = { access_token: ACCESS_TOKEN };
  // The handler calls the global fetch directly, by design: `keepalive` has to
  // survive the client being torn down with the page.
  realFetch = globalThis.fetch;
  globalThis.fetch = socket;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("useJudgingLock — release on page teardown", () => {
  it("sends the release as the signed-in judge, not as anon", async () => {
    const view = await withHeldLock();

    firePagehide(false);

    const [release, ...extra] = releases();
    expect(release, "no release request was sent at teardown").toBeDefined();
    expect(extra).toHaveLength(0);
    expect(release.headers["authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
    // The publishable key still has to travel; it is not a substitute for the JWT.
    expect(release.headers["apikey"]).toBeTruthy();

    view.unmount();
  });

  it("sends nothing at all when there is no access token", async () => {
    const view = await withHeldLock();

    // The session went away — a refresh failed, or the member signed out in
    // another tab. An unauthenticated release is a request that will be
    // refused, and sending it would hide that behind a 403 nobody reads.
    authState.session = null;
    view.rerender();

    firePagehide(false);

    expect(releases()).toHaveLength(0);

    view.unmount();
  });

  it("sends nothing when the page is going into the back/forward cache", async () => {
    const view = await withHeldLock();

    // `persisted: true` means this page is coming back with its lock and its
    // heartbeat intact. Releasing here strands the judge on a lock the server
    // has already handed to someone else.
    firePagehide(true);

    expect(releases()).toHaveLength(0);

    view.unmount();
  });
});
