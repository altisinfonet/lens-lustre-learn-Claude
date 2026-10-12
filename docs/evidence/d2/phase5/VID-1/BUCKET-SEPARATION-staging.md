# VID-1 · Bucket separation on staging (CONVERTER-DESIGN v2 §7, review R4)

**Lane:** staging only. Nothing on production was read or changed.
**Measured by:** Claude (ops/security helper session, Claude Opus 5.5), on the Owner's PC, 2026-10-12, between 16:07 and 16:16 UTC.
**Instruments:**
- the repository at `origin/staging` `1f44b5a7`;
- `npx wrangler@4` 4.149.0 with the Owner's Cloudflare OAuth login: read-only listings plus one read-only object fetch;
- `curl`.

Account, zone and KV ids are redacted. **No secret was opened, selected or printed**: no key file, no `.env`, no wrangler token file, and no `access_key_id` / `secret_access_key` value.
**Verdict:** **R4 on staging is NOT closed yet.** The configuration half is measured below. The database half is a PROBE that runs after merge. The token-scope half needs a read in the Cloudflare dashboard (§5).

## 1 · The question
`supabase/functions/s3-presign-upload` signs PUTs for paths that contain the caller's uid, with no length cap. The design (§7) says: if the credential it signs with could write the **video** bucket, a member could overwrite served video bytes after attestation. That would defeat SEC-VID-1 whether or not the converter exists. So R4 needs two things:
1. the photo side is **configured** for a bucket other than `50mm-staging-video`; and
2. the photo side's R2 **token** has no permission on `50mm-staging-video`.

Point 2 is the real control. In R2 a bucket name in a settings row only says where a request should go. Whether the request is allowed is decided by the token behind the S3 credential, bucket by bucket. The design already names token scope as the control. Point 1 is still checked, because a photo side configured for the video bucket would be wrong even with a correct token.

## 2 · Where each side gets its bucket and credential (code)
| Side | Bucket and credential come from | Evidence (repo `1f44b5a7`) |
|---|---|---|
| Photos: `s3-presign-upload` (and `s3-upload`, `s3-delete`, `s3-signed-url`, `migrate-storage`, `hard-delete-competition`, `_shared/s3.ts`) | **One row: `public.site_settings` where `key = 's3_storage_settings'`.** That jsonb holds `bucket_name`, `endpoint`, `region`, `path_prefix`, `public_url`, plus the key pair. Signing is path-style: `${endpoint}/${bucket_name}/…`. | `s3-presign-upload/index.ts:159-170` (reads the row, then `assertStorageLane`), `:183-188` (host and base URL). Every other photo function reads the same key (`grep -rn s3_storage_settings supabase/functions`). |
| Videos: `/api/video/upload-urls`, `source-url`, `convert/claim`, `complete` (Pages Functions) | **The Pages project's environment, not the database:** binding `MEDIA`, plain variables `R2_ACCOUNT_ID` / `R2_BUCKET`, and secrets `R2_UPLOAD_KEY_ID` / `R2_UPLOAD_KEY_SECRET`. These are "an R2 API token scoped to that one bucket". | `functions/api/video/_lib.ts:5-19, 60-64`; `upload-urls.ts:66,75`; `source-url.ts:45`; `convert/claim.ts:43-44`. |

There is **no repository config file** for the Pages bindings. The repo has no `wrangler.toml`; the bindings live in the Pages project settings. `wrangler` 4.149.0 has no command that lists a Pages project's bindings. So the Pages side is taken from the 2026-10-10 record, plus the live Worker reading in §3.

- **Documented 2026-10-10** (`docs/evidence/d2/VID/media-authz/staging-live-proof.md`): Pages `lens-lustre-learn-claude-staging` binds `MEDIA` → `50mm-staging-video`, and photos are "still served from bucket `50mm-staging`".
- **The two sides share no code path.** The video Functions never read `s3_storage_settings`. The photo functions never read `R2_*` or `MEDIA`.

## 3 · Live Cloudflare measurements (2026-10-12, non-secret)
```
$ npx wrangler@4 r2 bucket list                                    # 16:07:23Z
name:           50mm               creation_date:  2026-03-07T12:19:15.228Z
name:           50mm-staging       creation_date:  2026-08-21T19:22:35.655Z
name:           50mm-staging-video creation_date:  2026-10-10T13:43:22.629Z
name:           agentcrm           creation_date:  2025-12-11T13:17:22.390Z
```
(Each `name:` / `creation_date:` pair is joined onto one line here. The values are verbatim.)

