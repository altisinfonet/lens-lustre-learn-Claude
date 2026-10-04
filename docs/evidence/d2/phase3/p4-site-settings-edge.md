# P4 · site_settings served from the edge, versioned

**D2 · 2026-10-04 · staging `6e4b568`.**

GATE (P4, verbatim from the client rules): *"Permanently-open realtime channels
on configuration tables (`site_settings`, `role_display_config`,
`badge_definitions`, `courses`, `support_tickets`) are the
580,000-requests-for-35-rows problem. Configuration is served from the CDN edge
or baked into the bundle, versioned."*

This PR does the **`site_settings` read half**: served from the edge, versioned.
What it does not do, and why, is the last section — stated rather than left to
be discovered.

## The lane question, answered from the running code

The route needs a Supabase ref and key at the edge. `functions/page/[slug].ts`
**already reads `site_settings`** through `sbGet`, which uses
`SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` from `context.env` — both
declared in `functions/_seo.ts` and in use on both lanes today.

**No new environment variable is needed, and no privilege is added**: the anon
key can already read this table. Checked against the code, not assumed — the
last time a D2 edge unit needed a key that was not declared
(`SUPABASE_SERVICE_ROLE_KEY`, Phase 1 Unit 2) the route could not work and the
unit had to be held.

## What was built

`functions/config/site-settings.ts` → `GET /config/site-settings`

```json
{ "version": "<sha-256 of the canonical body>", "settings": { "<key>": "<value>" } }
```

* `Cache-Control: public, max-age=60, stale-while-revalidate=600`
* strong `ETag`; `If-None-Match` → **304, no body**
* any upstream failure → **503 + `Cache-Control: no-store`**

`src/lib/siteSettingsCache.ts` reads that route first and keeps its existing
batched PostgREST query as the fallback.

### The version is content-addressed, and that is not a detail

PostgREST does not guarantee row order without an `ORDER BY`. An ETag computed
over the raw response would therefore change when nothing changed — every client
would re-download on a row-order shuffle and `stale-while-revalidate` would be
doing work for nothing. The keys are sorted and re-serialised **before** the
digest, so the version is a function of the configuration and of nothing else.

### The failure path is the whole risk

An empty `{}` would not read as an error anywhere downstream. It would read as
*"every setting is unset"*, and members would silently get built-in defaults —
exactly what `siteSettingsCache.ts`'s own log line warns about:

> THIS CHANGES WHAT MEMBERS SEE with nothing on screen saying so — a setting an
> admin turned off may be back on.

So zero rows, a non-array body, a missing key column and any upstream non-200
all return 503. The client treats every non-200, every wrong shape and every
thrown fetch as *"the edge has nothing for me"* and uses the database. Degraded,
never wrong.

A **404 or 405 is remembered** (the route is not deployed on this lane, or there
is no such origin — the native app), so the client stops asking. A **5xx is not
remembered**, because an outage ends and the session should not be stuck on the
slow path after one bad minute.

## What changes, structurally

| | before | after |
|---|---|---|
| per tab, per 10-min TTL | 1 PostgREST query (already batched from 23) | 1 same-origin GET, CDN-cached; **304 with no body** once the client has the version |
| origin reads | one per tab per TTL | one per edge node per `max-age`, shared by every member on it |
| a key not in the payload | a keyed query cannot tell "unset" from "not asked for" | the edge returns the WHOLE configuration, so absent = genuinely unset |

**This is a structural claim, not a production measurement.** No before/after
request count from live traffic is included, because this has not been deployed;
the honest reading comes after it is on staging. Said plainly so the table above
is not quoted later as a measured result.

## Evidence the tests can fail (C-34)

`src/lib/__tests__/siteSettingsEdge.test.ts`, 14 assertions. Four mutants on
`siteSettingsCache.ts` alone, each reverted after; the file was byte-compared to
its original afterwards.

| | mutant | killed by |
|---|---|---|
| **A** | the edge is never consulted (the pre-P4 shape, exports kept) | 6 — every edge assertion. The twelve fallback assertions stay **green**, which is right: A restores exactly the behaviour they describe. |
| **B** | an empty `{}` accepted as the configuration | 2 — including the GUARD that an empty payload never blanks a real setting |
| **C** | a 404 is not remembered | 1 |
| **D** | `invalidateSiteSetting` does not clear the version | 1 |

Four mutants, four killed, none killing the whole file — an assertion set that
goes entirely red on any change localises nothing.

Twelve of the fourteen are failure paths: 503, 500, no settings object, empty
object, an array, non-JSON, a thrown fetch, and the 404-vs-5xx distinction.

## What this PR deliberately does NOT do

