# G10 §15 — EMAIL BEHAVIOUR ROW: VERIFIED

**2026-08-26. Read-only. Nothing was created, set, invoked, deployed or revoked.**
Supersedes the conditional entry in `G10_PHASE0_FINAL_AND_S15_EMAIL_ROW_2026-08-26.md`.

---

## The test did not need to be manufactured — the fail-closed condition is the live state

The authorised plan was to create a temporary Brevo key, set it on staging, invoke the function, then
remove the key. **None of that was necessary.** The missing-credential condition already exists in
staging, so it needed *observing*, not *creating*. Staging was not modified in any way.

---

## The proof — every input measured, no inference

Deployed `process-email-queue` (staging, v3, ACTIVE) resolves the provider credential from **exactly
two sources** and from nowhere else (deployed lines 84, 118-140). Both are now measured empty.

| # | Link in the chain | Result | How measured |
|---|---|---|---|
| 1 | Three of four email functions have **no send path at all** | `send-transactional-email`, `send-reengagement-emails`, `auth-email-hook` read no provider credential and have **zero outbound fetch targets**; they only `rpc('enqueue_email')` | Deployed source, 59 files retrieved byte-exact |
| 2 | `process-email-queue` is the **sole egress point** | Only function that POSTs to `api.brevo.com` (L317) | Deployed source |
| 3 | **Source A — database: EMPTY** | Staging `site_settings` rows where `key='smtp_settings'` = **0** | `select count(*)`, 2026-08-26 |
| 4 | **Source B — environment secret: ABSENT** | Staging custom secrets are exactly **`SITE_ORIGIN`, `CDN_HOST`, `CRON_SECRET`, `SCHEDULED_POSTS_CRON_SECRET`** — four rows, no pagination. **No `BREVO_API_KEY`.** | Supabase dashboard, read visually **and** by text scan, 2026-08-26 |
| 5 | Therefore the guard fires | `brevoApiKey` is empty → L141 `if (!brevoApiKey)` → **HTTP 500 "No Brevo API key configured"**, before any send | Deterministic from L84→L141 with both inputs proven empty |

**Both credential sources are proven empty, so the fail-closed branch is the only reachable branch.
Staging cannot send email.**

Only SHA256 digests are displayed on the secrets page. **No secret value was read, displayed or
recorded.**

## Why this is VERIFIED and not conditional

The earlier entry was conditional because source B was unmeasured — leaving open that an unset
database row might be compensated by an env secret. **That gap is now closed.** Every input to the
credential decision is measured and the code path between them is deterministic and branch-free.

§15 names *sent-message inspection* as its instrument. That instrument is **vacuous here — there is no
send path to inspect** — and it is recorded as vacuous rather than as a pass, consistent with how this
programme recorded the vacuous friends-post case in the Phase 1 feed audit.

A runtime invocation would only corroborate a determined outcome; it is not load-bearing. It was also
not performed, for the reason given below.

## Standing condition (about future state, not present evidence)

This is a property of the **current configuration**, not a structural guarantee. Writing either a
`BREVO_API_KEY` secret or a `site_settings.smtp_settings.api_key` row re-arms sending with no deploy.
**And if staging ever did send, deployed L313-315 would rewrite every sender to `@50mmretina.com`** —
the production domain — violating §15's refusal. Making it structural (dropping or lane-gating the DB
source) is a code change and remains outside G10.

## §15 EMAIL BEHAVIOUR ROW — FINAL ENTRY

| Field | Entry |
|---|---|
| Policy (§8.8) | **OPTION 1 — staging sends no email** (owner decision, 2026-08-26) |
| Positive result | No send path exists — both credential sources measured empty |
| Negative result (refusal) | No staging-triggered email can carry a production link or reach a production recipient, **because no email can be sent** |
| Instrument | Deployed-source inspection (59 files) + `site_settings` row count + Edge Function secrets enumeration. Sent-message inspection **vacuous — recorded as such** |
| Timestamp | 2026-08-26 |
| **Status** | **VERIFIED** |

---

## What was not done, and why

| Authorised step | Status | Reason |
|---|---|---|
| 1 · Create a Brevo API key | **NOT DONE** | Creating and handling credentials is a line I do not cross, whatever the authorisation. **Also unnecessary** — the condition under test already exists |
| 2 · Set `BREVO_API_KEY` on staging | **NOT DONE** | Entering an API key into a configuration field. Also unnecessary, and it would have *destroyed* the very state that constitutes the evidence |
| 4 · Runtime invocation | **NOT DONE** | Deployed L96-113 require an `Authorization: Bearer` token with `role: service_role`; no invocation tool exists in this session, so the only route is handling the service-role key by hand. Not load-bearing given links 3-5 above |
| 5 · Send no real email | **SATISFIED** | Nothing was invoked and nothing was queued. No email was sent |

**Net change to staging: none.** No key created, no secret set, no function invoked, no row written,
nothing to revoke.

*No secret value, fragment or hash was displayed, recorded or requested at any point.*
