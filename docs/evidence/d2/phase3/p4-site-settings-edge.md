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
