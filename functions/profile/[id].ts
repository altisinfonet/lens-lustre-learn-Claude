/// <reference path="../pages-runtime.d.ts" />
import { getShell, supabaseUrl, supabaseAnon, type SeoEnv } from "../_seo";

/**
 * F-92-REDO — /profile/<uuid> is answered HERE, before any HTML exists.
 *
 * The Owner's rule is that a member's internal id is never what a visitor is
 * SHOWN IN THE FIRST PLACE. The rejected first attempt satisfied a weaker rule
 * — "not what they are LEFT looking at" — with history.replaceState in the
 * React app, and the two are not the same. In that version the browser really
 * requested /profile/<uuid>, Cloudflare really served it, React mounted, the
 * profile query returned, and only then did the address change. The id was on
 * screen for the whole of boot plus one round trip: long enough to read,
 * screenshot or copy. Correcting the address afterwards also does nothing about
 * the entry already written to browser history, the origin's access log, or the
 * Referer header sent with every asset that page pulled.
 *
 * A redirect issued before the response body exists has none of those problems,
 * because there is no render to correct.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied: a Pages Function only
 * runs for a real HTTP request. An in-app <Link to={`/profile/${id}`}> is a
 * client-side navigation that never leaves the browser, so this cannot touch
 * it. That case needs the links themselves built from the handle — see
 * src/lib/urlHelpers.ts profileUrl(), which exists for exactly this and is used
 * at 2 of the 67 in-app profile links (both in Friends.tsx); the other 65,
 * across 29 files, hardcode `/profile/${id}`. Filed as F-95, not fixed here.
 * The EDGE-9101 counter below is how that number is watched.
 */

/**
 * ONE HOUR, AND WHY A PLAIN TTL IS SAFE HERE RATHER THAN SLOPPY.
 *
 * ⚠ THIS TTL AND custom_url_history ARE ONE DESIGN. DO NOT CHANGE EITHER ALONE.
 *
 * When a member renames — F-93 allows that once every 12 months — a cached
 * entry still points at their OLD name for up to an hour. That is survivable
 * only because custom_url_history keeps old names resolving: the visitor is
 * redirected to the old name, resolve_custom_url finds it in the history table,
 * and they land on the correct profile. What goes stale is CANONICALITY for an
 * hour, not correctness, and nobody sees an error. That is what buys a generous
 * TTL and lets us skip cache purging on rename entirely.
 *
 * If custom_url_history ever stopped resolving old names, this reasoning
 * collapses: a stale entry would then point at a dead URL and the member would
 * be unreachable for the rest of the hour. At that point the TTL is not enough
 * and this must become an explicit purge on rename. Anyone changing the history
 * behaviour has to change this too.
 */
const TTL_SECONDS = 3600;

/**
 * A miss costs one database read; a slow database must not cost the visitor a
 * blank tab. Past this the app is served immediately, and because a failed
 * lookup is never cached the next request simply tries again. A primary-key
 * read that cannot answer in a second is not going to answer usefully.
 */
const LOOKUP_TIMEOUT_MS = 1000;

// The column's own rule, from profiles_custom_url_format (20260728120000, added
// validated, with the pre-existing values verified compliant at the time).
// Reproduced rather than imported because a Pages Function has no build step.
const HANDLE = /^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stored in place of a handle for a member who has none. */
const NO_REDIRECT = "-";

/**
 * THIS IS THE OPEN-REDIRECT CONTROL, and it is the only one.
 *
 * The value goes straight into a Location header, so a row reading "//evil.com"
 * would send every visitor to that member's profile off-site. Requiring the
 * shape the column itself enforces rejects that, along with "https://evil.com",
 * "\\evil.com" and anything containing a slash, colon, backslash or whitespace
 * — none can match. The consecutive-dot test is separate because the character
 * class alone admits "x..y".
 *
 * A value failing here is not redirected to and is not an error: the app is
 * served exactly as today, which is the right answer for a row this function
 * does not recognise.
 */
function usableHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim();
  if (!HANDLE.test(handle) || handle.includes("..")) return null;
  return handle;
}

/**
 * Deliberately NOT _seo.ts's sbGet.
 *
 * sbGet collapses "no such member", "Supabase returned 500" and "the network
 * threw" all into null. That is fine for SEO meta, where every one of them
 * means "inject nothing". It is wrong here, because two of those are answers
 * worth caching for an hour and the third must never be cached at all — one bad
 * minute would otherwise poison that profile for the whole TTL. So this returns
 * a result that can tell them apart.
 */
type Lookup = { ok: true; handle: string | null } | { ok: false };

