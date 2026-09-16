# PHASE 2 · CONTROL CYCLE 2 — READ-ONLY MEASUREMENT

Date: 2026-08-17 · Production writes: **NONE** · Schema changes: **NONE** ·
Client changes: **NONE** · Uploads/deletions: **NONE**

Every number below comes from an actual HTTP response or an actual `SELECT`.
Nothing here is estimated unless the line says EXTRAPOLATION.

---

## 0. THREE CORRECTIONS TO MY OWN WORK — READ THESE FIRST

**0.1 — My first census query in this cycle was wrong.** I wrote the
dimension test as `[_-][0-9]+x[0-9]+[._-]` and it returned **0** files with
dimensions, contradicting Cycle 1's 128. The filenames encode dimensions as
`-w2560h1707`, not `2560x1707`. My regex was the defect; Cycle 1's 128/154 was
right and is re-confirmed below. Two sources contradicted, I stopped, and the
contradiction is resolved in favour of Cycle 1.

**0.2 — My first CDN transform probe produced a false negative.** I fetched
`format=auto` with `Accept: */*` and got **image/jpeg** back. Had I stopped
there I would have reported "the CDN transformer cannot produce WebP", which is
false. `format=auto` keys off the `Accept` header; a browser sends
`image/avif,image/webp,...`. Re-measured with a real browser `Accept`, the same
URLs return **AVIF**, and `format=webp` returns **WebP**. The corrected result
is in section 6.

**0.3 — Cycle 1's "282 photographs" overstates the migration population.**
`posts.image_urls` does not contain only post photographs. Measured today:

| path segment | entries |
|---|---|
| `/posts/` — real post photographs | **207** |
| `/avatars/` | 28 |
| `/covers/` | 4 |
| flat `<uuid>/<file>` (legacy, incl. all 28 Supabase `-thumb.webp`) | 43 |
| **total** | **282** |

I verified one such row directly: a public post whose entire `image_urls` array
is a single value, `https://cdn.50mmretina.com/avatars/319d26bf-…/avatar.webp?t=…`.
So this is real product data (profile/cover-change posts), not corruption — but
any migration that treats all 282 as photographs is migrating the wrong set.

---

## 1. SAMPLE (20, as approved)

| group | n | host |
|---|---|---|
| A — dimensions in filename, plain | 8 | cdn.50mmretina.com |
| A — dimensions in filename, `-l3` ladder | 2 | cdn.50mmretina.com |
| B — no dimensions in filename | 5 | cdn.50mmretina.com |
| B — no dimensions in filename | 5 | Supabase Storage |

Selection was deterministic (`order by url`), from **public posts only**. No
caption, no member identity, no private object was read. Only URL strings and
image bytes that are already public were touched.

⚠ **Sampling weakness I am flagging myself:** ordering by URL concentrated the
CDN half on one photographer — 12 of the 15 CDN files belong to owner
`01c5059c…`. Pass/fail results (sections 2–5) are unaffected, because they are
per-file properties. The **size statistics in section 7 are weakly grounded**
and I have labelled the extrapolation accordingly.

