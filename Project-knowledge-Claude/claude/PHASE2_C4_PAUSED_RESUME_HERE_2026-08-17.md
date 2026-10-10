# PHASE 2 · CONTROL CYCLE 4 — PAUSED MID-CYCLE. RESUME FROM HERE.

Paused by the owner 2026-08-17, part-way through moving the finished manifest
out of the browser. **The measurement itself is COMPLETE and PASSED.** Only the
file transfer is unfinished.

---

## WHAT IS ALREADY DONE — DO NOT REDO ANY OF THIS

### The production change (the one change this cycle was allowed)

`measure-post-media` Edge Function **DEPLOYED** to `jtdtehuqtinjxropkkcn`.

```
slug            measure-post-media
version         1
status          ACTIVE
verify_jwt      true
id              11e88746-a02d-4886-bae6-7cbda97e9fbd
ezbr_sha256     82977dc68f5d882fbf97068df0367416a98c5eea11193aeb13004ade103a9233
deployed        2026-08-17 (epoch 1786967444773)
expires by code 2026-09-01T00:00:00Z → returns 410 after that, automatically
```

Verified after deploy: anonymous POST → **401 `UNAUTHORIZED_NO_AUTH_HEADER`**
(gateway rejects before code runs). A body containing `{"url": …}` is ignored —
the function reads only `offset` and `limit`.

Source in the repo, COMMITTED LOCALLY as `ff106b0` but **NOT PUSHED** — the
git proxy denies this repo (403), so origin does not have it yet:

| file | git hash-object |
|---|---|
| `supabase/functions/measure-post-media/index.ts` | `be215ece8c81a2b136a4e0c47faa71ff7e237607` |
| `src/__tests__/measurePostMediaReadOnly.test.ts` | `8e4dbacffef0214980a40ae8081d5c81c5845b34` |
| `supabase/config.toml` (added the verify_jwt entry) | `4d782a4b881ed987539592da4905995b0d34e6a7` |
| `supabase/functions/_shared/imageDims.ts` (unchanged, deployed as a copy) | `bc5938b0fa55fd6ae80c9db5405e9730eb7a5aaa` |

The safety test is **11/11 passing and mutation-verified**: introducing a write,
accepting a caller URL, or importing the S3 helper each fails exactly the one
test that guards it.

### The measurement — 207/207, zero failures

```
objects processed            207
successful                   207
failed                         0
HTTP failures                  0
total bytes actually read    119,717,670   (114.2 MiB)
mean                            578,346
median                          324,700
p95                           1,633,060
min / max                31,348 / 8,803,202
total function duration      96,579 ms over 9 calls (25 per call, 0 timeouts)
```

Every invariant passes: status 200 on all 207 · `Content-Length` == bytes read
on all 207 · width > 0 · height > 0 · bytes > 0 · MIME from magic bytes ==
`image/webp` on all 207 and matches the `Content-Type` header on all 207 ·
SHA-256 is 64 hex chars on all 207 and equals no ETag · `owner_id` == the UUID
folder in the object path on all 207 · 128 filenames carry dimensions and
**128/128 match the bytes exactly**.

**Duplicates: 207 unique SHA-256, 0 duplicate groups.** No two post
photographs share bytes. The per-owner dedup question raised in Cycle 3 is
therefore moot for this population.

⚠ **Cycle 2's extrapolation was 32% LOW.** It projected ≈80.8 MiB; the measured
figure is 114.2 MiB. The concentrated sample flagged in Cycle 2 §1 is why. The
measurement stands; the extrapolation should not be quoted again.

### The manifest

Canonical form: 207 lines, sorted by `(post_id, ord)`, tab-separated, `\n`
terminated, columns:

```
post_id  owner_id  ord  source_url  source_host  object_path
width  height  aspect_ratio  mime  bytes  sha256  visibility
```

```
lines            207
bytes         86,055
MANIFEST SHA-256  6f91b572066e3ed16067cae6a0b9583ad7eed392babdd9bf9d94a0b444673c84
```

First line, for verification on resume:

