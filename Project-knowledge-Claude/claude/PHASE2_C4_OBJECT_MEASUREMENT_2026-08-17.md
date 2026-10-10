# PHASE 2 · CONTROL CYCLE 4 — SERVER-SIDE OBJECT MEASUREMENT (COMPLETE)

Date: 2026-08-17 · **Production changes: ONE** — the deployment of a read-only
measurement function, exactly as approved under option (C).
No migration · no `media_objects` insert · no `post_media` insert · no `posts`
modified · no storage change · no re-upload · no derivative · no CDN
configuration change.

Supersedes `claude/PHASE2_C4_PAUSED_RESUME_HERE_2026-08-17.md`, which was the
mid-cycle handover. Everything it listed as outstanding is now closed.

---

## 1. THE MEASUREMENT PATH

A new Edge Function, `measure-post-media`. **Not** `backfill-media-objects`.

### Why a new function and not the one already in the repo

The security inspection turned up something worth stating plainly:
**`supabase/functions/backfill-media-objects` already exists in this
repository.** It is 360 lines, it is the actual media migration, it WRITES to
`media_objects` and `post_media`, and it has **never been deployed and never
been reviewed**. Deploying it — even in dry-run mode — would have put a
write-capable migration endpoint into production, which is precisely what the
approved boundaries forbade. It stays undeployed. It is now OPEN RED.

`backfill-image-dims` (deployed 2026-08-13) and `backfill-image-hashes` were
also inspected. Both write. Neither was suitable.

### What was deployed

```
slug            measure-post-media
version         1                       (new function; no prior version)
status          ACTIVE
verify_jwt      true
id              11e88746-a02d-4886-bae6-7cbda97e9fbd
ezbr_sha256     82977dc68f5d882fbf97068df0367416a98c5eea11193aeb13004ade103a9233
expires         2026-09-01T00:00:00Z — returns 410 after that, by code
```

---

## 2. SECURITY RESULT — EVERY REQUIRED GUARANTEE MET

Each control is a line of code, and each is pinned by a test that fails if the
control is removed.

| requirement | how it is guaranteed | verified |
|---|---|---|
| read-only | no `.insert` / `.update` / `.upsert` / `.delete` / `.rpc` anywhere | test + mutation |
| accepts no arbitrary URL | the body is read for two integers, `offset` and `limit`. Nothing else | test asserts the *exact set* of body properties read |
| only the verified 207 | population derived in-function with the same regex the Cycle 3 SQL proof used | test pins the pattern |
| no writes to posts / media_objects / post_media / storage / derivatives / CDN | it has no code path that writes anything | test + mutation |
| no private member data | public posts only (`privacy = 'public'`); returns no caption, no name, no email | test pins the privacy filter |
| returns no raw image bytes | returns a hex digest and integers; no base64, no body passthrough | test |
| hard object/count limit | `HARD_LIMIT = 25` per call, `HARD_MAX_CANDIDATES = 500` | test |
| hard execution/time limit | `TIME_BUDGET_MS = 50_000`, returns partial rather than being killed | test |
| rejects anything outside the population | regex gate, **plus** the host is re-checked after URL parsing | test |

### The specific questions asked before implementing

**How does it authenticate?** Two independent gates. `verify_jwt = true` makes
the Supabase gateway reject an unauthenticated request before any code runs;
the code then looks the caller up in `user_roles` and requires `admin`.

**Are service-role credentials required?** Yes, for exactly two READS: the role
check, and the `posts` scan. Never for a write, and never handed a caller-supplied
value.

**Can a client invoke it anonymously?** No — **measured**:

