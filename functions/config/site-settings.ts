/**
 * site_settings, SERVED FROM THE EDGE AND VERSIONED. P4, D2 half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Configuration is read constantly and changes rarely, and this app does the
 * opposite of what that implies. `siteSettingsCache.ts` already fixed the worst
 * of it — 77 call sites batched into one `.in("key", …)` query, 23 requests on
 * the production feed down to 1 — but that is still **one PostgREST round trip
 * per tab per ten minutes, multiplied by every member**, for roughly 35 rows
 * that are the same for everybody.
 *
 * The same shape, on a permanently-open realtime channel, is the
 * 580,000-requests-for-35-rows problem this codebase already has a name for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 *
 * One Pages Function, one upstream read, one response the CDN can hold:
 *
 *   GET /config/site-settings  ->  { version, settings: { key: value, … } }
 *
 * with a strong `ETag` and `Cache-Control: public, max-age=60,
 * stale-while-revalidate=600`. A member arriving at the site gets it from the
 * edge, usually without the origin being touched at all; a client that already
 * has it sends `If-None-Match` and gets a 304 with no body.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERSION IS CONTENT-ADDRESSED, AND THAT IS NOT A DETAIL
 *
 * PostgREST does not guarantee row order without an ORDER BY, so an ETag
 * computed over the raw response would change when nothing changed — every
 * client would re-download on a row-order shuffle, and `stale-while-revalidate`
 * would be doing work for nothing. The keys are therefore sorted and the body
 * re-serialised canonically BEFORE the digest, so the version is a function of
 * the configuration and of nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAILURE PATH, WHICH IS THE WHOLE RISK
 *
 * An empty `{}` here would not read as an error anywhere downstream — it would
 * read as "every setting is unset", and the client would quietly fall back to
 * built-in defaults. `siteSettingsCache.ts`'s own log line already says what
 * that costs: *"THIS CHANGES WHAT MEMBERS SEE with nothing on screen saying
 * so — a setting an admin turned off may be back on."*
 *
 * So an upstream failure returns **503 with `Cache-Control: no-store`**, never
 * a 200 with an empty object, and never a cached one. The client treats a
 * non-200 as "the edge has nothing for me" and uses its existing PostgREST
 * path. Degraded, not wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LANE
 *
 * `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` are already declared in the
 * Pages environment for both lanes and are already used by
 * `functions/page/[slug].ts`, which reads `site_settings` the same way. **No new
 * environment variable is needed** — checked against the running code, not
 * assumed. `site_settings` is readable with the anon key today; this route adds
 * no privilege it did not already have.
 *
 * It does NOT reuse `sbGet` from `_seo.ts`: that helper returns only the first
 * row of an array, which is right for the single-row lookups it was written for
 * and silently wrong here.
 */

interface Env {
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_ANON_KEY?: string;
}

/** Long enough that the CDN absorbs the traffic; short enough that an admin
 *  edit is visible in about a minute without anyone pressing anything. */
const MAX_AGE_S = 60;
/** Ten minutes of serve-stale-while-refreshing: a cold origin never costs a
 *  member a blank configuration. */
const SWR_S = 600;

type Settings = Record<string, unknown>;

/** Sorted keys, re-serialised. The digest must depend on the configuration and
 *  not on the order PostgREST happened to return the rows in. */
function canonical(settings: Settings): string {
  const sorted: Settings = {};
  for (const k of Object.keys(settings).sort()) sorted[k] = settings[k];
  return JSON.stringify(sorted);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fail(reason: string): Response {
  return new Response(JSON.stringify({ error: "site_settings unavailable", reason }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Never cache a failure: a cached 503 would outlive the outage.
      "cache-control": "no-store",
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const ref = context.env?.SUPABASE_PROJECT_REF;
  const anon = context.env?.SUPABASE_ANON_KEY;
  if (!ref || !anon) {
    // Pages Functions have no build step, so `context.env` is the only lane
    // signal there is. A missing variable is a deployment fault, not a reason
    // to invent a configuration.
    return fail("SUPABASE_PROJECT_REF or SUPABASE_ANON_KEY is not set for this lane");
  }

  let rows: { key?: unknown; value?: unknown }[];
  try {
    const r = await fetch(
      `https://${ref}.supabase.co/rest/v1/site_settings?select=key,value`,
      { headers: { apikey: anon, authorization: `Bearer ${anon}` } },
    );
    if (!r.ok) return fail(`upstream ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j)) return fail("upstream did not return an array");
    rows = j;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  // Zero rows is not a configuration. It is what a wrong key, a revoked grant
  // or an RLS change looks like, and serving it as 200 would reset every
  // setting to its built-in default with nothing on screen saying so.
  if (rows.length === 0) return fail("upstream returned zero rows");

  const settings: Settings = {};
  for (const row of rows) {
    if (typeof row?.key === "string") settings[row.key] = row.value ?? null;
  }
  if (Object.keys(settings).length === 0) return fail("no row carried a string key");

  const body = canonical(settings);
  const version = await sha256Hex(body);
  const etag = `"${version}"`;

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${MAX_AGE_S}, stale-while-revalidate=${SWR_S}`,
    etag,
    // The response varies with nothing: it is the same for every member, signed
    // in or not. Said explicitly so no proxy invents a Vary of its own.
    vary: "Accept-Encoding",
  };

  // A client that already has this exact configuration gets no body at all.
  const inm = context.request.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(JSON.stringify({ version, settings }), { status: 200, headers });
};