**Which bucket each public host serves:**
```
$ npx wrangler@4 r2 bucket domain list 50mm-staging                # 16:11:32Z
domain:            cdn-staging.50mmretina.com
enabled:           Yes
ownership_status:  active
ssl_status:        active
min_tls_version:   1.0
zone_id:           <ID_REDACTED>
zone_name:         50mmretina.com
$ npx wrangler@4 r2 bucket dev-url get 50mm-staging
Public access via the r2.dev URL is disabled.

$ npx wrangler@4 r2 bucket domain list 50mm-staging-video          # 16:12:10Z
There are no custom domains connected to this bucket.
$ npx wrangler@4 r2 bucket dev-url get 50mm-staging-video
Public access via the r2.dev URL is disabled.
```

**What the video side is bound to.** This is the Worker on the staging CDN host, re-measured here, not copied from the record:
```
$ npx wrangler@4 deployments status --name media-authz-staging     # 16:12:58Z
Version(s):  (100%) 401a52e5-8a18-4038-8240-c28127aa9ded   Created: 2026-10-12T04:27:33.702Z
$ npx wrangler@4 versions view 401a52e5-8a18-4038-8240-c28127aa9ded --name media-authz-staging
Secrets:   Secret Name:  MEDIA_TOKEN_KEY
Your Worker has access to the following bindings:
env.VIDEO_REVOKED (<ID_REDACTED>)                         KV Namespace
env.MEDIA (50mm-staging-video)                            R2 Bucket
env.ALLOWED_ORIGINS ("https://staging.50mmretina.com, https...")  Environment Variable
```

**Where the photo pipeline's objects actually are.** This uses the same photo key the 2026-10-10 proof used. That key was written by the photo uploader: `post-images/<uid>/posts/…`.
```
$ npx wrangler@4 r2 object get "50mm-staging/post-images/25d4916c-…/posts/1787808114159-ejr5mm8hiy7-w240h140.webp" --remote --pipe | wc -c       # 16:15:16Z
3252
$ npx wrangler@4 r2 object get "50mm-staging-video/post-images/25d4916c-…/posts/1787808114159-ejr5mm8hiy7-w240h140.webp" --remote --pipe
✘ [ERROR] The specified key does not exist.

$ curl -sS -o /dev/null -D - https://cdn-staging.50mmretina.com/post-images/25d4916c-…/posts/1787808114159-ejr5mm8hiy7-w240h140.webp   # 16:15:53Z
HTTP/1.1 200 OK
Content-Type: image/webp
Content-Length: 3252
ETag: "997ff166dc54ea82a95c09a0396f6dc6"        (identical to 2026-10-10)
```
**Bucket sizes:** `50mm-staging` holds 145 objects / 179 MB (ENAM). `50mm-staging-video` holds 1,630 objects / 209 MB (APAC).

## 4 · The database half: `supabase/migrations/PROBE_vid1_bucket_separation.sql` (added in this PR, NOT yet run)
The live `s3_storage_settings.bucket_name` on staging has **not** been read in this session. The only sanctioned way to read it is a PROBE through `apply-migration.yml`, which runs after merge. No workflow was dispatched.

The PROBE is READ ONLY and ends in ROLLBACK. It reads only `enabled`, `bucket_name`, `endpoint`, `path_prefix` and `public_url`. It never reads the key pair and never prints the endpoint, because the endpoint carries the account id. It fails the dispatch if:
- **B1:** `bucket_name` is `50mm-staging-video`, names any `*video*` bucket, or is not a valid R2 bucket name;
- **B2:** `endpoint` is not a bare R2 account endpoint. A path or a bucket sub-domain there would send every signed URL to whatever bucket it names, whatever `bucket_name` says;
- **B3:** `path_prefix` holds anything outside `[A-Za-z0-9_/-]`;
- **B4:** on `p32.lane = staging`, `bucket_name` ≠ `50mm-staging` (on production, ≠ `50mm`).

A missing or disabled row passes, and says so: the photo functions then sign nothing.

**Local behaviour check (PGlite, fake rows only, 2026-10-12): 12/12 cases as expected.** These covered:
- no row;
- a good staging row, with and without a trailing slash;
- a good production row;
- the video bucket name;
- another `*-video` name;
- an endpoint with a path;
- an endpoint with a bucket sub-domain;
- no endpoint;
- a `../` prefix;
- a staging row naming `50mm`;
- an invalid bucket name.

No output contained a 32-hex id or a key field.

