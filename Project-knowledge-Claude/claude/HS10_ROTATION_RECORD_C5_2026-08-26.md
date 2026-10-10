# HS-10 — ROTATION RECORD (CONTROL C5)

**2026-08-26.** No secret value, fragment or hash appears in this document.

---

## C5 five-field record — Supabase personal access token

| | Field | Entry | Class |
|---|---|---|---|
| **a** | Did rotation occur? | **YES** — twice on 2026-08-26 | VERIFIED |
| **b** | Which secret class? | **Supabase personal access token** (account-level management/CLI). Second class identified separately: **Brevo API key** — see below | VERIFIED |
| **c** | Rotation completion timestamp | 2026-08-26, during this session | VERIFIED |
| **d** | Old credential invalid? | See the two sub-entries below | mixed |
| **e** | Replacement value anywhere in repo/logs/CI/artefacts? | **NO** | VERIFIED |

### Field (d), entry 1 — `50mmretinamigration` · **VERIFIED**

The originally exposed token, matching the class named in `PROJECT_MASTER_RECORD.md` §9 and the
2026-08-25 §17 checklist. **Revoked by the owner and independently confirmed by this session**: absent
from the Access Tokens list read on a page confirmed to have rendered.

> **Method note that matters.** A first read of that page reported *both* tokens absent — which looked
> like success. The page had **not rendered**; the negatives were meaningless. The re-read added a
> render assertion (`Generate new token` and `Access Tokens` both present) before trusting any result.
> Reporting the first read would have produced a **false green on the release's central control**.
> Confirm the instrument worked before trusting what it says.

### Field (d), entry 2 — `owner-cli-2026-08` · **OWNER-ATTESTED**

A **fourth exposure occurred during this session** (see below). The affected token was revoked and a
replacement generated **under the same name**.

**This session cannot independently verify it.** The list shows exactly one token and the name is
unchanged, so the current entry is indistinguishable by name from the compromised one. The owner
states the key differs. Recorded as **OWNER-ATTESTED — never as VERIFIED.**

*Lesson for next time: give a replacement token a different name. The list then evidences the
rotation by itself and no attestation is needed.*

### Field (e) — repository and history · **VERIFIED**

Scanned the working tree and **400 commits of history across all branches**:

| Pattern | Matches |
|---|---|
| `sbp_…` (Supabase PAT) | **0** |
| `sb_secret_…` (Supabase secret key) | **0** |
| `xkeysib-…` (Brevo API key) | **0** |
| `.env` / secret / credential / `.pem` / `.jks` / `.p12` files tracked in git | **none** |

No credential value is present in the repository or its history.

---

## 🔴 FOURTH OCCURRENCE — recorded, as HS-10 requires

**2026-08-26, during this session.** A screenshot of the Supabase "Successfully generated a new token!"
banner was shared into the conversation. That banner renders the **full token value in plaintext**, so
the newly created token `owner-cli-2026-08` was exposed at the moment of creation.

- **Detected immediately**, in the same turn.
- **The value was not repeated, quoted, recorded, hashed or partially displayed** anywhere, and does
  not appear in this or any other project document.
- **Remediated within minutes**: token revoked, replacement generated.
- **Exposure window minimal** — the token showed `Never used` throughout.

**Contributing cause, recorded so it is designed out rather than blamed:** the generation banner
places a live secret in large plain text exactly where a user looks to confirm success, and
screenshotting progress is a natural instinct. **Control: close the banner before capturing anything
from that page.**

---

## Second secret class — Brevo API key

Identified by code inspection, not from the record. Two disclosure sites across 71 production
functions (`HS10_CODE_BORNE_EXPOSURE_SCAN_2026-08-26.md`):

1. `process-email-queue` v27 — logs source, full length and a **9-character prefix**, every invocation.
2. `verify-email-provider` v22 — returns length and a **9-character prefix in the HTTP response body**,
   on its two failure paths only.

**Disclosed entropy, established from this codebase:** `verify-email-provider` line 71 asserts the
expected Brevo prefix `"xkeysib-"` — **8 characters**. A 9-character prefix therefore discloses a public
vendor constant plus **one character** of secret material, plus the key length.

**This is not a value disclosure**, and the recommended ruling is **ACCEPTED — no rotation required**,
with the two code sites folded into the G9 release, which must deploy those functions anyway.
**The ruling itself is the owner's to give.**

---

## Outstanding — two owner declarations, nothing technical

| # | Item | Needed |
|---|---|---|
| 1 | **Brevo ruling** | One line: *"ACCEPTED — prefix-only disclosure (vendor constant + 1 character), no rotation; code sites fixed in the G9 release."* |
| 2 | **The two remaining chat occasions** | Their secret class, or an explicit *"cannot be identified"* — which is admissible. **Not recoverable from code or project records**: the 71-function scan enumerated the code-borne surface completely (2 findings), and neither is a chat paste |

---

## HS-10 status

| Element | Status |
|---|---|
| Supabase PAT — original exposure (`50mmretinamigration`) | **VERIFIED — revoked** |
| Supabase PAT — session exposure (`owner-cli-2026-08`) | **OWNER-ATTESTED — revoked and replaced** |
| Replacement value in repo/history | **VERIFIED — absent** |
| Code-borne exposure surface, 71/71 functions | **VERIFIED — fully enumerated, 2 findings** |
| Brevo key ruling | **OPEN — owner declaration** |
| Two remaining chat occasions | **OPEN — owner recall** |

**§17-3 does not clear until both open items carry a written answer.** Both are declarations, not work.

*No secret value, fragment or hash was displayed, recorded, hashed or requested at any point in this
session.*
