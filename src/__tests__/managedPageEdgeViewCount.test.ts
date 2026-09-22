/**
 * R-16 · THE MANAGED-PAGE VIEW COUNTER NOW RUNS AT THE EDGE, WITH service_role.
 *
 * ⚠ NOT A SOURCE-CODE ASSERTION. This imports the real Pages Function from
 * functions/page/[slug].ts and invokes its `onRequest` the way Cloudflare does.
 * Only the socket and the Workers-only `HTMLRewriter` global are stubbed. The
 * assertions read the request that actually left the function.
 *
 * WHY IT EXISTS. `increment_managed_page_view` was called from the visitor's
 * own client, which is the only reason its grant had to be open to `anon`. The
 * client call is gone; this route counts instead. The properties that make the
 * withdrawal safe are the properties pinned here:
 *
 *   · the increment goes out under the lane's service-role key, NOT the anon
 *     key — an anon-keyed call would be the withdrawn grant back by hand;
 *   · a lane with no service-role key records nothing and says so loudly,
 *     rather than stopping silently, which is the failure mode this whole
 *     move exists to avoid;
 *   · nothing the counter does can stop the visitor getting the page.
 *
 * SEQUENCING, recorded so it is not lost: this must be live on staging BEFORE
 * D1 revokes `anon` on the function. Reversed, the counter stops in silence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequest } from "../../functions/page/[slug]";
import { serviceRoleKey } from "../../functions/_seo";

const ENV = {
  SUPABASE_PROJECT_REF: "stgabcdefghijklmnopq",
  SUPABASE_ANON_KEY: "staging-anon-key",
  SITE_ORIGIN: "https://staging.50mmretina.com",
  SUPABASE_SERVICE_ROLE_KEY: "staging-service-role-key",
};

const PAGE = {
  id: "8f1d2c3b-4444-4555-8666-777777777777",
  slug: "privacy-policy",
  title: "Privacy Policy",
  content: "<p>What we collect.</p>",
  meta_title: "Privacy Policy",
  meta_description: "What we collect.",
  og_image: "",
  json_ld: "",
  is_published: true,
  noindex: false,
};

const INCREMENT_PATH = "/rest/v1/rpc/increment_managed_page_view";

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };
let sent: Sent[] = [];
/** Set to make the increment request reject, as a dead network would. */
let incrementThrows = false;

function headerBag(raw: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Headers) raw.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(raw)) for (const [k, v] of raw) out[String(k).toLowerCase()] = String(v);
  else for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = String(v);
  return out;
}

const socket: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  let body: unknown = null;
  try { body = init?.body ? JSON.parse(init.body as string) : null; } catch { /* not json */ }
  sent.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers: headerBag(init?.headers), body });

  if (url.includes(INCREMENT_PATH)) {
    if (incrementThrows) throw new Error("network down");
    return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/rest/v1/site_settings")) {
    return new Response(JSON.stringify([{ value: [PAGE] }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  // The SPA shell.
  return new Response("<html><head><title>x</title></head><body></body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

/** The Workers-only global, reduced to the three calls renderSeo makes of it. */
class StubHTMLRewriter {
  on() { return this; }
  transform(response: Response) { return response; }
}

/** Collects what the function hands to waitUntil, so the test can await it. */
function makeContext(slug: string, env: Record<string, string>) {
  const deferred: Promise<unknown>[] = [];
  return {
    ctx: {
      env,
      params: { slug },
      request: new Request(`https://staging.50mmretina.com/page/${slug}`),
      next: async () => new Response("next", { status: 200 }),
      waitUntil: (p: Promise<unknown>) => { deferred.push(p); },
    },
    settled: () => Promise.all(deferred),
  };
}

const increments = () => sent.filter((r) => r.url.includes(INCREMENT_PATH));

let realFetch: typeof fetch;
let errorSpy: ReturnType<typeof vi.spyOn>;
const LOG_PREFIX = "[managed-page-view]";
const counterErrors = () =>
  errorSpy.mock.calls.filter((args) => String(args[0]).startsWith(LOG_PREFIX));

beforeEach(() => {
  sent = [];
  incrementThrows = false;
  realFetch = globalThis.fetch;
  globalThis.fetch = socket;
  (globalThis as any).HTMLRewriter = StubHTMLRewriter;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as any).HTMLRewriter;
  errorSpy.mockRestore();
});

describe("functions/page/[slug].ts — the view counter at the edge", () => {
  it("counts a published page once, as service_role", async () => {
    const { ctx, settled } = makeContext(PAGE.slug, ENV);

    await onRequest(ctx);
    await settled();

    const [hit, ...extra] = increments();
    expect(hit, "no increment request was sent").toBeDefined();
    expect(extra).toHaveLength(0);
    expect(hit.method).toBe("POST");
    expect(hit.body).toEqual({ _page_id: PAGE.id });
    expect(hit.headers["authorization"]).toBe(`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    expect(hit.headers["apikey"]).toBe(ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(counterErrors()).toHaveLength(0);
  });

  it("never sends the increment under the anon key", async () => {
    // The anon grant is the thing being withdrawn. An anon-keyed increment
    // here would be that grant back under another name.
    const { ctx, settled } = makeContext(PAGE.slug, ENV);

    await onRequest(ctx);
    await settled();

    for (const hit of increments()) {
      expect(hit.headers["apikey"]).not.toBe(ENV.SUPABASE_ANON_KEY);
      expect(hit.headers["authorization"]).not.toContain(ENV.SUPABASE_ANON_KEY);
    }
  });

  it("records nothing and says so loudly when the lane has no service-role key", async () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omitted, ...noKey } = ENV;
    const { ctx, settled } = makeContext(PAGE.slug, noKey);

    const res = await onRequest(ctx);
    await settled();

    expect(increments()).toHaveLength(0);
    // A silent stop is the failure this whole move exists to avoid.
    expect(counterErrors()).toHaveLength(1);
    expect(String(counterErrors()[0][0])).toMatch(/SUPABASE_SERVICE_ROLE_KEY is not set/);
    // and the visitor still gets the page
    expect(res.status).toBe(200);
  });

  it("does not count a slug that resolves to no published page", async () => {
    const { ctx, settled } = makeContext("no-such-page", ENV);

    await onRequest(ctx);
    await settled();

    expect(increments()).toHaveLength(0);
    expect(counterErrors()).toHaveLength(0);
  });

  it("serves the page even when the increment fails outright", async () => {
    incrementThrows = true;
    const { ctx, settled } = makeContext(PAGE.slug, ENV);

    const res = await onRequest(ctx);
    await settled();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(counterErrors()).toHaveLength(1);
    expect(String(counterErrors()[0][0])).toMatch(/increment failed: network down/);
  });
});

describe("functions/_seo.ts — serviceRoleKey is deliberately not laneValue()", () => {
  it("returns null rather than throwing when the lane omits it", () => {
    // The three required readers throw on absence because a wrong origin is
    // unrecoverable. This one must not: a missing counter key is not a reason
    // to stop serving a public page.
    expect(serviceRoleKey(undefined)).toBeNull();
    expect(serviceRoleKey({})).toBeNull();
    expect(serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "   " })).toBeNull();
    expect(serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: " k " })).toBe("k");
  });

  it("never falls back to the anon key", () => {
    expect(serviceRoleKey({ SUPABASE_ANON_KEY: "anon" } as never)).toBeNull();
  });
});
