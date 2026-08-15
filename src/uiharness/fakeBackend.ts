/**
 * A DETERMINISTIC FAKE BACKEND, so the REAL screens can be photographed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. The first version of the harness could only mount leaf
 * components with invented props — a grid, a toggle, a composer. That is a
 * genuine improvement over shipping blind, but it leaves the gap the owner
 * pointed straight at: **the screens a member actually opens were still never
 * looked at.** A component can be perfect in isolation and wrong on the page
 * that hosts it — wrong spacing under a real header, a bar that lands under the
 * navigation, a heading that wraps only when the real translated string is used.
 *
 * A real page cannot render here for two reasons, and this file removes both:
 *
 *  1. **It fetches.** Every page reads Supabase on mount. This container has no
 *     route to supabase.co at all, so the page would render its loading state
 *     for ever and the screenshot would be a spinner.
 *  2. **It needs a session.** Anything behind sign-in redirects to /login.
 *
 * WHAT IT DOES: replaces `window.fetch` and `window.WebSocket` before any app
 * module is imported, and answers Supabase's REST, RPC, auth and storage
 * shapes from fixed rows. Nothing leaves the machine, and two runs of the same
 * scene produce the same pixels — which is the whole point, because a
 * comparison that changes on its own is not a comparison.
 *
 * ⚠ THE MOST IMPORTANT RULE IN THIS FILE: **an unmatched request is LOUD.**
 *
 * The obvious shortcut — answer everything with `[]` — is the single most
 * dangerous thing this harness could do, because a screen starved of data
 * renders its EMPTY state, an empty state looks tidy, and a tidy screenshot
 * reads as "checked". The sweep would report zero problems for a page that in
 * production shows a hundred posts. So every request without a fixture is
 * reported to the console, which `tools/uishot/capture.mjs` already counts as
 * a problem, and pushed onto `window.__harnessUnmatched` so a scene can also
 * fail loudly on screen.
 *
 * WHAT IT IS NOT: an emulator. It proves LAYOUT — that the real components,
 * with realistic data, at 360px, do not collide, clip or overflow. It proves
 * nothing about whether the real query returns those rows. That distinction is
 * the whole of docs/ui-checking-policy.md and it does not move.
 *
 * IMPORTS NOTHING FROM THE APP, deliberately: it must be installed before the
 * Supabase client module is evaluated, and an app import here would be hoisted
 * above the installation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> };

export interface FakeRequest {
  method: string;
  /** Path only, e.g. "/rest/v1/posts" or "/rest/v1/rpc/get_feed". */
  path: string;
  params: URLSearchParams;
  body: unknown;
}

export type FakeRoute = (req: FakeRequest) => FakeReply | undefined;

/** Every request this run could not answer. Read by scenes and by the sweep. */
export const unmatched: string[] = [];

/**
 * The session the harness signs in as. A real-shaped JWT is not needed —
 * nothing here verifies a signature — but the CLAIMS are read by the app
 * (`sub` becomes the user id all over the UI), so they must be consistent.
 */
export const HARNESS_USER_ID = "11111111-1111-4111-8111-111111111111";
export const HARNESS_EMAIL = "harness@50mmretina.test";

/**
 * A token that expires far in the future, so `@supabase/auth-js` never decides
 * to refresh mid-screenshot and swap a rendered screen for a loading one.
 * 4102444800 = 2100-01-01. Fixed, never `Date.now()`, so runs are comparable.
 */
const EXP = 4102444800;

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function harnessAccessToken(): string {
  return [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({
      sub: HARNESS_USER_ID,
      email: HARNESS_EMAIL,
      role: "authenticated",
      aud: "authenticated",
      exp: EXP,
      iat: 1750000000,
      session_id: "harness-session",
    }),
    "harness-not-a-real-signature",
  ].join(".");
}

export function harnessUser() {
  return {
    id: HARNESS_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: HARNESS_EMAIL,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    phone: "",
    confirmed_at: "2026-01-01T00:00:00.000Z",
    last_sign_in_at: "2026-08-15T09:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Avijit Sheel" },
    identities: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-08-15T09:00:00.000Z",
    is_anonymous: false,
  };
}

