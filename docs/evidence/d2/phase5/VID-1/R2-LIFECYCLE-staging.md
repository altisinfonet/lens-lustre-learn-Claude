# VID-1 · R2 lifecycle rules on the staging video bucket (CONVERTER-DESIGN v2 §3 step 11)

**Lane:** staging only. Production was not touched (it has no video bucket yet).
**Bucket:** `50mm-staging-video`
**Measured and applied by:** Claude (ops/security helper session, Claude Opus 5.5), on the Owner's PC, 2026-10-12, between 16:07:23 and 16:14:18 UTC.
**Instrument:** `npx wrangler@4`, version **4.149.0**, logged in with the Owner's Cloudflare OAuth login (`wrangler whoami` passed: account "Altis Infonet Private Limited"). Account ids are redacted below as `<ACCOUNT_ID_REDACTED>`. No secret was read or printed.
**State:** **staging-applied** (a Cloudflare bucket setting, not SQL) and **re-listed in the same session**. It has not yet been re-checked by the Auditor.

## 1 · What was asked, and why
The design (§3 step 11, and finding 3 of the #417 review in §5b) asks for a free R2 lifecycle backstop. It sits behind the Functions' own deletes:

| Prefix | Expire after | Why this age |
|---|---|---|
| `upload/video/` | **2 days** | Packages the member or the converter PUTs before `complete` copies them to `video/…`. Every PUT URL lives at most 1 h, so anything older than 2 days is an abandoned upload. |
| `upload/source/` | **4 days** | Members' originals that wait for the converter. 4 days is longer than the 48 h queue limit plus a requeue plus a 6 h claim, so an original is never removed while its job can still run. |
| anything else, **`video/` above all** | **never** | `video/…` holds the served, attested videos. No rule may touch it. |

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
The one existing rule is Cloudflare's default. It only aborts unfinished multipart uploads and never deletes a finished object. It was **kept unchanged**.

## 3 · Applied
`wrangler r2 bucket lifecycle add --help` (4.149.0) gives the syntax `add <bucket> [name] [prefix] --expire-days <n>`, with `-y` to skip the prompt. `add` adds the new rule next to the existing ones.

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

## 4 · After: the exact rule set
```
$ npx wrangler@4 r2 bucket lifecycle list 50mm-staging-video        # 2026-10-12T16:08:58Z
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
There are exactly three rules: the kept default plus the two new ones. **No rule has a prefix that matches `video/`.** An R2 rule prefix matches the start of the key, so `upload/video/` cannot match a key that starts with `video/`. The served keys are `video/<owner>/<video>/v<n>/<file>` (`src/lib/video/shared/rules.ts`, `servedKey`). The uploads are `upload/video/…` (`UPLOAD_PREFIX`) and `upload/source/<source_id>/source` (`functions/api/video/_lib.ts`, `sourceKey`).

## 5 · Things that could block or change the rules: none found
```
$ npx wrangler@4 r2 bucket lock list 50mm-staging-video             # 2026-10-12T16:14:18Z
Listing lock rules for bucket '50mm-staging-video'...
There are no lock rules for bucket '50mm-staging-video'.

$ npx wrangler@4 r2 bucket info 50mm-staging-video
name:                   50mm-staging-video
created:                2026-10-10T13:43:22.629Z
location:               APAC
default_storage_class:  Standard
object_count:           1,630
bucket_size:            209 MB
```
With no bucket lock, nothing stops an expired object from being removed.

## 6 · How to read the ages
- Ages count from each object's upload time. R2 deletes expired objects asynchronously, so "2 days" and "4 days" are the **minimum** age at deletion, not an exact time. The design treats the rules as a backstop only. The prompt deletes are done by Pages through its R2 binding: on success, final failure, cancel and account deletion.
- These rules cost nothing. Lifecycle rules have no charge, and R2 does not bill deletes.
- Objects that were already older than the limit when the rules were added (today's staging test uploads) are removed on the same asynchronous schedule.

## 7 · Rollback (only if needed)
```
npx wrangler@4 r2 bucket lifecycle remove 50mm-staging-video --name expire-upload-video-2d
npx wrangler@4 r2 bucket lifecycle remove 50mm-staging-video --name expire-upload-source-4d
```
The default multipart rule needs no change.

## 8 · Production
Not done, and not to be done from this record. Production has no video bucket yet. When one is created (design §7: a separate production video bucket with new keys, on the Owner's "go production"), these same two rules must be added to it and re-listed as evidence.