### How the CDN half was reached
`cdn.50mmretina.com`, `www.50mmretina.com` and `50mmretina.com` are **all
blocked by this container's egress proxy** (`CONNECT tunnel failed, response
403`). The 15 CDN measurements were therefore taken through the browser bridge,
from a page whose origin *is* `cdn.50mmretina.com` — so the requests are
same-origin, no CORS interference, and every response header is readable. The 5
Supabase measurements were taken from the container directly. **Both paths ran
the identical parsing code** (Python and JavaScript ports of the same header
parser), and both agreed on every file they could both see.

---

## 2. DIMENSIONS FROM ACTUAL BYTES — 20/20

| | result |
|---|---|
| dimension read succeeded | **20 / 20 (100%)** |
| bytes actually needed | **30** (WebP `VP8X` chunk) |
| dimensions read from a 1 KiB range == dimensions read from the whole file | **20 / 20** |
| files whose filename claims dimensions | 10 |
| filename claim == bytes | **10 / 10** — the filename never lied |

Every file in the sample is `VP8X (extended)` WebP. Width and height are three
little-endian bytes each at offsets 24 and 27, plus one. **The 154 photographs
with no dimensions in the filename are not a problem: 5 of 5 sampled returned
their true dimensions from the first 30 bytes.**

Measured examples (the group-B files, where the filename says nothing):

```
1785337163940-5g2hevd5lxy.webp   -> 2046x2560
1785389156938-y8qdzlo8nlm.webp   -> 1802x2250
1785434911587-3zh4tkulcbo.webp   -> 2560x1707
1785596268407-i1369h9d6lr.webp   -> 2560x1707
1785668890556-2oaq86majft.webp   -> 1725x2560
```

## 3. MIME FROM ACTUAL BYTES — 20/20

Detected from the magic bytes (`RIFF….WEBP`), never from the extension.
**20/20 = `image/webp`**, and in all 20 the sniffed type matched the
`Content-Type` header the server sent. 12 bytes are sufficient.

## 4. BYTE SIZE WITHOUT DOWNLOADING — 20/20

`HEAD` returns `Content-Length` on both hosts. **In all 20 cases the
`Content-Length` exactly equalled the number of bytes the full GET actually
delivered.** Cost: one HEAD, zero body bytes.

## 5. SHA-256 — 20/20, AND IT COSTS THE WHOLE FILE

**A hash of a header is not the hash of the object, and a hash of a URL is not
a hash of anything.** SHA-256 was computed over the complete body — via
`hashlib` in the container and `crypto.subtle.digest` in the browser.

- hash success: **20 / 20**
- bytes required: **the entire object, every time**
- measured total for the 20 samples: **8,187,850 bytes (7.81 MiB)**

There is no header, no ETag and no filename component from which SHA-256 can be
derived. (Both hosts do send an ETag — Cloudflare/R2 and Supabase both use an
MD5-shaped value — but an ETag is not SHA-256 and must never be stored as one.)

## 6. RANGE REQUESTS — 20/20 HONOURED

Requested `Range: bytes=0-1023` on every file.

| | cdn.50mmretina.com | Supabase Storage |
|---|---|---|
| files | 15 | 5 |
| status | **206 on 15/15** | **206 on 5/5** |
| `Content-Range` present and correct | 15/15 | 5/5 |
| bytes actually transferred | **exactly 1024 each** | **exactly 1024 each** |
| `Accept-Ranges: bytes` on HEAD | yes | yes |

Total transferred by the entire range pass: **20 × 1024 = 20,480 bytes.**

## 7. TRANSFER COST

### Measured (the 20 samples, actual bytes off the wire)

| | bytes | KiB |
|---|---|---|
| range pass (dimensions + MIME for all 20) | **20,480** | 20.0 |
| full pass (SHA-256 for all 20) | **8,187,850** | 7,996.0 (7.81 MiB) |

| statistic | all 20 | CDN only (15) | Supabase only (5) |
|---|---|---|---|
| mean | **409,392 B (399.8 KiB)** | 533,900 B | 35,870 B |
| median | **305,719 B (298.6 KiB)** | 359,064 B | 40,556 B |
| p95 | **970,614 B (947.9 KiB)** | 1,891,518 B | 49,818 B |
| min / max | 18,094 / 1,891,518 | 158,704 / 1,891,518 | 18,094 / 49,818 |

### EXTRAPOLATION — clearly labelled as such

⚠ These are NOT measurements. They project the 20-file mean onto the full
population, from a CDN sample dominated by one photographer (see §1).

| population | mean-based | median-based |
|---|---|---|
| all 282 `image_urls` entries | **≈110.1 MiB** | ≈82.2 MiB |
| 207 real post photographs | **≈80.8 MiB** | ≈60.4 MiB |

### HTTP operations

The three probes were separate here only to measure them separately. **A real
backfill needs ONE full GET per object** — a single response yields the bytes,
and therefore width, height, MIME, size *and* SHA-256 together.

| plan | ops | bytes (extrapolated, 207 photographs) |
|---|---|---|
| dimensions + MIME + size only | 207 range GETs | **207 KiB** (measured rate: 1024 B each) |
| everything incl. SHA-256 | 207 full GETs | ≈80.8 MiB |

- failures: **0 / 60 requests**
- range-support rate: **100% (20/20)**
- dimension-read success rate: **100% (20/20)**
- MIME detection rate: **100% (20/20)**
- hash success rate: **100% (20/20)**
- retrievability: **20/20**; a missing object correctly returns **404**, not a
  stale or empty 200.

## 8. CACHE / DELIVERY HEADERS

**cdn.50mmretina.com (Cloudflare in front of R2)**
```
cf-cache-status: HIT      (15/15)
etag, last-modified, accept-ranges: bytes
content-type: image/webp
server: cloudflare
cache-control: ABSENT  (0 of 15 responses carried one)
```

**Supabase Storage**
```
cache-control: public, max-age=31536000
cf-cache-status: HIT
etag, last-modified, accept-ranges: bytes
```

⚠ **Finding for B3d-IMG:** the CDN sends **no `Cache-Control` at all**. Edge
caching is working (`HIT` on every request, `age` up to 5739 s), but browsers
and the Android WebView are given no explicit freshness lifetime, so they fall
back to heuristic caching. Supabase, serving one tenth of the images, sends a
one-year `max-age`. This is a delivery inconsistency, measured, not inferred.

## 9. CDN TRANSFORM — 600 / 1080 / 1440

Tested against three real originals, using
`https://cdn.50mmretina.com/cdn-cgi/image/width=<W>,quality=82,format=<F>/<original>`.
Delivered size was verified by **decoding the returned image**
(`createImageBitmap`), not by trusting a header.

