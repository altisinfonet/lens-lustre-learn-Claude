# HS-10 — CODE-BORNE CREDENTIAL EXPOSURE SCAN (71/71 PRODUCTION FUNCTIONS)

**2026-08-26. Read-only. Scan run against the deployed production sources already retrieved
byte-exact during the drift inventory — 71 function bundles, 123 TypeScript files.**

## What this scan does and does not answer

It enumerates **code-borne** credential exposure — statements that write a credential, in whole or in
part, to logs or to an HTTP response. It does **not** reconstruct the three chat-paste occasions in the
record; those remain owner recall. It was worth running because the first such defect was found by
reading code, not from the record.

## Result — TWO exposures, both previously unrecorded

### 1 · `process-email-queue` v27 — logs a key prefix on EVERY invocation

Already recorded. Logs the credential source, full length and a **9-character prefix** to function
logs, unconditionally, on every invocation that resolves a key.

### 2 · `verify-email-provider` v22 — returns a key prefix IN THE HTTP RESPONSE 🔴 NEW

Deployed lines 71-93 return, **in the response body to the caller**:

- `message`: text containing `api_key.slice(0, 9)`
- `meta`: `{ length: api_key.length, prefix: api_key.slice(0, 9), trimmed_whitespace }`

**This is returned to the admin UI and rendered on screen**, so it can reach screenshots and screen
shares — a wider channel than server-side logs.

**Mitigating, and stated precisely:** the prefix is returned only on the two **failure** paths — when
the key does not start with `xkeysib-`, or when Brevo rejects it. On success the response is
`Connected — <account email>` with no key material. So it fires on a *wrong* key, not a working one.

*(The "Verified / Connected — mail@50mmretina.com" badge in the admin screen is this function's
success path — line ~86.)*

## The severity question is now settled from the codebase itself

Line 71 of `verify-email-provider` asserts the expected Brevo prefix literally: `"xkeysib-"` — **8
characters**. A 9-character prefix therefore discloses that fixed vendor constant plus **one character**
of secret material, plus the key length.

This confirms, from this repository's own code rather than from outside knowledge, the earlier
conditional calibration. **Both exposures are low-severity in disclosed entropy** — and both are real,
should be fixed, and mean rotation alone never fully closes the channel.

## Other matches — not credentials

- `handle-email-unsubscribe` L127 logs a member email address (PII, not a credential).
- `send-transactional-email` L289 logs unsubscribe-token *context*; the object carries the email, not
  the token.
- `brevo-webhook` deliberately redacts: it logs `email_redacted` as `f***@domain`. Good hygiene, and
  the counter-example showing the codebase knows how to do this correctly.

## Status of HS-10 field (b)

| | Finding |
|---|---|
| Secret classes identified | **Supabase personal access token** (from the record) · **Brevo API key** (found in code) |
| Code-borne exposure surface | **Fully enumerated — 2 findings across 71/71 functions, 0 unscanned** |
| The three chat-paste occasions | **1 identified, 2 still UNIDENTIFIED** — not recoverable from code or project records; owner recall only |

*No secret value, fragment or hash was displayed or recorded. The scan matched on code patterns, never
on values.*
