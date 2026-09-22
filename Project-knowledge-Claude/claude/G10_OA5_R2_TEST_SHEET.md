# G8 · §8.6 — R2 WRITE-ISOLATION TEST — PASTE SHEET

> ## ⚠ STATUS UPDATE 2026-08-29 — READ BEFORE USING THIS SHEET
>
> **This test may no longer be necessary.** On 2026-08-29 the staging token's bucket scope was read
> **directly** from the Cloudflare dashboard, without touching any credential:
> token **`staging-upload`** (`73a7920647481fd93553f9c1f68bf5a3`) has **exactly one** permission
> policy — **R2 › `50mm-staging`** — and **no policy naming `50mm`**. The owner confirmed
> `site_settings.s3_storage_settings.access_key_id` matches that token ID, binding the app's
> credential to that single-bucket token.
>
> **§8.6's stated premise — *"token scope is not readable after creation"* — is false.** The *secret*
> is unreadable; the *scope* is permanently readable. The runtime test below was designed as a
> compensating control for evidence believed unobtainable, and that evidence has now been obtained
> directly. See **`claude/G8_R2_WRITE_ISOLATION_EVIDENCE_2026-08-29.md`**.
>
> **Run the commands below only if the owner rules that an observed runtime refusal is required in
> addition to the observed scope** (Option B in that record).

**If you do run it: run it on YOUR OWN machine, in a terminal. Not in any Claude session, not in CI,
not in a browser console.** The staging R2 secret must never reach a session, a log, a screenshot, or
a file — §14 HS-10 treats any of those as a hard stop requiring rotation. **This has already happened
once in this project** (G9 BLOCKER-2), which is why the current token is only days old.

---

## 0 · Where your credential is

Staging Supabase → table `site_settings` → row key **`s3_storage_settings`** → fields
**`access_key_id`** and **`secret_access_key`**.

*(Field names confirmed by reading key names only. Their values have never been read by any session.)*

Row also carries `endpoint`, `bucket_name`, `region`, `public_url`, `provider`, `path_prefix` — non-secret,
useful for cross-checking the endpoint below.

> ### 📌 Why this sheet says "AWS" when you do not use AWS
>
> Raised 2026-08-29. **It is not an error, and renaming it would break every command.**
>
> Cloudflare R2 implements the **S3 API**. The `aws` CLI is just the reference client for that API;
> the `--endpoint-url https://a7810011a99de537a210130f86306785.r2.cloudflarestorage.com` flag is what
> sends every request to **Cloudflare**, not Amazon.
>
> `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are variable names defined by the **S3 protocol's
> SigV4 signing scheme**, which R2 implements. They hold **R2 credentials**. No AWS account exists,
> none is created, and no request reaches Amazon. Your own database uses the same convention —
> `s3_storage_settings`, `access_key_id`, `secret_access_key`.
>
> The CLI reads those exact variable names, so they cannot be renamed. Other S3 clients (`rclone`,
> `s5cmd`, `mc`) work equally well with the same credentials under their own variable names.
>
> **Cloudflare's own `wrangler` CLI is NOT a substitute here:** it authenticates with account-level
> OAuth, so it would exercise the **account owner's** permissions rather than the scoped token —
> proving nothing about isolation. The whole point is to act *as the restricted credential*.

## 1 · Before you start — record the "before" state

**Cloudflare dashboard → R2 → `50mm` → Objects → "Search objects by prefix"** → type:

```
isolation-probe/
```

**Expected: zero results.** Screenshot it.
*(Captured 2026-08-29T04:37:25Z: "No objects matched your search." — zero results.)*

> **Why a prefix search and not bucket size.** The dashboard showed **Bucket Size 1.09 GB** for `50mm`
> on 2026-08-27 and **1.12 GB** on 2026-08-29 — it moves constantly because production is live and
> members are posting. A GB-rounded figure **cannot detect a 0-byte probe object**, so "size unchanged"
> would pass whether or not the test wrote. Searching the exact prefix the probe would create is a
> discriminating check; the size figure is context only.

## 2 · The four commands

```bash
# ── credentials live only in this shell; close it when you are done ──
export AWS_ACCESS_KEY_ID=…          # staging access_key_id      — never paste anywhere
export AWS_SECRET_ACCESS_KEY=…      # staging secret_access_key  — never paste anywhere
export AWS_DEFAULT_REGION=auto

EP=https://a7810011a99de537a210130f86306785.r2.cloudflarestorage.com
TS=$(date -u +%Y%m%dT%H%M%SZ)
echo "probe timestamp: $TS"

