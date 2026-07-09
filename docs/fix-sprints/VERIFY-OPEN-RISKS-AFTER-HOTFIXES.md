# VERIFY — Open risks remaining after HOTFIXES A–E (and pre HOTFIX-F)

**Mode:** READ-ONLY. Each risk below carries an evidence source already collected live this session. No percentages, no guessed priority — risks are listed, not ranked.

---

## R-OPEN-1 — `public.wallet_transaction` still executable by `authenticated`

- **Evidence:** `pg_proc.proacl` aclexplode (this session) shows ACL row `16481:EXECUTE` (= `authenticated`).
- **Effect:** Any logged-in user can RPC the wallet ledger writer directly via PostgREST.
- **Containment status:** `anon` + `PUBLIC` revoked (HOTFIX-A partial).

## R-OPEN-2 — `public.backfill_judging_notifications` still executable by `authenticated`

- **Evidence:** `pg_proc.proacl` aclexplode (this session) shows ACL row `16481:EXECUTE`.
- **Effect:** Any logged-in user can invoke an admin backfill function over PostgREST RPC.
- **Containment status:** `anon` + `PUBLIC` revoked (HOTFIX-E partial).

## R-OPEN-3 — `judge_decisions.judge_id` leak to entry owners

- **Evidence:** `pg_policy` row "Entry owners can view own photo decisions" returns full row incl. `judge_id` (this session).
- **Effect:** Participants can enumerate which judge ID judged each of their photos. Violates `mem://security/judge-privacy-phase2`.
- **Containment status:** Open. Pre-check filed (HOTFIX-F).

## R-OPEN-4 — 173 of 202 `SECURITY DEFINER` functions executable by `anon`/PUBLIC

- **Evidence:** Prior session live count via `pg_proc` join on `pg_proc_acl` (recorded in `50mm-7Point-Pending-Items-VERIFIED-Report.docx`).
- **Effect:** Wide attack surface — many DEFINER functions reachable without auth.
- **Containment status:** Not re-verified this turn; previous count stands as a live snapshot. Re-verification required before any sweeping change.

## R-OPEN-5 — 2 SECURITY DEFINER views without `security_invoker=on`

- **Evidence:** Prior live identification: `entry_public_status`, `v_judging_drift` (recorded in VERIFIED report). Re-verification not run this turn.
- **Effect:** Views execute with definer's privileges; can bypass RLS of the caller.
- **Containment status:** Open.

## R-OPEN-6 — Matcher / alias mirror drift not enforced by CI

- **Evidence:** `mem://judging/tag-label-alias-mirror` documents the rule; no parity-check workflow file found this turn under `.github/workflows/` for the alias mirror specifically (only adjacent parities exist: `v3-catalog-parity.yml`, `rpc-contract-parity.yml`, `prove-block-required.yml`).
- **Effect:** Silent zero-bucket regression possible if `tagLabelToDecision.ts` LABEL_ALIASES and `mirror_system_tag_to_decision()` diverge.
- **Containment status:** Open / partial (manual memory).

## R-OPEN-7 — `photo_verification_requests` table absence vs. active cron

- **Evidence:** Prior live check (VERIFIED report): table not present in `public`; cron job `expire-photo-verifications-every-15min` is active.
- **Effect:** Cron sweeper may be writing to / referencing a table by a different name, or be a no-op. Not re-confirmed this turn.
- **Containment status:** Investigation required, not a hotfix yet.

## R-OPEN-8 — 191 `authenticated`-executable SECURITY DEFINER functions (WARN 0029)

- **Evidence:** `supabase--linter` output recorded in VERIFIED report.
- **Effect:** Broad privilege surface; many functions can be called by any logged-in user. Item-by-item triage required.
- **Containment status:** Open.

## R-OPEN-9 — Some prior memory claims unverified live

- **Evidence:** Audit Methodology Disclosure (`50mm-7Point-Audit-Methodology-Disclosure.docx`) lists 12 items not yet re-verified, e.g. `wallet_transaction` function body, storage bucket policies.
- **Effect:** Acting on memory alone risks repeating the original "score column" mistake.
- **Containment status:** Documented but not yet closed.

---

No fixes proposed in this report. Each item requires its own pre-check before any write.