```
POST /functions/v1/measure-post-media   (no Authorization header)
→ 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

**Can arbitrary object paths be supplied?** No. There is no body field that
becomes a request target. A body of `{"url": "https://example.com/x.webp"}` is
simply ignored.

**Is SSRF possible?** No, and by two mechanisms rather than one: nothing from
the caller reaches `fetch`, and the one URL it does fetch is re-checked against
`CDN_HOST` after parsing, with `redirect: "error"` so a redirect cannot move the
target either.

**Can it reach private storage?** **No — and this is the strongest control
here.** It holds no storage credentials at all. It never imports `_shared/s3.ts`,
never reads `s3_storage_settings`, and never signs an S3 request. Every object
is read over ordinary public HTTPS — the same bytes any visitor already gets.
There is no private-bucket capability present to misuse.

**Can it become a permanent media access API?** It expires itself on
**2026-09-01** and returns 410 thereafter. Deleting it is still the plan; the
expiry is what happens if the plan slips.

### The test is real

`src/__tests__/measurePostMediaReadOnly.test.ts` — 11 tests, all passing, and
**mutation-verified**: introducing a write, accepting a caller URL, or importing
the S3 helper each fails exactly the one test that guards it and no other.

---

## 3. 207 OBJECT ACCESS — SUCCESS

```
objects processed              207
successful                     207
failed                           0
HTTP failures                    0
calls                            9   (25 per call)
timed out                        0
total function duration     96,579 ms
```

Every object returned HTTP 200. No retries were needed.

### Every invariant passes

| invariant | result |
|---|---|
| valid `post_id` | 207 / 207 |
| valid `owner_id` (present in `auth.users`, Cycle 3) | 207 / 207 |
| source object exists (HTTP 200) | 207 / 207 |
| `Content-Length` equals bytes actually read | 207 / 207 |
| width > 0 | 207 / 207 |
| height > 0 | 207 / 207 |
| bytes > 0 | 207 / 207 |
| MIME valid, from magic bytes | 207 / 207 `image/webp` |
| MIME from bytes == `Content-Type` header | 207 / 207 |
| SHA-256 exactly 32 bytes (64 hex chars) | 207 / 207 |
| SHA-256 is not the ETag | 207 / 207 |
| no candidate silently disappeared | 207 in, 207 out |
| no non-post asset entered the population | avatars, covers, legacy all excluded |
| no duplicate proposed `post_media` ordinal | 0 collisions; all 180 posts dense 1..n |
| `owner_id` == the UUID folder in the object path | 207 / 207 |

**Cycle 3's five unexecuted invariants are now all executed and all pass.**

---

## 4. DUPLICATES

```
unique SHA-256          207
duplicate SHA-256         0
URLs sharing bytes        0
posts sharing media       0
```

**No two post photographs share bytes.** The per-owner dedup question raised in
Cycle 3 — `(owner_id, sha256)` rather than `sha256` alone, so one member's
deletion cannot cascade away another's photograph — remains the correct rule to
encode, but it has nothing to act on in this population.

Also measured: **128 filenames carry `-wXhY` dimensions, and 128 / 128 match the
bytes exactly.** The filenames have never lied. The bytes remain authoritative.

---

## 5. COST — MEASURED, NOT EXTRAPOLATED

```
total objects processed      207
successful                   207
failed                         0
HTTP failures                  0
total bytes actually read    119,717,670   (114.16 MiB)
average                         578,346
median                          324,700
p95                           1,633,060
min / max                31,348 / 8,803,202
duration                     96,579 ms across 9 calls
```

⚠ **Cycle 2's extrapolation was 32% LOW.** It projected ≈80.8 MiB from a 20-file
sample; the measured figure is 114.16 MiB. The cause is the sampling weakness
Cycle 2 flagged in its own §1 — ordering by URL concentrated the CDN half on one
photographer. The measurement supersedes it. **The ≈80.8 MiB figure should not
be quoted again.**

---

## 6. THE MANIFEST — CREATED

```
file           PHASE2_MANIFEST_207_2026-08-17.tsv
lines          207
bytes          86,055
MANIFEST HASH  6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84
```

Canonical form: sorted by `(post_id, ord)`, tab-separated, newline-terminated,
13 columns:

```
post_id  owner_id  ord  source_url  source_host  object_path
width  height  aspect_ratio  mime  bytes  sha256  visibility
```

**It has not been applied. Nothing was written to production from it.**

### It is provably the right 207

The manifest was built in the browser, moved to the workspace in 52
checksum-verified chunks, and then checked three ways:

1. **Content hash** — the file on disk hashes to `6f91b572…`, identical to the
   hash computed at the source before transfer. The transport was lossless.
2. **Structural validation** — independently re-run against the file: 13 columns
   on every row, all UUIDs well-formed, all 207 digests 64 hex and unique, all
   hosts `cdn.50mmretina.com`, all MIME `image/webp`, all visibility `public`,
   `source_url == host + "/" + object_path` on every row, `owner_id` == the path
   folder on every row, `aspect_ratio == width/height` on every row, ordinals
   dense 1..n per post, 0 duplicate `(post_id, ord)`, 0 duplicate URLs.
   180 posts, 48 owners, entries-per-post 167×1 / 4×2 / 7×3 / 1×5 / 1×6 —
   matching the Cycle 3 SQL proof exactly.
3. **Cross-check against production** — the md5 of the manifest's
   `(post_id|ord|url)` key set, computed locally, is
   `f0a74d3e74d8a52f61de92a2e0ab429a`. The same digest computed **inside
   Postgres** over the candidates existing at the Cycle 3 snapshot fence is
   `f0a74d3e74d8a52f61de92a2e0ab429a`. **Identical.** Zero additions, zero
   omissions, zero alterations.

### ⚠ Snapshot drift has already begun

Production now holds **208** candidates, not 207. One new post photograph
appeared at **2026-08-17 13:23:31 UTC**, after the Cycle 3 fence of 10:52:06.
The manifest is a snapshot and is correct *as of that fence* — the cross-check
above proves it — but it is now short by one. Any migration must either re-fence
or handle arrivals explicitly. **A live platform will keep doing this.**

---

## 7. SUPABASE TRANSFORMATION — RECORDED, NOT FIXED

**RED-B3d-IMG-2** — `/storage/v1/render/image/public/…` returns
`403 FeatureNotEnabled` for this tenant; 11 shipped code paths build that URL.
Untouched again this cycle.

Architectural constraint, now enforced by construction: `measure-post-media`
does not use that endpoint, and the Phase 2 media architecture must not depend
on it. All 207 candidates are CDN-hosted, so the disabled endpoint is irrelevant
to the migration and relevant only to the delivery bug.

---

## 8. STATE

- **Git:** `origin/main` = `5ebbca55f8442cc786a75a7fc9d1bbc3020162da`, local
  identical, working tree clean. Three files landed and were **hash-verified
  against origin**:

  | file | hash (local == origin) |
  |---|---|
  | `supabase/functions/measure-post-media/index.ts` | `be215ece8c81a2b136a4e0c47faa71ff7e237607` |
  | `src/__tests__/measurePostMediaReadOnly.test.ts` | `8e4dbacffef0214980a40ae8081d5c81c5845b34` |
  | `supabase/config.toml` | `4d782a4b881ed987539592da4905995b0d34e6a7` |

  No trigger path was touched, so **no Android build was cut**.

  ⚠ Transport note, recorded because it matters: the first attempt at all three
  uploads *appeared* to commit and did not — the commit button was clicked by
  element reference and nothing submitted. Only hash verification against origin
  caught it. Two files then landed and `index.ts` still had not; it took a third
  pass. **The transport invariant did its job. "It looked like it worked" is not
  evidence.**

- **Production:** ledger `20260817102540`, unchanged. `media_objects` **0 rows**,
  `post_media` **0 rows** — re-verified this cycle.
- **Tests:** full suite **1,924 passed / 1 skipped / 0 failures** across 155
  files (was 1,913; +11 from the new safety test).
- **Clean-up owed from the paused handover, now closed:** `__dump_tmp` removed
  from localStorage on www.50mmretina.com (confirmed `null`), and the temporary
  `window.__C` / `window.__CL` globals deleted.

---

## OPEN RED

1. **`backfill-media-objects` sits in the repo, undeployed, unreviewed, and it
   WRITES.** It is the real migration. It must not be deployed casually.
2. `measure-post-media` should be **deleted** once the manifest is approved. It
   expires 2026-09-01 either way, but expiry is a backstop, not a plan.
3. Population drift: 208 now vs 207 measured. A migration needs a re-fence or an
   explicit arrivals policy.
4. CDN/R2 orphan completeness still unknowable — I must never handle Cloudflare
   credentials.
5. **RED-B3d-IMG-2** — Supabase transformation 403, 11 shipped code paths.
6. Phase 1 carry-over: `20260429071225` mirror triggers · 27 anon write grants on
   9 judging tables · ledger baseline 599 rows unexecuted · B3d-IMG-1 ·
   TypeScript strict cleanup (49 errors / 29 files) · Android device
   verification for build 1106 / v1.2.14 (yours).
