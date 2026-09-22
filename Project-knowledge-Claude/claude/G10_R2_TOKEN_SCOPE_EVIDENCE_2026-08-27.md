# G8 — R2 TOKEN SCOPE, READ DIRECTLY FROM THE CLOUDFLARE DASHBOARD

**Observed 2026-08-27 by direct browser inspection. Read-only: the edit form was opened to read the
bucket scope and closed without saving. No secret value was displayed, read, or recorded — Cloudflare
does not display it after creation, and no attempt was made to obtain it.**

---

## THE FINDING — §8.6's STATED PREMISE IS FALSE

**§8.6 says, verbatim:**
> *"Token scope is not readable after creation, so this is OWNER-ATTESTED by construction. The
> compensating control is the negative test below, which is INDEPENDENTLY-VERIFIED."*

**The scope IS readable.** The Cloudflare dashboard shows it plainly, and it can be screenshotted.
What is not readable after creation is the **secret access key** — a different thing.

**This is the fourth governance premise in this engagement to fail when actually checked**, after
§17-7 (branch protection "cannot be read by any session" — it was), §19/§20 G5b (code half "outstanding"
— already present), and D-3 (no staging deployment — one exists).

---

## WHAT WAS OBSERVED

**Cloudflare → R2 Object Storage → API Tokens**

### Account API Tokens

| Token name | Applied to | Permission | Issued on | Status |
|---|---|---|---|---|
| **`staging-upload`** | **`50mm-staging`** | Object Read & Write | Aug 24, 2026 | **Active** |

### User API Tokens

| Token name | Applied to | Permission | Issued on | Status |
|---|---|---|---|---|
| `50mm` | `50mm` | Object Read & Write | Mar 7, 2026 | Active |
| `AgentCRM` | `agentcrm` | Object Read & Write | Dec 11, 2025 | Active |

### `staging-upload` detail, read from its edit form (token id `73a7920647481fd93553f9c1f68bf5a3`)

| Field | Value | Significance |
|---|---|---|
| Token name | `staging-upload` | |
| Permission | **Object Read & Write** — *"read, write, and list objects in specific buckets"* | **NOT** `Admin Read & Write`, which would permit creating, listing and deleting **buckets** account-wide |
| **Bucket scope** | **exactly one chip: `50mm-staging`** — no second entry, field otherwise empty | **`50mm` is not in scope** |
| TTL | Forever | |

**Three distinct tokens, each scoped to exactly one bucket, with no overlap.** The account follows a
one-token-per-bucket pattern.

---

## WHAT THIS EVIDENCE IS, AND WHAT IT IS NOT

| | |
|---|---|
| **Is** | Direct, INDEPENDENTLY-VERIFIED **configuration** evidence that `staging-upload` is scoped to `50mm-staging` only and holds no permission over `50mm` |
| **Is not** | The **behavioural** negative test §8.6 mandates. Configuration states what *should* happen; the negative test demonstrates what *does* happen |

**This session does not claim the two are equivalent, and does not mark G8 GREEN on the strength of it.**
The honest reading:

- The residual risk the negative test exists to catch — *"the staging token is secretly over-scoped"* —
  is now **directly contradicted by the token's own configuration**, not merely attested.
- §8.6's rationale for requiring the behavioural test *in place of* reading the scope no longer applies,
  because the scope is readable. That is a defect in the plan's reasoning, and the owner should rule on
  whether the requirement survives its own justification.
- A behavioural test remains stronger and should still be run if any route to running it exists.

---

## RECOMMENDED DISPOSITION

**Option 1 — run the behavioural test by another route** (GitHub Actions on a throwaway branch, or a
colleague's terminal). Closes §8.6 parts 2 and 3 as written. **Preferred.**

**Option 2 — accept G8 as CLOSED WITH DOCUMENTED DEVIATION**, citing:
- part 1 ✅ evidenced (upload lands in `50mm-staging`, served 240×140 from `cdn-staging`, 2×2 controls)
- part 2 — **compensated** by the configuration evidence above, with the §8.6 premise defect recorded
- part 3 — production bucket `isolation-probe/` prefix confirmed empty by dashboard search

§3.2 expressly permits a documented deviation in a Release Candidate. **It does not permit calling it GREEN.**

---

## A TRAP TO AVOID — DO NOT "TEST" THIS FROM THE DASHBOARD

Uploading a file to `50mm` through the Cloudflare dashboard **proves nothing about the staging token.**
The dashboard authenticates as the **account owner**, not as `staging-upload`. Such an upload would
**succeed**, and a reader could easily mistake that success for evidence that isolation has failed.

**It would be a false negative produced by testing the wrong identity.** The negative test is only
meaningful when executed with the staging credential itself.

---

## PRODUCTION BUCKET STATE, same session

`50mm` — created 2026-03-07 · APAC · Standard · **Public Access Enabled** · **Bucket Size 1.09 GB** ·
Class A ops 850 · Class B ops 36.98k · top-level prefixes include `avatars/`, `competition-photos/`.

**Note on instrument choice:** bucket **size** is displayed rounded to 1.09 GB and **cannot detect a
0-byte probe object**. For §8.6 part 3, search the `isolation-probe/` prefix in the dashboard object
browser instead — that is discriminating for exactly the object the test would create. Size is not.
