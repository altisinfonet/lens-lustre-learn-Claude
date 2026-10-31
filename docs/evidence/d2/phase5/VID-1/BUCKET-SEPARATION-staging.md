# VID-1 · Bucket separation on staging (CONVERTER-DESIGN v2 §7, review R4)

**Lane:** staging only. Nothing on production was read or changed.
**Measured by:** Claude (ops/security helper session, Claude Opus 5.5), on the Owner's PC, 2026-10-12:
- first pass 16:07–16:16 UTC;
- revised after the review of #419, 17:01–17:15 UTC.

**Instruments:**
- the repository at `origin/staging` `1f44b5a7`;
- `npx wrangler@4` 4.149.0 with the Owner's Cloudflare OAuth login: read-only listings, one read-only object fetch, and one `pages download config` (§3a);
- `curl`.

Account, zone and KV ids and the login e-mail are redacted. **No secret was opened, selected or printed**: no key file, no `.env`, no wrangler token file, and no `access_key_id` / `secret_access_key` value.
**Verdict:** **R4 on staging is NOT closed.**
- The configuration half is measured below.
- The database half is a PROBE that runs after merge.
- The token-scope half closes only through the Auditor's own Cloudflare read (§5).

## 1 · The question
The design (§7) describes `supabase/functions/s3-presign-upload` as signing PUTs for paths that contain the caller's uid. If the credential it signs with could write the **video** bucket, a member could overwrite served video bytes after attestation. That would defeat SEC-VID-1 whether or not the converter exists. So R4 needs two things:
1. the photo side is **configured** for a bucket other than `50mm-staging-video`; and
2. the photo side's R2 **token** has no permission on `50mm-staging-video`.

Point 2 is the real control. In R2 a bucket name in a settings row only says where a request should go. Whether the request is allowed is decided by the token behind the S3 credential, bucket by bucket. The design already names token scope as the control. Point 1 is still checked, because a photo side configured for the video bucket would be wrong even with a correct token.

## 2 · Where each side gets its bucket and credential (code)
| Side | Bucket and credential come from | Evidence (repo `1f44b5a7`) |
|---|---|---|
| Photos: `s3-presign-upload` (and `s3-upload`, `s3-delete`, `s3-signed-url`, `migrate-storage`, `hard-delete-competition`, `_shared/s3.ts`) | **One row: `public.site_settings` where `key = 's3_storage_settings'`.** That jsonb holds `bucket_name`, `endpoint`, `region`, `path_prefix`, `public_url`, plus the key pair. Signing is path-style: `${endpoint}/${bucket_name}/…`. | `s3-presign-upload/index.ts:159-170` (reads the row, then `assertStorageLane`), `:183-188` (host and base URL). Every other photo function reads the same key (`grep -rn s3_storage_settings supabase/functions`). |
| Videos: `/api/video/upload-urls`, `source-url`, `convert/claim`, `complete` (Pages Functions) | **The Pages project's environment, not the database:** binding `MEDIA`, plain variables `R2_ACCOUNT_ID` / `R2_BUCKET`, and secrets `R2_UPLOAD_KEY_ID` / `R2_UPLOAD_KEY_SECRET`. The code's own header comment calls the secrets "an R2 API token scoped to that one bucket". *That is a comment, not something verified here: the token's real scope is §5's question.* | `functions/api/video/_lib.ts:5-19, 60-64`; `upload-urls.ts:66,75`; `source-url.ts:45`; `convert/claim.ts:43-44`. |

**The two sides share no code path.** The video Functions never read `s3_storage_settings`. The photo functions never read `R2_*` or `MEDIA`.

There is **no repository config file** for the Pages bindings: the repo has no `wrangler.toml`, and the bindings live in the Pages project settings. They were read live with `wrangler pages download config` (§3a).

## 3 · Cloudflare state
### 3a · Re-measured in this session (2026-10-12, non-secret; outputs verbatim except where marked)
The wrangler banner (` ⛅️ wrangler 4.149.0` and the rule under it) is left out of every block except the first.

**Buckets:**
```
$ npx wrangler@4 r2 bucket list                                    # 16:07:23Z
 ⛅️ wrangler 4.149.0
────────────────────
Listing buckets...
name:           50mm
creation_date:  2026-03-07T12:19:15.228Z

name:           50mm-staging
creation_date:  2026-08-21T19:22:35.655Z

name:           50mm-staging-video
creation_date:  2026-10-10T13:43:22.629Z

name:           agentcrm
creation_date:  2025-12-11T13:17:22.390Z
```