export function harnessSession() {
  return {
    access_token: harnessAccessToken(),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: EXP,
    refresh_token: "harness-refresh-token",
    user: harnessUser(),
  };
}

/**
 * SEED THE SESSION INTO STORAGE, not into a mocked auth object.
 *
 * `@supabase/auth-js` reads its session from `localStorage` under
 * `sb-<project-ref>-auth-token` at construction. Writing the row is therefore
 * the ONE intervention that makes the real `AuthProvider`, the real guards and
 * the real `useAuth()` consumers all behave exactly as they do for a signed-in
 * member — with no app code changed and no provider replaced. Anything else
 * would be testing a different app from the one that ships.
 */
function seedSession(projectRef: string, signedIn: boolean) {
  const key = `sb-${projectRef}-auth-token`;
  try {
    if (!signedIn) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(harnessSession()));
  } catch {
    /* a browser with storage disabled: the scene will render signed-out, and
       that is visible in the screenshot rather than hidden in a throw. */
  }
}

/**
 * THE TWO STORED DECISIONS A MEMBER HAS ALREADY MADE.
 *
 * Both were found by looking at the first real-screen screenshot, and both had
 * the same effect: an overlay covering the screen under inspection.
 *
 *  • **Cookie consent.** The banner is real and correct — but it is modal-ish
 *    chrome that would sit over EVERY screen in every run, and a screenshot of
 *    the banner is not a screenshot of the feed. Seeded as already answered,
 *    and the banner keeps its own scene so it is still looked at.
 *  • **Onboarding.** `Layout` caches "this member has finished onboarding" in
 *    sessionStorage. Seeding it is belt-and-braces alongside the profile
 *    columns; without either, every signed-in screen photographs the
 *    "Let's set up your profile" modal instead of the screen.
 *
 * Seeded as STORAGE, not as a patched component, for the same reason the
 * session is: it leaves the real providers running the real code paths.
 */
function seedMemberDecisions(userId: string, consent: boolean) {
  try {
    if (consent) {
      localStorage.setItem(
        "cookie_consent",
        // A fixed timestamp: "now" would make two runs differ, and the loader
        // rejects the row outright if `timestamp` is missing.
        JSON.stringify({ essential: true, analytics: false, marketing: false, timestamp: 1755000000000 }),
      );
    } else {
      localStorage.removeItem("cookie_consent");
    }
    sessionStorage.setItem(`onboarding_done_${userId}`, "true");
  } catch {
    /* storage disabled: the overlays appear, and that is visible in the shot */
  }
}

/** Project ref out of the configured URL, so nothing is hard-coded twice. */
function projectRefFrom(url: string): string {
  const m = /^https?:\/\/([^.]+)\./.exec(url);
  return m ? m[1] : "unknown";
}

function isSupabase(url: string, base: string): boolean {
  return url.startsWith(base) || /\.supabase\.(co|in)\//.test(url) || url.startsWith("/rest/v1/");
}

function jsonResponse(reply: FakeReply): Response {
  const status = reply.status ?? 200;
  const body = reply.body === undefined ? null : JSON.stringify(reply.body);
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // PostgREST sends this for range requests; supabase-js reads it for
      // `count`, and its absence makes a paginated list render as "0 of 0".
      "content-range": "0-0/*",
      ...(reply.headers ?? {}),
    },
  });
}

export interface InstallOptions {
  /** Answer app queries. First route to return a reply wins. */
  routes?: FakeRoute[];
  /** false renders the signed-out app — which is how /login is photographed. */
  signedIn?: boolean;
  /** false leaves the cookie banner up, for the scene that photographs IT. */
  consented?: boolean;
}

let installed = false;

