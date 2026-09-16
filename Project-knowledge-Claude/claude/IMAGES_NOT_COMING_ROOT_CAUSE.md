# "Images are not coming" — root-caused 2026-08-05

Owner reported this repeatedly for weeks, always without a URL, on
`https://www.50mmretina.com/login` and `/signup`. His console showed two
`Failed to load resource: the server responded with a status of 404 ()` lines —
Chrome truncates those, so **no address**.

## Measured first, before changing anything

From a clean browser the same minute, **/login and /signup were healthy**:
30 resources, **zero 4xx**, `login_background.webp` 1200px, site logo 852px.
Every static file the server sends returns 200 (favicon.png, manifest.json,
apple-touch-icon.png, all 5 JS chunks, CSS, logo-fallback.webp).

So the failure was real for him and invisible to everyone else. That is the
whole reason it survived so many reports.

## THE ACTUAL BROKEN IMAGE — found and fixed in the data

`site_settings.managed_pages` → the **About Us** page referenced
`https://www.50mmretina.com/logo.png` **twice**. That file **does not exist in
`public/`**. Cloudflare Pages serves the SPA shell for any unknown path, so the
URL returned **`200` with `text/html`** — an image the browser cannot decode.

Every other managed page uses the real CDN logo. About Us was the odd one out.

Fixed live (rehearsed in `BEGIN … ROLLBACK` first):

```sql
UPDATE public.site_settings
   SET value = replace(value::text,
                       'https://www.50mmretina.com/logo.png',
                       'https://cdn.50mmretina.com/portfolio-images/on-page/site_logo-1774176842636.webp')::jsonb
 WHERE key = 'managed_pages';
```

| check | before | after |
|---|---|---|
| broken refs | 2 | **0** |
| pages in array | 7 | **7** (nothing else touched) |

No deploy needed — this is data.

**Also still missing from `public/`:** `favicon.ico`. Low impact because
`index.html` declares `<link rel="icon" href="/favicon.png?v=2">`, so browsers
do not request `.ico`. But `AdminSEO` fetches `/favicon.ico` and will read HTML.
If it is ever added, generate it from `public/favicon.png`.

## WHY IT COULD NEVER BE DEBUGGED — three evidence-destroying layers

### 1. `src/lib/imageFallback.ts` — gave up on the FIRST error, forever

It replaced **any** failed `<img>` with the dark branded "50mm RETINA WORLD"
placeholder — immediately, permanently, silently. One dropped packet (tunnel,
lift, weak 4G, CDN edge hiccup) turned a photo into a grey box that **never
recovered without a full page reload**. The placeholder is a `data:` URI, so
after the swap there is no further error and nothing retries.

**Now:** retries at **400 ms** and **1200 ms** with a `__r=` cache-busting
parameter, then the placeholder. Remembers the clean URL in
`data-original-src` so retry N+1 is built from the original address.

### 2. `public/sw-image-cache.js` — returned a transparent 1×1 GIF

On any fetch throw it answered with a 1×1 GIF. **The browser treats that as a
successful load**, so `onerror` never fired, no retry path in the app ran, and
nothing was ever logged. A 1×1 GIF is only correct for a tracking pixel.

**Now:** returns a real **504** with `Cache-Control: no-store`.
`CACHE_NAME` bumped `gallery-images-v2` → **v3**, which makes the `activate`
handler purge the whole old image cache exactly once.

### 3. Nothing recorded the URL

**New `src/lib/reportImageError.ts`** — a **capture-phase** `window` error
listener (`<img>` errors do NOT bubble; a normal listener never fires, and
`window.onerror` does not see them either — that single detail is why the app
was blind).

Rules it obeys: never throws, never blocks, dedupes by URL per page, hard cap
of 5 reports per page load, ignores non-our-hosts, records `naturalWidth` (to
tell "request failed" from "succeeded but delivered nothing"), and **only
reports the FINAL failure** (checks `data-retry-count >= 2`).

**ORDER IS LOAD-BEARING** in `src/main.tsx`:
`installImageErrorReporter()` MUST be called **before** `installImageFallback()`.
Both are capture listeners on `window` and fire in registration order, so the
reporter must see the real `currentSrc` before the fallback overwrites it with
the placeholder data URI. Swapping those two lines silently disables reporting.

`log_client_error` now accepts a fifth kind, `image_load`, with its **own
10/hour bucket** (images fail in bursts; under the shared 20 they would crowd
out post/reply/upload failures). The original four keep sharing one budget of
20 — the guard is `(kind = 'image_load') = (_kind = 'image_load')`, deliberately
NOT a per-kind count, which would have quietly raised the ceiling to 80.

## Build marker

`__APP_BUILD` bumped `2026-08-04-7` → **`2026-08-05-1`**.