async function lookupHandle(id: string, env: SeoEnv | undefined): Promise<Lookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const anon = supabaseAnon(env); // throws on an unconfigured lane -> { ok:false }
    const res = await fetch(
      `${supabaseUrl(env)}/rest/v1/profiles_public_data` +
        `?id=eq.${encodeURIComponent(id)}&select=custom_url&limit=1`,
      { headers: { apikey: anon, authorization: `Bearer ${anon}` }, signal: controller.signal },
    );
    if (!res.ok) return { ok: false };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: false };
    // An empty result is a real answer — that id has no profile — and caching
    // it stops a bad or stale link costing a database read on every visit.
    if (rows.length === 0) return { ok: true, handle: null };
    return { ok: true, handle: usableHandle(rows[0]?.custom_url) };
  } catch {
    return { ok: false }; // abort, network, or unconfigured lane
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE COUNTER IS PER-ISOLATE, NOT GLOBAL — read it by counting lines, not by
 * reading `n`.
 *
 * Workers isolates are numerous and short-lived, so this resets constantly and
 * its value is only ever "this isolate's nth call". The rate comes from
 * counting EDGE-9101 lines in the Workers log over a window. `n` is here
 * because it makes a single isolate's traffic legible in a noisy log.
 *
 * Why the rate is the health check: every line means a real HTTP request for an
 * id URL, which means something handed a visitor that link. A high rate is not
 * a performance problem to tune away — it is the app still generating
 * /profile/<id> links (F-95). `ref` is the referring page, which is what turns
 * the number into a location in the code.
 */
let isolateCalls = 0;

/**
 * console.log rather than the app logger, and that is not a lapse from the
 * Owner's "never write console.log" rule. A Pages Function has no build step
 * and cannot import src/; the app logger writes to Supabase, which is a
 * database round trip this function exists to avoid. Workers logs ARE the
 * transport at the edge. EDGE-9101 is registered in src/lib/errorCodes.ts so
 * the code is not an unregistered invention, and its entry says plainly that
 * it lands in Cloudflare's log and never in the app's Error Log.
 */
function countFire(detail: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      code: "EDGE-9101",
      event: "PROFILE_ID_URL_REQUESTED",
      fn: "functions/profile/[id]",
      severity: "info",
      n: ++isolateCalls,
      ...detail,
    }),
  );
}

export const onRequest = async (context: any): Promise<Response> => {
  const request: Request = context.request;
  const url = new URL(request.url);

  // Serving the app answers every question this function cannot confidently
  // answer. A profile that 500s is far worse than one showing an id.
  const serveTheApp = () => getShell(request);

  if (request.method !== "GET" && request.method !== "HEAD") return serveTheApp();

  let id: string;
  try {
    id = decodeURIComponent(String(context.params?.id ?? ""));
  } catch {
    return serveTheApp(); // malformed percent-encoding — not ours to interpret
  }
  if (!UUID.test(id)) return serveTheApp();

  // [id] is reachable for deeper paths too, and /profile/<id>/photos is a
  // different page. Only the profile document itself is ours.
  if (url.pathname.replace(/\/+$/, "") !== `/profile/${id}`) return serveTheApp();

  // Past this point a visitor really did request an id URL, which is the thing
  // being counted. Everything above was some other request passing through.
  const referer = request.headers.get("referer") || "";

  const redirectTo = (handle: string, cache: "hit" | "miss") => {
    countFire({ cache, outcome: "redirect", ref: referer });
    // 302, NEVER 301. Under F-93 a handle can change once every 12 months, and
    // a 301 is cached by browsers indefinitely with no way to recall it — it
    // would keep sending visitors to a name the member has abandoned. no-store
    // stops any intermediary holding this hop either; the CACHE above is what
    // makes it cheap, and it is ours to expire.
    //
    // The Location is relative, so it stays on whichever lane served it and
    // this function never needs SITE_ORIGIN. The query string is carried across
    // (?section=wall names a real tab). The fragment is not, because a fragment
    // is never sent to a server — the browser reapplies the original one to the
    // redirect target itself.
    return new Response(null, {
      status: 302,
      headers: { Location: `/${handle}${url.search}`, "Cache-Control": "no-store" },
    });
  };

  // ---- cache ------------------------------------------------------------
  // Keyed on the id alone: the answer does not vary by query string, and
  // folding ?section=wall into the key would shard the cache for no gain.
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  let key: Request | null = null;
  if (cache) {
    const k = new URL(url.toString());
    k.pathname = `/__profile-handle/v1/${id}`;
    k.search = "";
    key = new Request(k.toString(), { method: "GET" });
    try {
      const stored = await cache.match(key);
      if (stored) {
        const cached = (await stored.text()).trim();
        if (cached === NO_REDIRECT) {
          // The negative answer is cached too, so a member with no handle does
          // not cost a database read on every single visit.
          countFire({ cache: "hit", outcome: "no-handle", ref: referer });
          return serveTheApp();
        }
        const handle = usableHandle(cached);
        if (handle) return redirectTo(handle, "hit");
        // Unreadable entry — fall through and re-resolve rather than trust it.
      }
    } catch {
      // A cache that cannot be read is not a reason to fail the page.
    }
  }

  // ---- miss: exactly one database read ----------------------------------
  const looked = await lookupHandle(id, context.env);

  if (!looked.ok) {
    // FAIL SOFT AND DO NOT CACHE. Caching a failure would poison this profile
    // for the whole TTL over one bad minute, which is the opposite of soft.
    countFire({ cache: "miss", outcome: "lookup-failed", ref: referer });
    return serveTheApp();
  }

  if (key && cache) {
    // waitUntil so storing never delays the response.
    const record = new Response(looked.handle ?? NO_REDIRECT, {
      headers: { "Cache-Control": `max-age=${TTL_SECONDS}`, "Content-Type": "text/plain" },
    });
    try {
      // NOT `context.waitUntil?.(cache.put(...))`. An optional call does not
      // evaluate its arguments, so on any context without waitUntil that form
      // silently never stores anything and every request becomes a miss.
      const stored = cache.put(key, record);
      if (typeof context.waitUntil === "function") context.waitUntil(stored);
    } catch {
      // Storing is an optimisation. Failing to store is not failing.
    }
  }

  if (!looked.handle) {
    countFire({ cache: "miss", outcome: "no-handle", ref: referer });
    return serveTheApp();
  }
  return redirectTo(looked.handle, "miss");
};