1. **The `site_settings` realtime leg stays.** `live-admin-sync` carries two
   subscriptions — `site_settings` and `user_roles` — and removing the first
   would make an admin edit take up to `max-age` (60 s) to reach members instead
   of arriving immediately. That is a behaviour change with a number attached and
   belongs in its own PR with that number stated, not folded into a read-path
   change. Removing it also does not close the channel, because `user_roles`
   keeps it open.
2. **The other four configuration tables** — `role_display_config`,
   `badge_definitions`, `courses`, `support_tickets` — are untouched. #327's
   inventory shows each has exactly one subscribing file
   (`useRoleDefinitions.ts`, `useBadgeDefinitions.ts`, `useCourses.ts`,
   `AdminLayout.tsx`). One unit per PR.
3. **No production reading.** See the note under the table above.

## Round 2 (2026-10-04, R-82): the enforced guard, and the UI-gate fix

R-82 replaced P4's traffic reading with a design proof: **design + an enforced
guard + a synthetic test.** This round adds the guard and fixes the UI gate.

### 1. The guard — `scripts/web-site-settings-guard.mjs` + `d2-site-settings-guard.yml`

Rule: **no client read of `site_settings` without a key filter.** Parsed with
the repository's TypeScript (comments and prose mentions are not reads).
Violations: `.from("site_settings").select(…)` with no `.eq/.in/.like/.ilike("key", …)`
or `.match({ key })` in the chain; a builder that escapes into a variable; a raw
`/rest/v1/site_settings` literal without `key=`. Writes are out of scope.
`functions/` is not scanned: the edge's whole-table read is the design.

| instrument | reading | UTC |
|---|---|---|
| `node scripts/web-site-settings-guard.mjs --self-test` | 13/13 shapes classified correctly | 2026-10-04 08:32:04 |
| `node scripts/web-site-settings-guard.mjs` on this branch | 666 source files, 75 `.from("site_settings")` calls, **0 violations**, exit 0 | 2026-10-04 08:32:04 |
| same, with `.eq("key","managed_pages")` removed from `SiteFooter.tsx` (fail-first, real code) | **1 violation** `unfiltered-read` at `SiteFooter.tsx:24`, exit 1 | 2026-10-04 08:32:05 |
| `src/__tests__/siteSettingsGuard.test.ts` | 18 tests: every self-test shape, a `.tsx` parse, the clean real tree, and two real-code mutants (SiteFooter, the cache's own `.in("key", keys)`) that must go red — 33/33 with the edge file | 2026-10-04 08:32:11 |

Stated limit: a table name held in a variable (`.from(name)`) cannot be followed.
None exists in `src/` for this table today.

### 2. The UI gate ("Every control reachable") went red on 5d0bca6 — cause and fix

**Cause:** the Vite dev server that the UI-gate harness runs on has no Pages
Functions, so the new edge read hit `GET /config/site-settings` → **404** on
every scene, and `tools/uishot/capture.mjs` reports every HTTP ≥ 400 as a fault
(`curl -H 'accept: application/json' http://127.0.0.1:5199/config/site-settings` → `404`, ~08:00 UTC).
**Fix (cause, not symptom):** `loadFromEdge()` returns early when
`import.meta.env.DEV` — there is no edge in dev, so dev reads keyed from the
database, the same path a lane without the route takes. Built apps are
unaffected. The gate's filter list was **not** touched.

Test: `siteSettingsEdge.test.ts` now runs its edge cases as a built app
(`vi.stubEnv("DEV", false)`, because Vitest sets DEV = true) and adds one dev
test. Mutant: delete the DEV line → that test fails (1 failed / 14 passed,
~08:10 UTC). Without the stub, 6 of the original 14 go red — that is the edit to
my own tests in this PR, stated here, not an edit to someone else's assertion.

UI gate, run locally with the CI command (`npm run ui:gate`, the CI's synthetic VITE_* values):

| state | reading | UTC |
|---|---|---|
| fix in place | `200 screenshots, 0 problem(s) reported` · `baseline diff: clean against 148 recorded scene/viewport keys` · `[ui:gate] PASS` | read at 2026-10-04 08:30:53 |
| DEV line removed (mutant), `npm run ui:gate -- screen-wall` | exit 1; all 4 viewports `✗ … http 404: http://127.0.0.1:5199/config/site-settings` | 2026-10-04 08:31:54 |

## Finding F-D2-9 (recorded, not fixed here)
Inside the native app (Capacitor, built with DEV = false) `/config/site-settings`
resolves against the app's local origin, so the first batch pays one 404 and
then `edgeUnavailable` routes everything to the keyed database read. Correct,
but the app never benefits from the edge. Fix = an absolute edge origin per
lane for native builds; it touches lane config (frozen `scripts/lane-config.mjs`)
so it needs the Auditor's window. Separate PR.