| original | requested | `format=auto` | `format=webp` | decoded size |
|---|---|---|---|---|
| 2560×1707 | 600 | 200, image/avif, 25,449 B | 200, image/webp, 34,682 B | **600×400** |
| 2560×1707 | 1080 | 200, image/avif, 65,627 B | 200, image/webp, 88,422 B | **1080×720** |
| 2560×1707 | 1440 | 200, image/avif, 100,103 B | 200, image/webp, 133,964 B | **1440×960** |
| 1707×2560 (`-l3`) | 600 | 200, image/avif, 90,161 B | 200, image/webp, 108,134 B | **600×899** |
| 1707×2560 (`-l3`) | 1080 | 200, image/avif, 218,022 B | 200, image/webp, 279,496 B | **1080×1619** |
| 1707×2560 (`-l3`) | 1440 | 200, image/webp, 422,746 B | 200, image/webp, — | **1440×2159** |
| 2046×2560 (no dims in name) | 600 / 1080 / 1440 | 200 each | 200 each | **600×751 / 1080×1351 / 1440×1801** |

- `cf-resized` response header present on **every** transform → the resize is
  performed at the edge at request time.
- **18 / 18 transform requests returned 200 with the exactly-requested width.**
- A transform of a non-existent object returns **404**, not a broken 200.

### Was a new stored object created? NO — verified.

After the nine transform requests I re-read each of the three originals and
compared against the values recorded *before* them:

```
1785868053062-owm82ykgq5o…  etag_same=true  len_same=true  lastmod_same=true  len=522708
1786941933263-vksx8gjp01…   etag_same=true  len_same=true  lastmod_same=true  len=970614
1785337163940-5g2hevd5lxy…  etag_same=true  len_same=true  lastmod_same=true  len=668010
```

ETag, Content-Length and Last-Modified are unchanged on all three. Nothing was
written, re-uploaded or replaced.

## 10. DOES THE SAME METHOD WORK ON BOTH HOSTS?

| capability | cdn.50mmretina.com | Supabase Storage |
|---|---|---|
| HEAD → Content-Length | ✅ 15/15 | ✅ 5/5 |
| Range 0-1023 → 206 | ✅ 15/15 | ✅ 5/5 |
| dimensions from bytes | ✅ 15/15 | ✅ 5/5 |
| MIME from bytes | ✅ 15/15 | ✅ 5/5 |
| SHA-256 from full body | ✅ 15/15 | ✅ 5/5 |
| **runtime resize 600/1080/1440** | ✅ **works** | ❌ **403 FeatureNotEnabled** |