**To run it after merge (Owner or Auditor):** GitHub → Actions → "Apply a database migration" → Run workflow → branch `staging`. Then:
- target: `staging`
- migration: `supabase/migrations/PROBE_vid1_bucket_separation.sql`
- confirm: the same path

The expected log line is `PROBE PASS VID-1-R4: lane staging; enabled t; photo bucket_name 50mm-staging (not a video bucket); endpoint = bare R2 account endpoint; public_url host cdn-staging.50mmretina.com`.

## 5 · The token-scope half: what only the Owner can look at (no secret involved)
**Last measured 2026-08-29** (`docs/PROMOTION_LEDGER.md` §10.2). At that time:
- the staging photo credential was token **`staging-upload`**;
- that token had **exactly one** policy, `R2 › 50mm-staging`, Workers R2 Storage Bucket Item Write;
- it was the **only** API token in the account.

Two things have changed since, so that reading **cannot be carried forward**:
1. the staging Supabase project was replaced (now `fpszggreishhuvdpkmdr`), and its `s3_storage_settings` row was entered again;
2. a second R2 token was created for video (`R2_UPLOAD_KEY_ID`, 2026-10-10). If the Owner made it by editing the photo token, or pasted it into the photo settings, separation would be gone.

**Owner, please look at this. Read only; change nothing; no key is shown or needed:**
1. Cloudflare dashboard → **R2 Object Storage** → **Overview** → on the right, **"Manage API tokens"** (behind the `{} API` button on some layouts).
2. The page lists **Account API tokens** and **User API tokens**. For **every** token in both lists, open it (⋯ → Edit, then look without saving) and note three things:
   - its **name**;
   - its **permission** (Admin Read & Write / Object Read & Write / Object Read only);
   - its **bucket scope**: "Apply to all buckets in this account" or "Apply to specific buckets only", with the bucket names.
3. Also: My Profile → **API Tokens**. Note any token whose permissions include **Workers R2 Storage**, with its account/bucket resources.

**Pass condition:**
- no R2-capable token is scoped to "all buckets";
- no token lists **both** `50mm-staging` and `50mm-staging-video`;
- the only token that lists `50mm-staging-video` is the video upload token, and it lists nothing else.

Then add one ordinary fact: **a photo upload on `staging.50mmretina.com` succeeds** (post any photo; it appears). That shows the photo credential can write `50mm-staging`. Every token is single-bucket, so the photo credential is a `50mm-staging` token and cannot write `50mm-staging-video`, whichever token it is. Nobody has to see a key id to reach that conclusion.

**Not done, stated honestly.** The design (§7) also names a runtime check: a PUT signed with the photo token to `50mm-staging-video`, expecting 403. That needs the photo secret, which this session and the PROBE must not read. It can only run server-side, the way run `33079091310` did on 2026-08-27, in a job that holds the credential and prints only status codes. It is not part of this PR.

## 6 · Conclusion as of 2026-10-12 16:16 UTC
| Claim | Evidence | Class |
|---|---|---|
| The video side is bound to `50mm-staging-video` | Worker `media-authz-staging` live binding `MEDIA (50mm-staging-video)`. Pages binding per the 2026-10-10 record. Video Functions read `R2_BUCKET` / `MEDIA` only. | **MEASURED** (Worker) · DOCUMENTED (Pages) |
| The photo side reads its bucket from `site_settings.s3_storage_settings` only, and shares no code path with the video side | source at `1f44b5a7` (§2) | **VERIFIED (code)** |
| The photo pipeline's objects live in `50mm-staging`, served by `cdn-staging.50mmretina.com`, and are absent from the video bucket | wrangler object get, domain list, curl (§3) | **MEASURED** |
| `s3_storage_settings.bucket_name` on staging is `50mm-staging`, not `50mm-staging-video` | PROBE written (§4), not yet run. Today it is supported by the photo objects and CDN above. | **INFERRED**, until the PROBE passes |
| The photo token cannot write `50mm-staging-video` | Token scope measured 2026-08-29 only; changed circumstances since (§5) | **UNVERIFIED**, needs the Owner's dashboard read plus the Auditor |

**R4 (staging) closes when** the PROBE passes on staging **and** the token list in §5 meets the pass condition, recorded with who read it and when. Production needs its own proof before promotion (design §7).

**Possible hardening, not done here.** `assertStorageLane` (`supabase/functions/_shared/s3.ts`) could also refuse any `bucket_name` containing `video`. Then a photo function would refuse to sign at all if pointed at a video bucket. That is a D2 code change for its own PR.
