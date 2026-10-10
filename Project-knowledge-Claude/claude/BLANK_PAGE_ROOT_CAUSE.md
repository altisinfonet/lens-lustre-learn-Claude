# The 30-day blank page — root cause, found 2026-08-05

**The owner supplied the console capture that settled this after ~30 days.**
Before that I was reasoning from absence of evidence. The console was decisive;
everything below was then verified against production independently.

---

## 1. What the console said

```
Failed to load module script: Expected a JavaScript-or-Wasm module script but
the server responded with a MIME type of "text/html". Strict MIME type checking
is enforced for module scripts per HTML spec.        AdminPushBroadcast-D_bNnshh.js

TypeError: Failed to fetch dynamically imported module:
https://50mmretina.com/assets/AdminPushBroadcast-D_bNnshh.js

[AppErrorBoundary] TypeError: Failed to fetch dynamically imported module: …
  at Lazy
  at Suspense
  at p (…/assets/AdminPanel-B6Oyh2B0.js)
```

## 2. What I then measured against production

| Probe | Result |
|---|---|
| `GET /assets/<a chunk that no longer exists>` | **200**, `content-type: text/html` |
| `GET /index.html` | `cache-control: public, max-age=0, s-maxage=60` |
| `public/_headers`, rule `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` |

His page was running `index-tgWOoonB.js`; the live site was serving
`index-_1Zh2_Np.js`. **Two different builds** — his browser was holding an old
`index.html`.

## 3. The mechanism, in one paragraph

After a deploy, a browser still holding the old `index.html` asks for chunk
filenames that no longer exist. The host does **not** return 404 — it returns
the SPA fallback, `index.html`, with status **200** and `text/html`. That
response arrives under a `/assets/…` URL, so our own `_headers` rule stamps it
`immutable, max-age=31536000` and **the browser stores HTML under a `.js` URL
for one year**. Every later attempt is served that poisoned entry off disk. The
module loader refuses it on MIME grounds, the dynamic import throws,
`AppErrorBoundary` renders "Something went wrong while loading this page."

**That is why reloading never fixed it, and why it lasted ~30 days.** It is not
transient; it is a cache entry with a one-year lifetime.

Roughly 12 deploys happened on 2026-08-05 alone. Every deploy creates a fresh
crop of dead chunk names.

## 4. Two faults in OUR OWN healing that made it worse

`lazyRetry` (added 2026-07-28 for this same symptom) was supposed to self-heal:

1. **The retry flag was global** — `sessionStorage.chunk_reload_v1` — and was
   cleared only on a *successful* lazy load. So the first failure in a session
   disarmed healing for all 49 lazy routes; the second failure went straight to
   the error screen without even attempting a reload. **This is what the owner
   hit.**
2. **A plain reload re-read the poisoned entry**, because the bad bytes are in
   Cache Storage, not in the network path.

## 5. What shipped (`7014233`, `599ff43`)

- The retry flag is **keyed per chunk**, so one dead route cannot disarm the
  others.
- On failure the handler **deletes every Cache Storage entry under `/assets/`**
  before reloading — evicting the HTML-under-a-`.js`-URL.
- It reloads with `?cb=<timestamp>` so no intermediate cache can hand back the
  stale `index.html` that names the dead chunk. `stripCacheBusterParam()` in
  `main.tsx` cleans the address bar afterwards.
- It **reports the failure before healing**, with
  `detail: { cause: "chunk_load", chunk, firstTry }` — so frequency is finally
  visible in Admin → Health → Client failures, and "healed itself" is
  distinguishable from "the member saw the error screen".
- 9 tests in `src/__tests__/chunkLoadSelfHeal.test.ts` pin all of it.

## 6. THE PERMANENT FIX IS NOT SHIPPED — it belongs in hosting

The client mitigation stops the year-long poisoning, but the real defect is:

> **A missing file under `/assets/*` must return 404, not 200 with `index.html`.**

While a missing asset returns HTML, `immutable, max-age=31536000` on `/assets/*`
will keep converting a transient miss into a year-long broken cache entry. Two
ways to close it, both needing the owner's decision because they touch every
asset on a live site:

1. **Stop the SPA fallback for `/assets/*`** in the hosting configuration, so a
   dead chunk 404s. `lazyRetry` then heals cleanly on the first attempt.
2. **Or drop `immutable`** from `/assets/*` (keep a long `max-age`), so a bad
   response cannot outlive a revalidation.

Option 1 is the correct one. It was NOT done unilaterally: changing caching or
routing for every asset on a live product is exactly the kind of change the
owner's standing rules reserve for him.

## 7. What this does and does not explain

- ✅ Web blank pages, persisting across reloads, for ~30 days.
- ✅ Why it clusters after deploys, and why it looks random to a member.
- ✅ The exact console error and stack.
- ❌ **It cannot explain a blank page in the INSTALLED APP** — the app carries
  its chunks inside the package, so there is no network fetch to fall back. A
  `blank_page` row with `platform=app` and no `cause: chunk_load` is a different
  fault, and the log will now name it.
- ❌ It is **not** established as the cause of the 2026-08-04 posting outage.
  That remains unexplained; do not conflate the two.