export function installFakeBackend(opts: InstallOptions = {}): void {
  if (installed) return;
  installed = true;

  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://example.supabase.co";
  const ref = projectRefFrom(base);
  const routes = opts.routes ?? [];
  seedSession(ref, opts.signedIn !== false);
  seedMemberDecisions(HARNESS_USER_ID, opts.consented !== false);

  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (!isSupabase(url, base)) return realFetch(input as RequestInfo, init);

    let u: URL;
    try {
      /**
       * A FIXED base, not `window.location.origin`.
       *
       * Only the path and the query are read below — the origin is never used
       * and never leaves this function. Using `window.location.origin` would
       * make this file the one exception in `publicUrl.test.ts`'s census of
       * "nothing builds an outgoing url from the current origin", and an
       * allowlist entry for the harness is exactly the kind of hole that later
       * gets pointed at as precedent. A constant costs nothing and keeps the
       * census absolute.
       */
      u = new URL(url, "http://harness.invalid");
    } catch {
      return realFetch(input as RequestInfo, init);
    }
    const path = u.pathname;

    let body: unknown = undefined;
    const raw = init?.body;
    if (typeof raw === "string") {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }

    // ── Auth. Answered here rather than by a route, because every scene needs
    //    the same answers and getting them wrong signs the harness out.
    if (path.startsWith("/auth/v1/")) {
      if (path.endsWith("/user")) return jsonResponse({ body: harnessUser() });
      if (path.endsWith("/token")) return jsonResponse({ body: harnessSession() });
      if (path.endsWith("/logout")) return jsonResponse({ status: 204 });
      return jsonResponse({ body: {} });
    }

    // ── Storage. Never reached for reads (image urls are data: swatches), but
    //    an upload in a scene must not hit the network.
    if (path.startsWith("/storage/v1/")) {
      return jsonResponse({ body: { Key: "harness/object.jpg", path: "harness/object.jpg" } });
    }

    const req: FakeRequest = { method, path, params: u.searchParams, body };
    for (const route of routes) {
      const reply = route(req);
      if (reply) return jsonResponse(reply);
    }

    // ── NO FIXTURE. Say so, at the top of its voice. See the header comment:
    //    answering [] quietly is how a half-empty screen passes for a checked
    //    one. The sweep counts console errors as problems, so this fails the
    //    gate rather than decorating it.
    const desc = `${method} ${path}${u.search ? "?" + u.searchParams.toString().slice(0, 120) : ""}`;
    unmatched.push(desc);
    (window as unknown as { __harnessUnmatched?: string[] }).__harnessUnmatched = unmatched;
    console.error(`[harness] NO FIXTURE for ${desc} — this screen is rendering with missing data`);
    return jsonResponse({ body: [] });
  };

  /**
   * REALTIME. `supabase.channel(...)` opens a websocket the moment a hook
   * subscribes. Without this the console fills with connection failures that
   * have nothing to do with the UI, and — worse — the retry loop keeps the
   * page from ever reaching Playwright's `networkidle`, so the screenshot is
   * taken of a half-mounted screen. A socket that connects and stays silent is
   * exactly what a screenshot wants.
   */
  const RealWS = window.WebSocket;
  class HarnessSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 1;
    url: string;
    onopen: ((e: Event) => void) | null = null;
    onclose: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      // Asynchronously, so a caller that assigns .onopen after construction
      // still hears it — the ordering a real socket guarantees.
      setTimeout(() => {
        const e = new Event("open");
        this.onopen?.(e);
        this.dispatchEvent(e);
      }, 0);
    }
    send(): void { /* swallowed: nothing is listening */ }
    close(): void {
      this.readyState = 3;
      const e = new Event("close");
      this.onclose?.(e);
      this.dispatchEvent(e);
    }
  }
  window.WebSocket = new Proxy(RealWS, {
    construct(target, args: [string | URL, ...unknown[]]) {
      const url = String(args[0] ?? "");
      if (/supabase\.(co|in)|realtime\/v1/.test(url)) {
        return new HarnessSocket(url) as unknown as WebSocket;
      }
      return Reflect.construct(target, args) as WebSocket;
    },
  });
}