**Measurement is host-independent. Transformation is not.**

---

## 11. UNPLANNED FINDING — SUPABASE IMAGE TRANSFORMATION IS DISABLED

Requesting the Supabase render endpoint for a real public object:

```
GET /storage/v1/render/image/public/post-images/622dada0-…/1774282446964_1-thumb.webp?width=600&resize=contain&quality=82
HTTP 403
{"statusCode":"403","error":"FeatureNotEnabled",
 "message":"feature not enabled for this tenant","code":"FeatureNotEnabled"}
```

The plain object endpoint on the same host returns **200** with the image, so
this is not a network or path problem — the transformation feature is switched
off for this project.

**11 places in the shipped code build that URL:**
`src/components/OptimizedImage.tsx`, `src/components/EntryCard.tsx`,
`src/hooks/core/useProgressiveImage.ts`, `src/pages/Index.tsx` (×2),
`src/components/post/PostMedia.tsx`, `src/components/admin/AdminGallery.tsx`,
`src/components/admin/AdminBanners.tsx`,
`src/components/admin/AdminPhotoOfDay.tsx`, and
`supabase/functions/backfill-thumbnails/index.ts` (×2).

Every one of those requests gets a 403 today. This is a strong candidate cause
for the owner's report of images that arrive blurry, half-loaded or slow, and it
belongs to **B3d-IMG**, not to the media-engine migration. **I have not changed
any of it** — this cycle is measurement only.

Confirmation note: measured from the container. I attempted a second
confirmation through the browser and the extension's privacy guard blocked the
request because of the query string. The container result is an
application-level JSON error from Supabase's own API on a host that answered
200 for the sibling object request, so it is not a container-egress artefact.

---

## 12. WHAT THIS MEANS FOR THE MIGRATION

`media_objects` requires `width`, `height`, `mime`, `bytes` and `sha256`, all
NOT NULL. Measured answers:

| column | obtainable? | cost |
|---|---|---|
| `width` | ✅ 20/20 | 30 bytes |
| `height` | ✅ 20/20 | 30 bytes |
| `mime` | ✅ 20/20 | 12 bytes |
| `bytes` | ✅ 20/20 | 0 (HEAD) |
| `sha256` | ✅ 20/20 | **the whole object** |
| `owner_id` | ✅ | from `posts.user_id` (Cycle 1: 0 owners missing) |

**Nothing needs to be relaxed.** All five NOT NULL columns are satisfiable from
public bytes at a measured cost of ≈80.8 MiB (extrapolated) across one full GET
per photograph. The blocker I raised in Cycle 1 — "a migration cannot be written
today" — is **retired by measurement**.

Two consequences worth stating:

1. **The stored `-l3` ladder is redundant.** The edge transformer produces any
   width on demand, from the original, without storing anything. Only 14 of 282
   entries have a stored `-l3` derivative; generating more is unnecessary.
2. **A backfill is a read-only external job, not a SQL migration.** Postgres
   cannot fetch a URL. The hashing pass must run outside the database — an edge
   function or a one-shot script — and only its *results* become rows.

---

## 13. STILL NOT MEASURABLE

- **R2 object enumeration.** I must never handle Cloudflare credentials, so the
  254 CDN objects cannot be listed. Orphans among them remain unknown. Only the
  116 objects in Supabase Storage are enumerable (46 orphaned, per Cycle 1).
- **Exact total bytes for the CDN population.** `storage.objects` records size
  for its own 116 objects only; the R2-backed objects are absent from it.
  Section 7's totals stay an extrapolation until every object is fetched.

---

## 14. STATE

- Git: clean at `f712736`, matching origin/main. Nothing committed this cycle.
- Production: ledger at `20260817102540`. Unchanged.
- Tests: last full suite 1,913 passed / 1 skipped / 0 failures. None re-run —
  no code changed.
- Requests issued: 60 measurement requests + 18 transform requests + 3
  verification HEADs = **81**, all read-only, all against already-public objects.
