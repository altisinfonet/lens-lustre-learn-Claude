# Why `/feed` is 0/3 unmeasured in the Phase 0 baseline — and a second route that is worse

**Investigated 2026-09-04 by D2 at `staging` `122d6ea`. Evidence only: no `src/`, no harness, no
workflow touched. The harness stays hash-locked at `0149fd02…`.**

The committed baseline records `/feed` as `status=unmeasured` on all three samples with
`page.evaluate: Execution context was destroyed, most likely because of a navigation`. A baseline
with one of three routes blank is not a baseline for that route, and P13 cannot set a ceiling on it.

---

## VERDICT — (a), and it applies to a second route the brief did not ask about

**`/feed` is not a public route in practice.** It is *declared* public but *redirects itself*, so an
anonymous visitor — which is what the harness is — never reaches it.

**And `/wall`, the third route in the harness's list, does not exist at all.** Its figures in the
baseline are a measurement of a route that resolves to the 404 handler. That is the more serious of
the two: `/feed` fails loudly and is recorded as unmeasured; `/wall` fails *silently* and produced
numbers that look like a measurement of a real surface.

## 1 · THE ROUTER — read, with file and line

`/feed` is **outside** the auth guard. `<Route element={<RequireAuth />}>` opens at
`src/App.tsx:384` and closes at `:394`; `/feed` is declared at **`src/App.tsx:397`**:

```tsx
</Route>                                                    // App.tsx:394 — RequireAuth ends
<Route path="/profile/:userId" element={<PublicProfile />} />
<Route path="/friends" element={<Friends />} />
<Route path="/feed" element={<Feed />} />                   // App.tsx:397 — NOT guarded
```

`RequireAuth` (`src/App.tsx:272-277`) would have redirected to `/login`, but it never runs for this
route. **The redirect comes from inside the page instead** —
**`src/pages/Feed.tsx:88-90`**:

```tsx
useEffect(() => {
  if (!authLoading && !user) navigate("/login");
}, [user, authLoading, navigate]);
```

That is the mechanism precisely: the page mounts, the harness begins measuring, auth resolves a few
hundred milliseconds later, and `navigate("/login")` tears down the execution context **while
`page.evaluate` is still running**. The harness's error message is a literal description of it.

**`/wall` is declared nowhere.** `grep -rn '"/wall"' src/` returns exactly one hit and it is
`/wallet` (`src/App.tsx:414`). `/wall` therefore falls through to the catch-all at
**`src/App.tsx:440`** — `<Route path="*" element={<NotFound />} />`.

## 2 · PROVED FROM THE BUILT `dist`, SERVED AS THE HARNESS SERVES IT

```bash
# lane values = staging block of .github/workflows/web-build.yml:168-178
rm -rf dist && npm run build                       # 15:47:46Z -> 15:48:34Z
node <static server + SPA fallback> "$PWD/dist" 8790
# Playwright, chromium-1194 named explicitly, fresh context per route = NO session
```

Navigation chain, anonymous, captured from `framenavigated` and navigation responses:

### `/feed` — redirects to `/login`

```
2026-09-04T15:48:51.9Z  navresponse    200  http://127.0.0.1:8790/feed
2026-09-04T15:48:52.018Z framenavigated     http://127.0.0.1:8790/feed
2026-09-04T15:48:52.311Z framenavigated     http://127.0.0.1:8790/login     <-- ~300 ms later
finalUrl : http://127.0.0.1:8790/login
body     : "Back Welcome Back Sign in to continue your journey. Continue with Google …"
```

**~300 ms** after the route mounts. The harness's per-sample settle is longer than that, so every
sample is destroyed mid-measurement. There is no navigation *response* for `/login` — it is a
client-side React Router navigation, which is why the server-side status is 200 throughout and
`curl` would show nothing wrong. (F-53: `curl` is not a browser.)

### `/wall` — resolves to the 404 handler and lands on `/not-found`

```
t+3s   url=http://127.0.0.1:8790/wall        body: "50mm Retina World Loading… …"
t+8s   url=http://127.0.0.1:8790/wall        body: "50mm Retina World Loading… …"
t+15s  url=http://127.0.0.1:8790/not-found   <-- navigated between t+8s and t+15s
t+25s  url=http://127.0.0.1:8790/not-found
```

⚠ **Two facts here, and they must not be merged.** The **navigation to `/not-found` is a routing
fact** — `/wall` is not a declared route and the catch-all owns it, true in any environment. The
**persistent `Loading…` body is confounded by this container**, whose egress to Supabase is blocked
(`net::ERR_CONNECTION_RESET` on every data request, logged in the same run). In CI, with working
egress, `/wall` may render the 404 page rather than hang. **What is proven is that `/wall` is not a
real route; what is not proven is exactly what it paints in CI.**

