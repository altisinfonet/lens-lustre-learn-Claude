# VID-1 · R2 lifecycle rules on the staging video bucket (CONVERTER-DESIGN v2 §3 step 11)

**Lane:** staging only. Production was not touched (it has no video bucket yet).
**Bucket:** `50mm-staging-video`
**Measured and applied by:** Claude (ops/security helper session, Claude Opus 5.5), on the Owner's PC, 2026-10-12:
- first application 16:07:23–16:14:18 UTC;
- revised after the review of #419 (finding M1) 16:58:38–17:02:07 UTC.

**Instrument:** `npx wrangler@4`, version **4.149.0**, logged in with the Owner's Cloudflare OAuth login (`wrangler whoami` passed: account "Altis Infonet Private Limited"). None of the commands below prints an account id. No secret was read or printed.
**State:** **staging-applied** (a Cloudflare bucket setting, not SQL) and **re-listed in the same session** (§4). It has not yet been re-checked by the Auditor.

## 1 · The rules, and why each age
The design (§3 step 11; finding 3 of the #417 review in §5b) asks for a free R2 lifecycle backstop. It sits behind the Functions' own deletes (§6).

| Prefix | Expire after | Why this age |
|---|---|---|
| `upload/video/` | **2 days** | The package files the member or the converter PUTs before `complete` copies them to `video/…` (details below). |
| `upload/source/` | **8 days** | The members' originals that wait for the converter. The worst case below is about 181 h, against 192 h. |
| anything else, **`video/` above all** | **never** | `video/…` holds the served, attested videos. No rule may touch it. |

**`upload/source/`: how long an original can still be needed.** All of this is from the code at `origin/staging` `1f44b5a7`. The clock starts at the original's PUT, because R2 ages an object from its upload.

| Step | Longest | Code |
|---|---|---|
| a · PUT → queued | < 24 h + 5 min | Housekeeping (every 5 min) fails a source still `awaiting_upload` 24 h after `created_at`, and the PUT comes after `created_at`. `source-complete` does not look at the object's age. (`20261012_0002` ~946, `functions/api/video/source-complete.ts`) |
| b · each wait in the queue | ≤ 48 h + 5 min | Housekeeping fails a source `queued` 48 h after `queued_at`. `video_source_claim` does not check the age itself. (~953, ~570) |
| c · each attempt that is requeued | < 6 h | A requeue (`video_source_fail('internal')` with attempts < 3, or a lease that ran out) sets `queued_at = now()` (~660, ~816). It only happens before the claim is 6 h old: at 6 h the job fails as `too_long` (~651), and the lease never runs past `claimed_at + 6 h` (~702). |
| d · attempts | 3 | The original is read at the START of an attempt: `convert/claim` HEADs it, then hands out a GET valid at most until the 30-min lease runs out (minus 30 s). |

**Worst case:** a + 3 × b + 2 × c + 30 min + the download, which is 24 h 05 m + 144 h 15 m + 12 h + 30 m ≈ **181 h** (7 d 13 h) plus the download.
- 4 days (96 h) is far too short.
- 7 days (168 h) is about 13 h short.
- **8 days (192 h)** covers it with about 11 h to spare.

R2 removes an expired object asynchronously, after the object reaches the rule's age; the rule therefore only has to be longer than the worst case.

The review of #419 asked for 7 days, based on 3 × (48 h + 6 h) = 162 h. That count starts the clock at queueing, so it leaves out step a (up to 24 h). It also counts a full 6 h third attempt, which no longer needs the original. Rule 8 d was applied instead of 7 d for that reason (§3b). If 7 d is preferred, it is one command, but it would not cover step a.

The bound assumes the 5-minute housekeeping job runs. It is scheduled by `20261012_0002` and checked by its PROBE, and the health check alerts when jobs wait. If housekeeping stopped, nothing would time a job out. A job then claimed more than 8 days after its PUT fails as `source_missing`: final, and the member sees fixed text.

**`upload/video/`: why 2 days is kept.**
- Every PUT URL lives at most 1 h.
- `video_housekeeping` (`20261005_0005`, hourly at :41) fails a version left `uploading` 48 h after `videos.updated_at`. Every update of the row sets `updated_at`, and the version's URLs are minted after that. `complete` must run before then, so a package is needed for less than 49 h after its PUT.
- So a `complete` sent in the last hour of that window could, in principle, find a part already removed. That upload then fails and is sent again. No served `video/` object is involved.
- The converter's own uploads finish inside its claim (< 6 h).

## 2 · Before: the existing rules (kept)
```
$ npx wrangler@4 r2 bucket lifecycle list 50mm-staging-video        # 2026-10-12T16:07:39Z
 ⛅️ wrangler 4.149.0
────────────────────
Listing lifecycle rules for bucket '50mm-staging-video'...
name:     Default Multipart Abort Rule
enabled:  Yes
prefix:   (all prefixes)
action:   Abort incomplete multipart uploads after 7 days
```
The one existing rule is Cloudflare's default. It only aborts unfinished multipart uploads and never deletes a finished object. It was **kept unchanged** throughout.

## 3 · Applied
`wrangler r2 bucket lifecycle add --help` (4.149.0) gives the syntax `add <bucket> [name] [prefix] --expire-days <n>`, with `-y` to skip the prompt. `remove <bucket> --name <rule>` removes one rule. `add` adds the new rule next to the existing ones.

### 3a · First application (superseded for `upload/source/`)
```
$ npx wrangler@4 r2 bucket lifecycle add 50mm-staging-video expire-upload-video-2d "upload/video/" --expire-days 2 -y     # 2026-10-12T16:08:16Z
 ⛅️ wrangler 4.149.0
────────────────────
Adding lifecycle rule 'expire-upload-video-2d' to bucket '50mm-staging-video'...
✨ Added lifecycle rule 'expire-upload-video-2d' to bucket '50mm-staging-video'.

$ npx wrangler@4 r2 bucket lifecycle add 50mm-staging-video expire-upload-source-4d "upload/source/" --expire-days 4 -y   # 2026-10-12T16:08:42Z
 ⛅️ wrangler 4.149.0
────────────────────
Adding lifecycle rule 'expire-upload-source-4d' to bucket '50mm-staging-video'...
✨ Added lifecycle rule 'expire-upload-source-4d' to bucket '50mm-staging-video'.
```

### 3b · Revision after the review of #419 (M1): `upload/source/` from 4 days to 8 days
State just before, unchanged since 16:08:58Z:
```
$ npx wrangler@4 r2 bucket lifecycle list 50mm-staging-video        # 2026-10-12T16:58:38Z
 ⛅️ wrangler 4.149.0
────────────────────
Listing lifecycle rules for bucket '50mm-staging-video'...
name:     Default Multipart Abort Rule
enabled:  Yes
prefix:   (all prefixes)
action:   Abort incomplete multipart uploads after 7 days

name:     expire-upload-source-4d
enabled:  Yes
prefix:   upload/source/
action:   Expire objects after 4 days

name:     expire-upload-video-2d
enabled:  Yes
prefix:   upload/video/
action:   Expire objects after 2 days
```
The old rule was removed first, so that no original was ever under a shorter rule than intended:
```
$ npx wrangler@4 r2 bucket lifecycle remove 50mm-staging-video --name expire-upload-source-4d                            # 2026-10-12T16:59:12Z
 ⛅️ wrangler 4.149.0
────────────────────
Removing lifecycle rule 'expire-upload-source-4d' from bucket '50mm-staging-video'...
Lifecycle rule 'expire-upload-source-4d' removed from bucket '50mm-staging-video'.

$ npx wrangler@4 r2 bucket lifecycle add 50mm-staging-video expire-upload-source-8d "upload/source/" --expire-days 8 -y   # 2026-10-12T16:59:54Z
 ⛅️ wrangler 4.149.0
────────────────────
Adding lifecycle rule 'expire-upload-source-8d' to bucket '50mm-staging-video'...
✨ Added lifecycle rule 'expire-upload-source-8d' to bucket '50mm-staging-video'.
```

## 4 · After: the exact rule set now live
```
$ npx wrangler@4 r2 bucket lifecycle list 50mm-staging-video        # 2026-10-12T17:00:41Z
 ⛅️ wrangler 4.149.0
────────────────────
Listing lifecycle rules for bucket '50mm-staging-video'...
name:     Default Multipart Abort Rule
enabled:  Yes
prefix:   (all prefixes)
action:   Abort incomplete multipart uploads after 7 days

name:     expire-upload-source-8d
enabled:  Yes
prefix:   upload/source/
action:   Expire objects after 8 days

name:     expire-upload-video-2d
enabled:  Yes
prefix:   upload/video/
action:   Expire objects after 2 days
```
There are exactly three rules: the kept default, `upload/video/` after 2 days, and `upload/source/` after 8 days.

**No rule has a prefix that matches `video/`.** An R2 rule prefix matches the start of the key, so `upload/video/` cannot match a key that starts with `video/`.
- The served keys are `video/<owner>/<video>/v<n>/<file>` (`src/lib/video/shared/rules.ts`, `servedKey`).
- The uploads are `upload/video/…` (`UPLOAD_PREFIX`) and `upload/source/<source_id>/source` (`functions/api/video/_lib.ts`, `sourceKey`).

## 5 · Things that could block or change the rules: none found
```
$ npx wrangler@4 r2 bucket lock list 50mm-staging-video             # 2026-10-12T17:01:45Z
 ⛅️ wrangler 4.149.0
────────────────────
Listing lock rules for bucket '50mm-staging-video'...
There are no lock rules for bucket '50mm-staging-video'.

$ npx wrangler@4 r2 bucket info 50mm-staging-video                  # 2026-10-12T17:02:07Z
 ⛅️ wrangler 4.149.0
────────────────────
Getting info for '50mm-staging-video'...
name:                   50mm-staging-video
created:                2026-10-10T13:43:22.629Z
location:               APAC
default_storage_class:  Standard
object_count:           1,630
bucket_size:            209 MB
```
With no bucket lock, nothing stops an expired object from being removed. The same two readings at 16:14:18Z gave the same values.

## 6 · Who removes what: the rules are the only remover in several cases
**Prompt deletes, by Pages through its R2 binding.** These happen only when a Pages Function sees a job end:
- `convert/finish`: after the database has marked the job done or failed;
- `convert/claim`: when the original is unusable at claim and the database has ended the job;
- `source-cancel`: after a cancel, or when the job had already ended;
- `source-complete`: deletes an upload of the wrong size at once, and the member uploads again.

**Nothing else deletes an original.** In each of these cases the lifecycle rule is the ONLY remover (originals at 8 days, `upload/video/` parts at 2 days):
- **A job that ends inside the database:** the 24 h upload timeout, the 48 h queue timeout, a lease that ran out on the last attempt or at 6 h, and the 2-day purge of ended rows. None of these calls Pages.
- **A deleted account.** `supabase/functions/delete-my-account` and `delete-user` contain no video code. Deleting the account only cascades the database rows (`video_sources.owner_id … ON DELETE CASCADE`).

**How the ages behave:**
- Ages count from each object's upload time. R2 removes expired objects asynchronously, so "2 days" and "8 days" are the **minimum** age at removal, not an exact time.
- R2 judges every matching object by its own upload time, including objects that were in the bucket before the rule. The bucket was created 2026-10-10T13:43:22Z, so:
  - any `upload/video/` object written before 2026-10-10T16:08Z was already past 2 days when that rule was added, and became eligible at once;
  - no `upload/source/` object can reach 8 days before 2026-10-18T13:43Z.
- These rules cost nothing. Lifecycle rules have no charge, and R2 does not bill deletes.

## 7 · Rollback (only if needed)
```
npx wrangler@4 r2 bucket lifecycle remove 50mm-staging-video --name expire-upload-video-2d
npx wrangler@4 r2 bucket lifecycle remove 50mm-staging-video --name expire-upload-source-8d
```
The default multipart rule needs no change.

## 8 · Production
Not done, and not to be done from this record. Production has no video bucket yet. When one is created (design §7: a separate production video bucket with new keys, on the Owner's "go production"), the same two rules must be added to it and re-listed as evidence:
- `upload/video/` after **2 days**;
- `upload/source/` after **8 days**, because the worst case in §1 is about 181 h, against 192 h.

If the queue's limits change (the 24 h upload timeout, the 48 h queue timeout, 3 attempts, the 6 h claim), the bound in §1 must be redone first.
