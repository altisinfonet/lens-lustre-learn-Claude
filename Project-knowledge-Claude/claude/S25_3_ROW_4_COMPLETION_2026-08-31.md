# §25.3 row 4 — COMPLETED. The last capture gap is closed.

Captured 2026-08-31 by the compiler/audit session in the owner's browser, read-only.
**Classification: OWNER-ATTESTED.** §25.4 — the compiler is not a second party. **This closes nothing.**

---

## What §25.4 row 4 asks, verbatim

> *"token `staging-upload` (`73a7920647481fd93553f9c1f68bf5a3`) has **exactly one** policy, `R2 › 50mm-staging`, and **no policy naming `50mm`**"*

My earlier capture (2026-08-30T13:46:13Z) reached only the token **list** view — the "Applied to" summary column. I recorded it then as **partially covered, not covered**, because a summary column is not a policy list.

---

## Captured now, from the token's own configuration

**Token identity confirmed from the URL, not from a label:**

```
https://dash.cloudflare.com/a7810011a99de537a210130f86306785
       /r2/api-tokens/73a7920647481fd93553f9c1f68bf5a3?type=account
```

**`73a7920647481fd93553f9c1f68bf5a3` — the exact token id §25.4 names.** The id was never previously verified by anyone; it is now, and it came from the address bar rather than from a display field.

| Field | Value, as-of **2026-08-31T05:5x UTC** |
|---|---|
| Token type | **Account** API token |
| Permission | Object Read & Write |
| Bucket scope | **"Apply to specific buckets only"** |
| Buckets listed | **`50mm-staging` — and nothing else** |
| TTL | **Forever** |
| Client IP filtering | Include: *(empty)* · Exclude: *(empty)* |

### Row 4's claim — CONFIRMED

- **Exactly one bucket scope.** ✓
- **It is `50mm-staging`.** ✓
- **No policy names `50mm`.** ✓ — the scope is explicitly "specific buckets only", and the production bucket does not appear.

**Row 4 moves from PARTIALLY COVERED to CAPTURED. All eight §25.3 rows are now captured.**

---

## Two observations the row does not ask for, recorded so they are not lost

- **TTL = Forever.** The token has no expiry. Combined with Object Read & Write on the staging bucket, a leak has no natural end date.
- **No client IP filtering.** Include and Exclude are both empty, so the token is usable from any address.

**Neither is a release item.** Both belong on the post-promotion hardening list beside the `ANDROID_*` scoping and the `verify_jwt = false` least-privilege observation.

---

## Safety record for this capture

Read-only. **No secret, token, key or credential value was viewed or requested** — Cloudflare does not re-display a token's value after creation, and none was sought.

The token's `…` menu offers **Edit · Roll · Delete**. **Only `Edit` was clicked.** `Roll` would rotate the credential and break every consumer; `Delete` would destroy it. Neither was touched.

The edit form was **read and abandoned**: the tab was closed without clicking `Update Account API Token` and without clicking `Cancel`. **No field was modified, and no form was submitted.** Nothing about the token changed.

---

## Standing

**All eight §25.3 rows are captured. Zero are closed.** §25.4 is unchanged: *"No row below may be marked closed by the compiler. The compiler is not a second party."*

With no separate auditor available, the route that remains is §25.7.3's second: **the owner accepting each row in writing as a named residual risk, per row, with its basis.**

**Seven rows were already ruleable. All eight are now.** Nothing further stands between the owner and that ruling.