echo "── 1. KNOWN-PRESENT CONTROL — must SUCCEED ──"
aws s3api put-object --endpoint-url $EP --bucket 50mm-staging \
  --key isolation-probe/$TS.txt --body /dev/null

echo "── 2. THE TEST — must be REFUSED ──"
aws s3api put-object --endpoint-url $EP --bucket 50mm \
  --key isolation-probe/$TS.txt --body /dev/null

echo "── 3. KNOWN-ABSENT CONTROL — must be NoSuchBucket, NOT AccessDenied ──"
aws s3api put-object --endpoint-url $EP --bucket 50mm-does-not-exist-$TS \
  --key isolation-probe/$TS.txt --body /dev/null

echo "── 4. CLEAN UP CONTROL 1 ──"
aws s3api delete-object --endpoint-url $EP --bucket 50mm-staging \
  --key isolation-probe/$TS.txt
```

Commands 2 and 3 are **expected to print errors.** That is the point. Do not treat a red message as
something going wrong.

**No `aws` installed?** macOS `brew install awscli` · Windows `winget install Amazon.AWSCLI` ·
Linux `pip install awscli --user`. Installing the client involves no credential and no AWS account.

## 3 · Pass / fail

| # | Command | PASS | FAIL |
|---|---|---|---|
| 1 | put → `50mm-staging` | JSON containing an **`ETag`** | any error → the credential itself is broken; the whole run proves nothing, fix this first |
| 2 | put → **`50mm`** | **`An error occurred (AccessDenied) when calling the PutObject operation`** | **SUCCESS → STOP IMMEDIATELY.** §14 HS-1 and HS-9: the staging token is not scoped. Do not promote. Rotate the token. |
| 3 | put → non-existent bucket | **`An error occurred (NoSuchBucket)`** | **`AccessDenied` here → the test is void.** If everything answers AccessDenied, command 2's AccessDenied carries no information. Rebuild the test before recording anything. |
| 4 | delete from `50mm-staging` | succeeds | leftover control object — delete it manually |

**Command 3 is the one people skip, and it is the one that makes command 2 mean anything.**

> Note the asymmetry that motivated the 2026-08-29 scope reading: a passing command 2 proves *this
> operation was refused*. It does **not** by itself prove the token is *scoped to one bucket* — that
> is why command 3 exists, and even then it is inference. **Reading the policy list proves the scope
> outright.**

## 4 · After — record the "after" state

Same prefix search: **R2 → `50mm` → Objects → search `isolation-probe/`** → **still zero results.**
Screenshot it.

## 5 · What to send back

- The four command outputs, **with `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` lines removed**
- Both `isolation-probe/` prefix-search screenshots (before and after)
- The `$TS` value printed at the start
- The UTC time you ran it

Redact the two credential lines before sending. **Never send the values themselves — not masked, not
partially, not hashed.** A masked value is not evidence and §5.3's rule applies: masking is not proof.

## 6 · What this closes

| Requirement | On a clean pass |
|---|---|
| §8.6 exit condition **part 2** — staging credentials refused writing to the production bucket | ✅ satisfied |
| §8.6 exit condition **part 3** — production bucket unchanged across the gate | ✅ satisfied |
| **G8** | ✅ **GREEN** — this negative test is the INDEPENDENTLY-VERIFIED compensating control §8.6 names |

**Both parts are also addressed by the 2026-08-29 scope observation — see
`claude/G8_R2_WRITE_ISOLATION_EVIDENCE_2026-08-29.md`, which is the live record. Choose one route;
running both is permitted but not required.**

---

**Reference values, confirmed by direct observation:**

| Item | Value |
|---|---|
| Cloudflare account ID | `a7810011a99de537a210130f86306785` |
| R2 endpoint | `https://a7810011a99de537a210130f86306785.r2.cloudflarestorage.com` |
| Production bucket | **`50mm`** — created 2026-03-07, APAC, Standard, **Public Access Enabled**, 1.09 GB (08-27) → 1.12 GB (08-29) |
| Staging bucket | **`50mm-staging`** — created 2026-08-21 |
| Third bucket in account | `agentcrm` — unrelated to this release, do not touch |
| **Staging token** | **`staging-upload`**, id `73a7920647481fd93553f9c1f68bf5a3`, **one policy: R2 › `50mm-staging`, Bucket Item Write**, no expiration — *only token in the account* (2026-08-29) |
