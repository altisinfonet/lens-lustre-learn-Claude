# Logo permanent fix + health check v2 — 2026-08-12

Owner: "On the signup and login fallback logo will look worse than ever. Fix with real
images permanently and check in your health check it too."

Three files delivered this session. None pushed — this session has no repo write access.

| file | replaces | surface |
|---|---|---|
| `useAuthPageSettings.FIXED.ts` | `src/hooks/core/useAuthPageSettings.ts` | website |
| `useSiteLogo.FIXED.ts` | `src/hooks/core/useSiteLogo.ts` | website + app |
| `health-check.UPDATED.mjs` | `scripts/health-check.mjs` | monitoring |

## 1. Why the fallback logo was showing, and the permanent fix

`useSiteLogo` returned `FALLBACK` (`/images/logo-fallback.webp`) as its default while the
query was in flight, and its `queryFn` began with an unbounded
`await awaitDashboardBootstrap()`. So:

- every cold page load painted the generic mark first, and
- if dashboard-init was slow or never ran on that route, the fallback was not a flash —
  it was the **final** state, because the hook's own cheap query sat behind that gate.

Most visible on /login and /signup: the only two pages a logged-out member lands on
directly rather than clicking through to, so the cache is never warm there.

**Fix (no API change — all 11 callers still get a string):**

1. Last resolved logo URL is remembered in `localStorage` and used as React Query
   `placeholderData`, so every visit after the first paints the REAL logo immediately,
   with no network wait and no fallback frame.
2. The bootstrap wait is raced against a 1200 ms timeout, so a stalled dashboard-init can
   no longer hold the logo hostage — it falls through to its own single-row query.
3. Resolved URL is written back to storage. Storage access is wrapped in try/catch for
   private mode and webviews.

`FALLBACK` now appears only where it should: a first-ever visit on which the database is
also unreachable.

Type-checks clean (`tsc --noResolve`, only the expected unresolved-import errors).

## 2. Health check v2 — three gaps closed

### Gap A: it only ever sampled `thumbnail_urls[0]`
The 28 dead addresses in the March incident were all in `image_urls`. The feed's sharp
layer IS the original, so that is precisely what members see. **Now samples both arrays,
40 URLs.**

### Gap B: it printed an unqualified HEALTHY
Every post from the last week is CDN-hosted and the CDN is unreachable from the sandbox,
so the "25 sampled" were all old posts. **Now names the hosts it could not reach**, so
"healthy" can never again be read as "everything was checked":

```
· NOT CHECKED HERE: cdn.50mmretina.com — unreachable from this sandbox.
  Only the DEEP run in CI can see those.
```

### Gap C: nothing watched the front door, and nothing watched for dead hostnames

- **`checkImageHostsResolve`** — DNS-resolves every image host on record. Catches the
  whole deleted-project class. Immune to the egress allowlist: a *blocked* host still
  resolves, so a resolution failure is never the sandbox's own doing. Only ENOTFOUND /
  NXDOMAIN count; timeouts and SERVFAIL are ignored as resolver noise.
- **`checkAuthPages`** — asks the two questions the browser asks: are the three images
  (`site_logo`, `login_background`, `signup_background`) recorded as real URLs, and does
  `dashboard-init` actually **hand them to an anonymous caller**? The second question is
  the one that matters — today's bug was a value that was perfectly good in the database
  and still never reached the page.
- DEEP run additionally fetches the three front-door images for real.

## 3. Proof the new checks actually fire

An alarm that never rings is what caused all of this, so each new branch was replayed
against the real incident, with the live database underneath:

| replay | result |
|---|---|
| inject a post pointing at the deleted project | **exit 1** — "1 photo(s) point at isywidnfnjhtydmdfgtk.supabase.co, which no longer exists" |
| dashboard-init withholds `site_logo` + `login_background` from anonymous callers | **exit 1** — "Recorded but never sent to logged-out visitors" |
| `login_background` absent from `site_settings` | **exit 1** — "no image on record for: login_background" |
| unmodified live data | **exit 0** — HEALTHY, no false alarm |

Current healthy output:

```
· login/signup images — on record: 3/3, delivered to logged-out visitors: 3/3
· image hosts on record: 2, not resolving: 0
· supabase-hosted images sampled (originals + thumbnails): 40, broken: 0
```

## Still open

- Nothing is pushed. Website changes deploy from main in minutes once merged; the
  `useSiteLogo` change also reaches the Android app, but only via a new build.
- `PostMedia.tsx` still discards a good thumbnail when the original fails
  (`const thumb = !transformable && !failed ? ... : null`), so one dead original blanks
  both layers. Not fixed here.
- GitHub Actions status remains unverifiable from this session (repo not in the
  authorised set), so the CI check still reports "rate-limited".