**Bucket sizes:**
```
$ npx wrangler@4 r2 bucket info 50mm-staging-video                 # 17:02:07Z
name:                   50mm-staging-video
created:                2026-10-10T13:43:22.629Z
location:               APAC
default_storage_class:  Standard
object_count:           1,630
bucket_size:            209 MB

$ npx wrangler@4 r2 bucket info 50mm-staging                       # 17:02:41Z
name:                   50mm-staging
created:                2026-08-21T19:22:35.655Z
location:               ENAM
default_storage_class:  Standard
object_count:           145
bucket_size:            179 MB
```
(The "Getting info…" line is also left out.)

**Which bucket each public host serves:**
```
$ npx wrangler@4 r2 bucket domain list 50mm-staging                # 16:11:32Z
Listing custom domains connected to bucket '50mm-staging'...
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
Listing custom domains connected to bucket '50mm-staging-video'...
There are no custom domains connected to this bucket.
$ npx wrangler@4 r2 bucket dev-url get 50mm-staging-video
Public access via the r2.dev URL is disabled.
```

**The video side, part 1: the staging Pages project's bindings.** These were previously only documented; they are now measured. The command was run in a new, empty scratch folder **outside the repository**. Its output was passed through a filter that prints ONLY:
- `[...r2_buckets]` / `[...vars]` section headers;
- the `binding` / `bucket_name` lines;
- the `R2_BUCKET` line;
- `R2_ACCOUNT_ID` as `<redacted>`.

No other line of the file was printed or recorded. The folder, including the downloaded `wrangler.toml` and the `.wrangler/` cache the command writes, was **deleted at 17:05:18Z**.
```
$ npx wrangler@4 pages download config lens-lustre-learn-claude-staging     # 17:03:50Z
▲ [WARNING] 🚧 `wrangler pages download config` is an experimental command. Please report any issues to …
Success! Your project settings have been downloaded to wrangler.toml
$ awk -f pages-r2-only.awk wrangler.toml          # the filter described above
[env.production.vars]
R2_ACCOUNT_ID = <redacted>
R2_BUCKET = "50mm-staging-video"
[[env.production.r2_buckets]]
bucket_name = "50mm-staging-video"
binding = "MEDIA"
```
The file has only two section headers, `[env.production.vars]` and `[[env.production.r2_buckets]]`. There is no preview-environment R2 binding or variable. A Pages project's custom domain serves its production environment, and this project carries `staging.50mmretina.com`:
```
$ npx wrangler@4 pages project list                                # 17:14:56Z
│ lens-lustre-learn-claude-staging │ lens-lustre-learn-claude-staging.pages.dev, staging.50mmretina.com     │ Yes          │ 3 minutes ago │
```
(Only the staging row is shown.)

**The video side, part 2: the media-authz Worker's live binding:**
```
$ npx wrangler@4 deployments status --name media-authz-staging     # 16:12:58Z
Created:     2026-10-12T04:27:35.033Z
Author:      <owner login>
Source:      Unknown (deployment)
Message:     -
Version(s):  (100%) 401a52e5-8a18-4038-8240-c28127aa9ded
                 Created:  2026-10-12T04:27:33.702Z
                     Tag:  -
                 Message:  -
$ npx wrangler@4 versions view 401a52e5-8a18-4038-8240-c28127aa9ded --name media-authz-staging
Version ID:  401a52e5-8a18-4038-8240-c28127aa9ded
Created:     2026-10-12T04:27:33.702Z
Author:      <owner login>
Source:      Unknown (version_upload)
Tag:         -
Message:     -

Handlers:            fetch
Compatibility Date:  2026-09-01
Secrets:
Secret Name:  MEDIA_TOKEN_KEY
Your Worker has access to the following bindings:
Binding                                                               Resource
env.VIDEO_REVOKED (<ID_REDACTED>)                  KV Namespace
env.MEDIA (50mm-staging-video)                                        R2 Bucket
env.ALLOWED_ORIGINS ("https://staging.50mmretina.com, https...")      Environment Variable
```

**Where the photo pipeline's objects actually are.** This uses the same photo key the 2026-10-10 proof used. That key was written by the photo uploader: `post-images/<uid>/posts/…`. The uid is shortened to `25d4916c-…` here.
```
$ npx wrangler@4 r2 object get "50mm-staging/post-images/25d4916c-…/posts/1787808114159-ejr5mm8hiy7-w240h140.webp" --remote --pipe | wc -c       # 16:15:16Z
3252
$ npx wrangler@4 r2 object get "50mm-staging-video/post-images/25d4916c-…/posts/1787808114159-ejr5mm8hiy7-w240h140.webp" --remote --pipe | wc -c
1
X [ERROR] The specified key does not exist.          (stderr; colour codes and the log-file line removed)

$ curl -sS -o /dev/null -D - https://cdn-staging.50mmretina.com/post-images/25d4916c-…/posts/1787808114159-ejr5mm8hiy7-w240h140.webp   # 16:15:53Z  (headers filtered to these four)
HTTP/1.1 200 OK
Content-Type: image/webp
Content-Length: 3252
ETag: "997ff166dc54ea82a95c09a0396f6dc6"
```
The ETag is the same as on 2026-10-10.

