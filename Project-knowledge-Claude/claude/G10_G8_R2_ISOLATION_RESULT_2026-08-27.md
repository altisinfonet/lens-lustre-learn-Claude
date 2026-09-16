# G8 · §8.6 — R2 WRITE-ISOLATION RESULT

**Run 3 · id `33079091310` · job `98541056457` · commit `ca95f50` · branch `scratch/g10-r2-isolation-20260827c`
· 2026-08-27T13:52Z · 13s. Executed by the owner via GitHub Actions. No credential ever entered a Claude session.**

## Measured outcome — verbatim from the log

| # | Call | Result | Line |
|---|---|---|---|
| 1 | `put-object` → **`50mm-staging`** | **SUCCESS** — `exit=0` | 150 |
| 1b | `head-object` → `50mm-staging` | **SUCCESS** — `ContentLength: 0`, `ETag "d41d8cd98f00b204e9800998ecf8427e"` (the MD5 of an empty object — the write is real, not merely reported) | 144–149 |
| — | | `CONTROL 1 OK: object created and confirmed present in 50mm-staging.` | 152 |
| 2 | `put-object` → **`50mm`** (production) | **REFUSED — AccessDenied** | 153 |
| — | | `TEST OK: write to 50mm refused with AccessDenied.` | 153 |
| 3 | `put-object` → non-existent bucket | **AccessDenied** — *not* `NoSuchBucket` | 154 |
| 4 | cleanup | `control object deleted from 50mm-staging` | 157 |

**Job conclusion: FAILURE — by design, on control 3 only.**

## What is proven, and what is not

**PROVEN:** the staging credential is live (it wrote and read back a real object in `50mm-staging`) and is
**refused when writing to the production bucket**. Because control 1 succeeded in the same run with the
same credential, the AccessDenied on `50mm` **cannot** be explained by a dead, expired or malformed
credential. That was the substantive question §8.6 exists to answer, and it is answered.

**NOT PROVEN as specified:** Appendix A.5's known-absent control. It requires a non-existent bucket to
answer `NoSuchBucket`, distinct from `AccessDenied`. **On the tested credential (`staging-upload`) and the
tested endpoint it returned `AccessDenied` instead, so it did not discriminate in this run.**

> **⚠ SCOPE CORRECTION, 2026-08-27.** An earlier version of this document asserted that the control *"can
> never pass on R2"* and that *"R2 answers AccessDenied for any bucket the token is not scoped to."*
> **That was a universal claim drawn from a single observation and is withdrawn.** One credential was
> tested against one endpoint. A credential with broader read scope was **not** tested, and the
> enumeration-protection rationale would not necessarily apply to one. **Whether A.5's control can be made
> to discriminate on R2 remains untested, not disproved.**

## FINDING — Appendix A.5 did not execute to a discriminating result here, for two independent reasons

1. **`--body /dev/null`** — AWS CLI v2, as invoked on the GitHub-hosted runner, rejected it: *"Error
   parsing parameter '--body': Blob values must be a path to a file."* The command aborted before any
   request was sent. A zero-byte regular file was used instead. **Observed on that CLI build and runner
   image; other CLI versions and environments were not tested.**
2. **The known-absent control** did not discriminate **on the tested credential and endpoint**, returning
   `AccessDenied` rather than `NoSuchBucket`.

**Together these mean the §8.6 negative test did not run to a discriminating result in the runs attempted
here.** **No claim is made about whether it has ever been runnable in other configurations** — an earlier
version of this document made that claim and it is withdrawn.

## Recommended disposition — owner ruling required

The purpose of control 3 was to exclude the failure mode *"this credential is denied everywhere, so the
production denial means nothing."* **Control 1 excludes that failure mode directly and more strongly**: the
same credential, in the same run, seconds apart, succeeded against `50mm-staging` and was refused against
`50mm`. **For this credential in this run, a uniform-denial artefact is excluded by the success.**

**Proposed ruling:** replace A.5's known-absent control with the known-present control that R2 does
support, and record §8.6 parts 2 and 3 as satisfied on this basis:

| §8.6 requirement | Evidence |
|---|---|
| part 1 — upload lands in `50mm-staging`, readable at staging CDN | ✅ prior QA (240×140 from `cdn-staging`, 2×2 controls) |
| part 2 — staging credentials attempting a write to PRODUCTION are REFUSED | ✅ **run `33079091310`, line 153** |
| part 3 — production bucket unchanged | ✅ no object created; `isolation-probe/` prefix search on `50mm` returns zero |

**Corroborating configuration evidence** (read directly from the Cloudflare dashboard, 2026-08-27): token
**`staging-upload`** · permission **Object Read & Write** (not Admin) · bucket scope **exactly one chip:
`50mm-staging`** · `50mm` not in scope. §8.6 claims token scope "is not readable after creation" — it is.

**Status: G8 — CLOSED WITH DOCUMENTED DEVIATION**, the deviation being that A.5's known-absent control is
unexecutable on R2 and was replaced by the known-present control. **Not GREEN without the owner's ruling.**

## Required cleanup — owner

| # | Action |
|---|---|
| 1 | Delete repository secrets **`R2_STAGING_ACCESS_KEY_ID`** and **`R2_STAGING_SECRET_ACCESS_KEY`** |
| 2 | Delete branches `scratch/g10-r2-isolation-20260827`, `…-20260827b`, `…-20260827c` and close their PRs |
| 3 | Confirm repository secrets show only the four `ANDROID_*` entries afterwards |

Runs 1 and 2 (`33076909486`, `33078405537`) failed on harness bugs — errexit not cleared, and
`--body /dev/null`. Neither reached a conclusion about isolation. **Only run 3 is evidence.**