### Control — `/` renders fully for an anonymous visitor

```
finalUrl : http://127.0.0.1:8790/
body     : "Photography Platform Every Frame Tells A curated space for photographers who see …"
```

So the instrument is fine and the harness is fine. **The route list is wrong.**

## 3 · STAGING REPRODUCTION — **NOT DONE**, and why

```
2026-09-04T15:50:40Z  curl  https://staging.50mmretina.com/feed   -> HTTP 000
2026-09-04T15:50:42.641Z  Playwright  net::ERR_TUNNEL_CONNECTION_FAILED
```

`staging.50mmretina.com` is unreachable from this container under the session's network policy —
the proxy answers `403` to `CONNECT`. **D2 cannot take this reading.** It is recorded as not done
rather than inferred from the local run, even though the local run used the same bundle: the whole
point of step 3 was to test the deployed origin, and asserting it from localhost would be answering
a different question. Closing it needs a session with egress, or the Auditor's own browser — the
route that closed the previous gap.

## 4 · WHAT THE PUBLIC EQUIVALENT IS — verified, not guessed

Which page components send an anonymous visitor to `/login`:

| page | verdict |
|---|---|
| `src/pages/Feed.tsx:89` | **redirects** |
| `src/pages/Discover.tsx:59` | **redirects** — same defect, and `/discover` is also outside `RequireAuth` (`App.tsx:398`) |
| `src/pages/Certificates.tsx:104` | **redirects** |
| `Competitions`, `Journal`, `Winners`, `HashtagFeed`, `Index` | no redirect |

Confirmed by loading each anonymously against the same server:

```
/competitions  -> 200, stays put, "Compete Photography Competitions Showcase your talent …"
/journal       -> 200, stays put, "Photography Journal Stories & Insights …"
/winners       -> 200, stays put, "Hall of Fame Competition Winners …"
```

**Recommended route list for the harness** — D2 does **not** change it here; the workflow is
hash-locked and the change is the Auditor's to authorise:

| current | replace with | why |
|---|---|---|
| `/` | `/` — **keep** | renders fully for anon; the only currently-valid entry |
| `/feed` | **`/hashtag/<tag>`** if the intent was "a feed of posts" — `App.tsx:259` names it as the deliberately-public post surface — or **`/competitions`** if the intent was "a heavy list page" | `/feed` cannot be measured anonymously by construction |
| `/wall` | **`/journal`** or **`/winners`** | `/wall` is not a route at all |

## 5 · WHAT THIS MEANS FOR THE COMMITTED BASELINE

Of the three routes in the Phase 0 vitals baseline:

- **`/`** — valid. LCP 4016 ms, CLS 0, INP ~64 ms stand as an anonymous-visitor reading.
- **`/feed`** — **no baseline exists and none can, for an anonymous harness.** P13 must not set a
  ceiling on it. Honest fix is a route change, not a longer settle window: waiting longer does not
  make a redirect stop happening.
- **`/wall`** — **the figures in the committed baseline are not a measurement of a real surface.**
  LCP 4020 ms / CLS 0 locally and LCP 3992 ms / CLS 0.7462 in CI describe a route that resolves to
  the 404 handler. They should not be carried into Phase 5 as a before-figure for anything.

This also supplies a candidate explanation for **F-82** (CLS 0.7462 in CI, 0 locally at the same
SHA): the CI figure was taken on `/wall`, and what `/wall` paints before it gives up differs
between an environment with working egress and one without. **Candidate, not conclusion** — proving
it needs a CI run against a corrected route list, which is P13's business and not this file's.

---

## 6 · THE README §2 LINE — NOT APPLIED, and why

The brief asked for one line appended to `README.md` §2 under the `/feed` row pointing here.
**It is not applied, because `docs/evidence/d2/baseline/README.md` does not exist on `staging`** —
it lives only in **unmerged PR #163**. This branch was cut from `staging` as instructed, so the file
is not present to append to, and creating a copy of it here would duplicate #163 and conflict with
it on merge.

**The exact line, ready to apply the moment #163 lands** — under the `/feed` row of §2's table:

```markdown
> `/feed` is **unmeasurable by an anonymous harness by construction**: `src/pages/Feed.tsx:89`
> redirects to `/login` ~300 ms after mount. Cause, navigation chains and the recommended route
> replacement: [`feed-unmeasured-20260904.md`](./feed-unmeasured-20260904.md). And note `/wall` is
> **not a declared route** — its figures measure the 404 handler; see the same file, §5.
```

Two ways to close it, the Auditor's choice: apply that line while merging #163, or D2 raises a
one-line follow-up PR after #163 is on `staging`. Recorded as an open loop rather than silently
skipped.