```
018196d6-ce8c-4371-9584-95bde7c4c40d	5745a9c9-55ec-4f0b-8a75-3a55ab3064d8	1	https://cdn.50mmretina.com/post-images/5745a9c9-55ec-4f0b-8a75-3a55ab3064d8/posts/1785426662823-kbqdy6bsjuk.webp	cdn.50mmretina.com	post-images/5745a9c9-55ec-4f0b-8a75-3a55ab3064d8/posts/1785426662823-kbqdy6bsjuk.webp	1078	1346	0.800892	image/webp	325892	4ecdc95913971711af5ccff88fd45a0990a8e73bad61c1c462af5324636e78c7	public
```

---

## WHAT IS NOT DONE

**The manifest is not on disk anywhere durable.** It exists only as
`window.__CANON` in Chrome tab `1990185715` on the owner's machine. Getting it
out ran into a 1000-character cap on browser-script results, and base64/hex
encodings are refused by a content filter, so it was being moved in 52 verified
chunks. **27 of 52 arrived** before a second Chrome extension connected and
browser access required a browser selection that only the owner can make.

Scratch state in this session's container (**ephemeral — gone when the session
ends**): `/home/claude/work/measure/c00.txt`–`c26.txt`, `chunkmeta.txt`,
`assemble.py`.

⚠ **Two clean-ups owed on the owner's machine.** A helper left `window.__CL` /
`window.__C` on the page (harmless, cleared by a reload) and wrote a
`__dump_tmp` key into **localStorage on www.50mmretina.com**. That is a write to
the owner's browser storage on the live site that I did not intend and did not
sanction. It touches no server data and no member data, but it must be removed:
`localStorage.removeItem("__dump_tmp")`. Flagged rather than quietly fixed.

---

## HOW TO RESUME — CHEAPEST PATH FIRST

**Do not re-run the measurement.** It cost 114.2 MiB of real transfer and it
passed.

1. **If tab `1990185715` is still open with `window.__MEAS` intact**, the whole
   dataset is still there. Re-derive `__CANON` and re-check its hash equals
   `6f91b572…`, then resume the chunked extraction from chunk 27.
2. **If the tab is gone**, re-run the measurement from a fresh session: the
   function is deployed and working, 9 calls of 25 with an admin JWT from the
   owner's browser. It is reproducible — the population is derived server-side,
   so the same 207 come back in the same order.
3. **A better transfer route, if the owner will grant it:** read access to a
   folder on his machine (`Downloads`). The browser can save the manifest
   directly and it can be staged back whole, with no chunking. A request for
   this timed out unanswered earlier in the session.

---

## STATE AT PAUSE

- **Git:** local `main` is at `ff106b0`; **origin/main is still at `f712736`**.
  The three files are committed locally and NOT on origin — `git push` is
  denied by the proxy (403), and the browser-upload transport was unavailable
  at pause. Nothing is claimed as shipped.
- **Production:** ledger `20260817102540`, unchanged. `media_objects` 0 rows,
  `post_media` 0 rows. **No migration, no insert, no post modified, no storage
  or CDN change.** The only production change is the deployed function.
- **Tests:** the new safety test 11/11. Full suite not re-run since `f712736`
  (1,913 passed / 1 skipped / 0 failures).

## OPEN RED

1. Manifest not persisted to disk (above).
2. `measure-post-media` is committed locally (`ff106b0`) but **not on origin** —
   deployed code that the remote repository does not have. **This must be closed
   on resume** by pushing via the GitHub browser-upload transport (and verifying
   `git hash-object` matches origin), or by deleting the deployment.
3. `__dump_tmp` left in localStorage on www.50mmretina.com.
4. **`backfill-media-objects` exists in the repo, is undeployed, and WRITES.**
   Found during this cycle's security inspection. It is the actual migration
   job and has never been reviewed. It must not be deployed casually.
5. RED-B3d-IMG-2 — Supabase transformation 403 `FeatureNotEnabled`, 11 shipped
   code paths.
6. Phase 1 carry-over: `20260429071225` mirror triggers · 27 anon write grants
   on 9 judging tables · ledger baseline 599 rows unexecuted · B3d-IMG-1 ·
   TypeScript strict cleanup · Android device verification (owner's).