### 3b · From the record only (not re-measured in this session)
These come from `docs/evidence/d2/VID/media-authz/staging-live-proof.md`, 2026-10-10:
- the Worker `media-authz-staging` is routed on `cdn-staging.50mmretina.com/*`, fail closed, and passes non-video paths through to the photo bucket;
- the video bucket's CORS;
- the names of the Pages project's secrets.

The live readings in §3a agree with that record wherever they overlap: the Worker's `MEDIA` binding, the Pages `MEDIA` binding and `R2_BUCKET`, the custom domains, and `r2.dev` off.

## 4 · The database half: `supabase/migrations/PROBE_vid1_bucket_separation.sql` (added in this PR, NOT yet run)
The live `s3_storage_settings.bucket_name` on staging has **not** been read in this session. The only sanctioned way to read it is a PROBE through `apply-migration.yml`, which runs after merge. No workflow was dispatched.

The PROBE is READ ONLY and ends in ROLLBACK. It reads only `enabled`, `bucket_name`, `endpoint`, `path_prefix` and `public_url`, never the key pair. It fails the dispatch if:
- **B1:** `bucket_name` is `50mm-staging-video`, names any `*video*` bucket, or is not a valid R2 bucket name.
- **B2:** `endpoint` is not a bare R2 account endpoint. A path or a bucket sub-domain there would send every signed URL to whatever bucket it names, whatever `bucket_name` says.
- **B3:** `path_prefix` holds anything outside `[A-Za-z0-9_/-]`.
- **B4** (only when `p32.lane` is set; `apply-migration.yml` sets it):
  - on staging, `bucket_name` must be exactly `50mm-staging`. This is **stricter than `assertStorageLane`**, which on a non-production lane only refuses the production bucket and the production CDN host;
  - on production, `bucket_name` must be `50mm`, the same as `assertStorageLane`;
  - with the lane unset, B4 is not run and the PASS line says "B4 not run".
- **B5:** `public_url` holds a run of 32 hex characters or names `r2.cloudflarestorage.com`.

A **missing** row passes and says so: the photo functions then sign nothing. A row with **`enabled = false` is still checked** against B1–B5, because it can be switched on at any time, and the PASS line reports it as disabled.

**The Actions log of this repository is public, so the PROBE prints nothing that could be a key,** even when a field was filled in wrongly (for example, a key pasted into Bucket Name, or the S3 endpoint pasted into Public URL):
- `endpoint` and `path_prefix` are never printed;
- `bucket_name` is printed only when it is a valid R2 bucket name. Even then, any uuid, any run of 16+ hex characters and any run of 20+ letters or digits is replaced by a marker. An invalid name is withheld;
- the `public_url` host is printed only when it is a host under `50mmretina.com`. A public_url that trips B5 fails and is withheld;
- the lane is printed only as staging / production / unset.

**Behaviour test (PGlite, fake rows only): 25/25 as expected.** The harness and its output are committed under `docs/evidence/d2/phase5/VID-1/bucket-separation/`:
- `pglite-behaviour.mjs`;
- `pglite-behaviour-output.txt`, which names the probe's sha256.

The cases cover:
- no row;
- good staging and production rows;
- lane unset;
- a disabled row, both good and naming the video bucket;
- the video bucket, and another `*-video` bucket;
- three bad endpoints;
- a `../` prefix;
- a staging row naming `50mm`;
- an invalid name;
- ten L2 cases: an access-key id, a secret, a JWT, a uuid and a long token in Bucket Name; the S3 endpoint, 64 hex and a JWT in Public URL; a foreign host; an upper-case URL.

Every case also checks that **no planted value and no run of 16+ hex characters appears in anything the probe prints**. The earlier "12/12" figure in this record was a run against the previous version of the probe; this run replaces it.

**To run it after merge (Owner or Auditor):** GitHub → Actions → "Apply a database migration" → Run workflow → branch `staging`. Then:
- target: `staging`
- migration: `supabase/migrations/PROBE_vid1_bucket_separation.sql`
- confirm: the same path

The expected log line is:
`PROBE PASS VID-1-R4: lane staging; enabled; photo bucket_name 50mm-staging (not a video bucket); endpoint = bare R2 account endpoint (value withheld); public_url host cdn-staging.50mmretina.com; B4 run: staging pinned to 50mm-staging`

## 5 · The token-scope half: who can close it
**Last measured 2026-08-29** (`docs/PROMOTION_LEDGER.md` §10.2). At that time:
- the staging photo credential was token **`staging-upload`**;
- that token had **exactly one** policy, `R2 › 50mm-staging`, Workers R2 Storage Bucket Item Write;
- it was the **only** API token in the account.

Two things have changed since, so that reading **cannot be carried forward**:
1. the staging Supabase project was replaced (now `fpszggreishhuvdpkmdr`), and its `s3_storage_settings` row was entered again;
2. a second R2 token was created for video (`R2_UPLOAD_KEY_ID`, 2026-10-10). If it was made by editing the photo token, or pasted into the photo settings, separation would be gone.

**Who can close it.** `docs/PROMOTION_LEDGER.md` lines 1919-1921 (§25 table, rows 4 and 6a) are explicit:
- the R2 token's policy and bucket scope close only by "(a) auditor with Cloudflare read access — **the owner re-reading it is not closure**";
- Cloudflare dashboard values relayed by the Owner "stay OWNER-ATTESTED".

This session cannot read the token list either: the wrangler login has no API-token read scope, and its token file is off limits. So:
- **Closure:** the **Auditor reads the token list directly**, with Cloudflare read access to the account. That is the Auditor's own login or read-only membership, which the Owner grants. The Auditor records who read it and when.
- **The Owner may read it too.** The pass condition below is the same. The Owner's reading is recorded as **OWNER-ATTESTED** supporting evidence; it does not close the row.

**What is read** (read only; nothing is changed; no key is shown or needed):
1. Cloudflare dashboard → **R2 Object Storage** → **Overview** → on the right, **"Manage API tokens"** (behind the `{} API` button on some layouts).
2. The page lists **Account API tokens** and **User API tokens**. For **every** token in both lists, note three things:
   - its **name**;
   - its **permission** (Admin Read & Write / Object Read & Write / Object Read only);
   - its **bucket scope**: "Apply to all buckets in this account" or "Apply to specific buckets only", with the bucket names.
3. My Profile → **API Tokens**: any token whose permissions include **Workers R2 Storage**, with its account/bucket resources.

**Pass condition:**
- no R2-capable token is scoped to "all buckets";
- no token lists **both** `50mm-staging` and `50mm-staging-video`;
- the only token that lists `50mm-staging-video` is the video upload token, and it lists nothing else.

Then add one ordinary fact: **a photo upload on `staging.50mmretina.com` succeeds**. That shows the photo credential can write `50mm-staging`. Every token is single-bucket, so the photo credential is a `50mm-staging` token and cannot write `50mm-staging-video`, whichever token it is. Nobody has to see a key id to reach that conclusion.

**Not done, stated honestly.** The design (§7) also names a runtime check: a PUT signed with the photo token to `50mm-staging-video`, expecting 403. That needs the photo secret, which this session and the PROBE must not read. It can only run server-side, the way run `33079091310` did on 2026-08-27, in a job that holds the credential and prints only status codes. It is not part of this PR.

## 6 · Conclusion as of 2026-10-12 17:15 UTC
| Claim | Evidence | Class |
|---|---|---|
| The video side is bound to `50mm-staging-video` | Pages `lens-lustre-learn-claude-staging`: `MEDIA` → `50mm-staging-video` and `R2_BUCKET = "50mm-staging-video"` (`pages download config`, 17:03:50Z). Worker `media-authz-staging`: `MEDIA (50mm-staging-video)` (16:12:58Z). The video Functions read `R2_BUCKET` / `MEDIA` only. | **MEASURED** by this session; the Auditor has not re-read it |
| The photo side reads its bucket from `site_settings.s3_storage_settings` only, and shares no code path with the video side | source at `1f44b5a7` (§2) | **VERIFIED (code)** |
| The photo pipeline's objects live in `50mm-staging`, served by `cdn-staging.50mmretina.com`, and are absent from the video bucket | wrangler object get, domain list, curl (§3a) | **MEASURED** by this session |
| `s3_storage_settings.bucket_name` on staging is `50mm-staging`, not `50mm-staging-video` | PROBE written (§4), not yet run. Today it is supported by the photo objects and CDN above. | **INFERRED**, until the PROBE passes |
| The photo token cannot write `50mm-staging-video` | Token scope measured 2026-08-29 only; changed circumstances since (§5) | **UNVERIFIED**. An Owner reading would be OWNER-ATTESTED; closure is the Auditor's own read |

**R4 (staging) closes when both of these are recorded with who did it and when:**
1. the PROBE passes on staging, with the run log read by the Auditor; **and**
2. the **Auditor's own** Cloudflare read of the token list meets the §5 pass condition.

Production needs its own proof before promotion (design §7).

**Possible hardening, not done here.** `assertStorageLane` (`supabase/functions/_shared/s3.ts`) could also refuse any `bucket_name` containing `video`. Then a photo function would refuse to sign at all if pointed at a video bucket. That is a D2 code change for its own PR.
