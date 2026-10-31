# Step 3 — Risk & Tech-Debt Register

> **Consolidated from Steps 2A–2J.** Every item is sourced from the live forensic audit. Each row carries a domain, severity, evidence pointer, business impact, and a recommended posture for Step 4. Severities are assigned for rebuild-prioritisation, not for "the live app is broken" — most are latent risks accepted by the current architecture.

**Severity legend**
| Level     | Meaning                                                                 |
|-----------|-------------------------------------------------------------------------|
| **P0**    | Active correctness or security risk. Cannot survive a rebuild as-is.    |
| **P1**    | Will block scale (10× users) or cause silent data drift if ignored.     |
| **P2**    | Maintainability / DX — costs developer time, not user time.             |
| **P3**    | Cosmetic / polish.                                                      |

---

## 1. Security & Data Integrity (P0–P1)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| S1  | **P0** | **Wallet double-debit risk** — `useWalletWithdrawals` deducts on request; `admin-process-withdrawal` may also deduct on approval. | Step 2F §risks; `useWalletWithdrawals.ts`, `supabase/functions/admin-process-withdrawal` | Real money loss / duplicated withdrawal | Single atomic SQL RPC for the entire withdrawal lifecycle (one debit on request, one refund-if-rejected). Reconcile via `wallet_reconciliation_log` (already exists). |
| S2  | **P0** | **Manual deposit ≠ gateway deposit code paths** — UPI/bank goes via `useWalletDeposits`; Stripe/PayPal/Razorpay inline in `Wallet.tsx`. | Step 2F §architecture | Divergent idempotency rules; gateway changes can leave manual deposits unguarded | Unify behind one server-side `wallet_credit` RPC; gateway adapters call the same RPC. |
| S3  | **P0** | **`as any` casts on financial tables** (`bank_details`, `referral_codes`, `referrals`) — silent runtime crash on column rename. | Step 2F §risks | Silent prod break on schema migration | Regenerate types after every migration; CI gate on `as any` in `src/hooks/wallet/**`. |
| S4  | **P1** | **`manage-notifications` edge fn uses ANON key, not service role.** | Step 2G §edge-functions | Server-side dismissal proxy operates with caller's RLS — works today but breaks if `user_notifications` policies tighten | Move to service role with explicit `user_id` audit. |
| S5  | **P1** | **`admin_notifications` Realtime channel is open to all users; client gates rendering.** | Step 2I §4.1 | Bandwidth + theoretical info leak via raw payloads | Server-side filter `target_role=eq.admin` or split into private channel via RLS-aware Realtime. |
| S6  | **P1** | **JIT email-render path requires JSX `deno.json`; only `auth-email-hook` has it.** | Step 2G §risks | Future template additions silently fall back to plain text | Add `deno.json` to every transactional fn dir; CI lint. |
| S7  | **P1** | **Per-photo verification idempotency keys could collide** (composite key without nonce). | Step 2G §risks | Two judges acting simultaneously could duplicate emit | Add `judge_id` + UUID v7 to idempotency key. |
| S8  | **P2** | **`auto-role-cache-sync` channel is unfiltered** — every signed-in user receives every role change. | Step 2I §5; `AutoRole.tsx` | Bandwidth at scale | Per-user filter or move to broadcast-only on admin grants. |
| S9  | **P2** | **Bootstrap gate timeout = 3500ms with no telemetry.** | Step 2I §2.2 | Slow connections silently fall back to N+1 queries; no signal | Emit a metric on timeout; surface in `/admin/health`. |

---

## 2. Judging System (P0–P1)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| J1  | **P0** | **`current_round` stored as TEXT** with mixed formats (`'round2'` / `'r3'` / `'4'`). | Memory: `current-round-text-format` | Any blind `::int` cast crashes triggers; already burned us once | New schema must use `smallint` round_number + materialise display label separately. |
| J2  | **P0** | **Per-photo consensus emits dual stage_keys** (Frozen v3 in `status` + legacy in `status_legacy`). | Memory: `per-photo-consensus-canonical-v3` | Phase 5 cleanup pending; consumers reading wrong field will silently break post-cleanup | Drop `status_legacy` in rebuild; never dual-emit. |
| J3  | **P0** | **`mirror_system_tag_to_decision()` alias map must stay byte-equal to `tagLabelToDecision.ts` LABEL_ALIASES.** | Memory: `tag-label-alias-mirror` | Out-of-sync = buckets count zero = silent judging miscount | Generate one from the other at build-time; CI parity check (already partially exists for vocabulary). |
| J4  | **P1** | **Judge UI eligibility vs DB gate predicates can drift** — already required `JudgeUIvsDBGateAudit` widget. | Memory: `judge-ui-vs-db-gate-audit` | Round can't be closed despite UI showing 100% | One canonical RPC owns BOTH the UI list AND the close-round gate. No client-side eligibility math. |
| J5  | **P1** | **`useJudgePhotoData` cross-judge live updates intentionally OFF** (privacy trade-off, R5 option A). | Memory: `realtime-per-judge-filter-r5` | Conflict badges + cross-judge consensus widgets stale until re-mount | Acceptable; document loudly in rebuild. Consider opt-in "calibration mode" channel for designated rounds. |
| J6  | **P1** | **`current_phase` parity** between TS client / edge fns / SQL is human-maintained (script: `phase_parity.mjs`). | Memory: `phase-canonical-rpc-r5` | Drift = entire phase machine breaks | Single source = SQL view; client/edge consume via RPC only. Drop client-side phase math. |
| J7  | **P1** | **Marks (10-criteria slider scores) must be globally invisible** to public/participants/other judges. | Memory: `marks-are-private-internal` | Privacy contract with judges; SOW-level commitment | RLS-only path: marks never enter any view consumed by non-self/non-admin. |
| J8  | **P2** | **`useJudgePhotoData` is 422 LOC** with 4 batch fetches + Realtime + optimistic updates + invalidate fan-out. | Step 2I §3.7 | Single-file complexity hot-spot | Split into: data hook, optimistic-mutation hook, realtime hook. |
| J9  | **P2** | **Three audit drift RPCs** (`get_progression_drift_admin`, `get_placement_drift_admin`, `get_certificate_drift_admin`, `get_notification_drift_admin`) all do similar shape work. | Memories: phase 2.x audits | Forensic discipline good, but duplicated boilerplate | Generic `audit_drift(domain text)` RPC + per-domain SQL fragments. |

---

## 3. Database & RLS (P1–P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| D1  | **P1** | **114 tables, 344 policies, 175 triggers, 194 SECURITY DEFINER fns** — high cognitive load, no schema-diff visualisation. | Step 2H §1, §3 | Onboarding cost + accidental privilege escalation if a new policy is added without considering existing ones | Adopt a policy-naming convention (`<table>__<role>__<action>`) and a CI check that flags missing or duplicated policies per (table, role, action) tuple. |
| D2  | **P1** | **12 audit tables append-only with no rollup view.** | Step 2H §audit-logging | Hard to detect "burst of NR_DRIFT_R2_PLUS events"; alerts depend on manual SQL | One materialised "audit_metrics_daily" view; surface counts in `/admin/health`. |
| D3  | **P1** | **`profiles_public_data` denies direct SELECT; consumed via `profiles_public` view.** | Step 2H §security-invariants | Works, but easy to mis-import the wrong source in new code | Drop the view in favour of a SECURITY DEFINER `get_profile_public(uuid)` RPC — typed, scoped, lint-friendly. |
| D4  | **P2** | **All 194 SECURITY DEFINER fns set `search_path` explicitly** — already correct, but enforcement is convention-only. | Step 2H §security-invariants | One missed `SET search_path` re-introduces hijack risk | Linter (`supabase--linter` already exists) — wire to CI as required check. |
| D5  | **P2** | **`wallet_transactions` is the only legal ledger entry, but no DB-level guard prevents direct `INSERT`.** | Step 2F + 2H | New code could bypass the RPC | Revoke INSERT on table from `authenticated`; only `wallet_transaction()` (security definer) can write. |

---

## 4. Cache, Hooks & Realtime (P1–P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| H1  | **P1** | **`as any` casts in fetchers** (`profileMapCache.ts`, `useJudgePhotoData.ts`, `AutoRole.tsx`). | Step 2I §7 #1 | Schema rename → silent runtime crash | Regenerate types post-migration; CI rule banning `as any` in `src/hooks/**` and `src/lib/**`. |
| H2  | **P1** | **Global `feed-live` channel has no filter** — every signed-in user receives every feed event. | Step 2I §7 #3 | Won't survive 10× scale | Per-user inbox channel + server-side fan-out (worker). |
| H3  | **P1** | **`live-admin-sync` mounts for ALL users** at module-load. | Step 2I §7 #4 | Bandwidth cost for non-admins | Lazy-mount inside an `is-admin` gate. |
| H4  | **P1** | **`AutoRole` cache duplicates `useProfileMap` data.** | Step 2I §7 #5 | Two parallel role-fetch paths; possible race on simultaneous Realtime invalidation | Unify under `useProfileMap`; delete module-singleton cache. |
| H5  | **P1** | **`queryKeys.ts` registry is convention-only.** | Step 2I §6 | Drift risk on new code | ESLint rule: `useQuery` calls must reference `queryKeys.*`. |
| H6  | **P2** | **`refetchOnReconnect` not globally disabled** (only `dashboard-init` opts out). | Step 2I §7 #7 | Network-resume thunder | Audit per-hook; default-off for public reads. |
| H7  | **P2** | **`useNotificationsQuery` 60s polling stacks with Realtime.** | Step 2I §7 #9 | Wasted DB cycles | Drop polling — Realtime is sufficient given subscriptions on 4 tables. |
| H8  | **P2** | **No global query-error boundary.** | Step 2I §7 #10 | Aggregate failures invisible (e.g. RLS lockout) | One `<QueryErrorBoundary>` wrapping route subtrees + telemetry sink. |
| H9  | **P3** | **Singletons in `liveAdminSync`/`profileMapCache`/`AutoRole` never explicitly unsubscribe** — HMR leaks in dev only. | Step 2I §7 #8 | Dev DX | Acceptable; document. |

---

## 5. Storage & Media Pipeline (P1–P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| M1  | **P1** | **WebP-only at 100% original resolution, JPEG generated client-side via Canvas API.** | Memory: `image-strategy`; Step 2E | Large payloads on entry submission; client CPU spike | Server-side `sharp`/`vips` resize pipeline; multiple resolution tiers. |
| M2  | **P1** | **Orphan storage detection lives only in `/admin` audit widget.** | Memory: `storage-health-tools` | Manual cleanup; storage cost grows | Scheduled cron sweep + atomic delete on parent-row soft-delete. |
| M3  | **P2** | **`FileUploadDropZone` is the only sanctioned upload UI** — convention-enforced. | Memory: `file-management` | Drift if a new feature inlines upload | ESLint rule banning direct `supabase.storage.from(...).upload(`. |

---

## 6. Email & Notification System (P1–P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| E1  | **P1** | **Brevo bounce/complaint per-email status not surfaced to UI.** | Step 2G §risks | User can't see "your email bounced"; admin blind to deliverability | Webhook from Brevo → `email_send_log` status column → user-visible badge. |
| E2  | **P1** | **`notification_emit_log` is the only legal judging email path; CI gates UI imports of `send-transactional-email`.** | Memory: `notification-architecture` | Excellent guardrail. Risk = only judging is locked, transactional UI emails have no equivalent. | Extend the CI rule to all template categories; one edge-function-only contract. |
| E3  | **P2** | **`useNotificationPreferences` uses raw `as` casts (13 toggles).** | Step 2G §risks | Schema drift | Regenerate types. |
| E4  | **P2** | **`useNotificationsQuery` hard-caps unread at 30.** | Step 2G §risks | Power users miss notifications silently | Paginate; show "X older" pill. |

---

## 7. UI / Design System (P2–P3)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| U1  | **P2** | **Font token mismatch** — `--font-display/heading/body` resolve to Helvetica even though Inter/Lora/Space Mono are imported & registered. | Step 2J §2.3, §9 #1 | UI inconsistency between components using `var(--font-body)` vs `font-sans` | Pick one stack; remove unused imports; align tokens with Tailwind. |
| U2  | **P2** | **Three font families loaded from Google Fonts but `--font-body` uses none.** | Step 2J §9 #6 | Wasted bytes on first paint | Drop unused imports; self-host the chosen family. |
| U3  | **P2** | **No lint rule blocks raw colour classes** (`bg-blue-500`, `text-white`). | Step 2J §9 #3 | Theme drift | ESLint `no-restricted-syntax` on raw Tailwind colour utilities. |
| U4  | **P2** | **No Storybook / visual regression coverage** across 271 components. | Step 2J §9 #9 | UI changes only QA'd by route-walking | Storybook + Chromatic on critical surfaces (judging panel, wallet, feed). |
| U5  | **P2** | **`!important` cascade on `.container`** (5 declarations). | Step 2J §9 #2 | Future overrides painful | Replace with a typed layout primitive component. |
| U6  | **P3** | **shadcn primitives are checked in** — accidental edits won't be flagged. | Step 2J §9 #4 | Drift from upstream | Lock `src/components/ui/` via CODEOWNERS + diff alerts. |
| U7  | **P3** | **`darkMode: ["class"]` but `:root` is light** while brand direction is dark. | Step 2J §9 #7 | Confusing default for new contributors | Flip `:root` to dark tokens; light becomes the `.light` opt-in. |

---

## 8. Auth & Identity (P1–P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| A1  | **P1** | **Username system has cooldowns + anti-impersonation rules** scattered across hooks + DB triggers. | Memory: `username-system-enforcement` | Bypass risk if a new mutation path is added | Single SQL RPC `change_username(user_id, new_handle)` enforces cooldown + fuzzy-match. |
| A2  | **P1** | **Device-fingerprint sign-out logic spans client + edge fn + DB.** | Memory: `device-management` | Edge fn could lose sync with client fingerprint algorithm | Pin algorithm version; reject mismatched versions server-side. |
| A3  | **P2** | **Math CAPTCHA fallback** for OAuth-disabled flows. | Memory: `auth-methods` | Weak CAPTCHA is bypassable | Replace with Turnstile or hCaptcha. |
| A4  | **P2** | **Email immutability + single password history** enforced by trigger. | Memory: `account-integrity` | Correct policy. Risk = no audit log of attempted changes. | Log denied UPDATE attempts to `db_audit_logs`. |

---

## 9. Admin Ecosystem (P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| AD1 | **P2** | **90 admin components** with no consistent layout primitive — every audit widget rebuilds its own table chrome. | Step 2J §4.3 | Inconsistent UX, duplicated code | Extract `<AdminAuditTable>` + `<AdminMetricCard>` primitives. |
| AD2 | **P2** | **Admin financials hard-limit caps** ($1/vote, $100/referral) live in code. | Memory: `admin/financial-and-data-integrity` | Tuning requires deploy | Move to `site_settings` row; admin UI to edit. |
| AD3 | **P2** | **Sidebar limits for users/suggestions are hardcoded.** | Memory: `sidebar-management` | Same as above | Same — `site_settings`. |

---

## 10. Cross-cutting / Process (P1–P2)

| #   | Sev | Item | Evidence | Impact | Recommended posture |
|-----|-----|------|----------|--------|---------------------|
| X1  | **P1** | **Forensic-audit mandate is policy, not enforced.** | Memory: `forensic-audit-mandate`, `prove-block-ci-r6` | PROVE block CI exists for judging only — other domains rely on reviewer discipline | Extend PROVE block to wallet, auth, RLS-touching PRs. |
| X2  | **P1** | **"Live proof only for judging fixes" memory** indicates past regressions. | Memory: `live-proof-only-judging-fixes` | Implies judging fixes have shipped without live verification before | Hard-gate via CI: judging-tagged PRs must include screenshot artefact. |
| X3  | **P2** | **No central feature-flag system.** | Inferred — `site_settings.judging_realtime_distributed_mode` ad-hoc | Each new flag invents its own pattern | One `feature_flags` table + typed client. |
| X4  | **P2** | **No request tracing across edge fns + DB triggers.** | Step 2G + 2H | Hard to debug a "notification didn't send" report | Propagate `x-request-id` from client → edge → trigger → audit log. |

---

## 11. Severity Roll-up

| Severity | Count | Themes |
|----------|------:|--------|
| **P0**   | 6     | Wallet ledger split-brain, judging vocabulary drift, type-cast crashes |
| **P1**   | 30    | Realtime scale, RLS surface area, type drift, deliverability, audit gaps |
| **P2**   | 25    | DX / lint enforcement, design tokens, code duplication |
| **P3**   | 4     | Cosmetic |

**Top-6 to fix before rebuild ships (P0):**
1. **S1 / S2** — Unify wallet credit/debit behind one server RPC.
2. **S3 / H1** — Eliminate `as any` in financial + judging hooks; enforce in CI.
3. **J1** — Migrate `current_round` from TEXT to `smallint`; kill the format-soup.
4. **J2** — Drop `status_legacy` dual-emit from per-photo consensus.
5. **J3** — Generate the tag→decision alias map from a single source.
6. **D5** — Revoke direct `INSERT` on `wallet_transactions`; only the RPC writes.

---

## 12. Scope of audit

**Verified by direct file/SQL inspection in Steps 2A–2J:**
- Routes & pages (Step 2A)
- Dashboard / feed / profile data hooks (2B)
- Competition & judging architecture (2B)
- Admin ecosystem (2C)
- Auth, role & security (2D)
- Storage & media pipeline (2E)
- Payment & wallet (2F)
- Email & notifications (2G)
- DB schema & RLS coverage (2H — 114 tables, 344 policies, 175 triggers, 194 SECURITY DEFINER fns)
- Hooks, cache & Realtime (2I — 14 channels, ~80 hooks)
- UI & design system (2J — 49 shadcn primitives, 271 components, full token catalogue)

**Not in scope for this register (deferred):**
- Performance profiling under load (no live load test was run)
- Penetration testing of edge functions (only `pentest-judge.md` exists)
- Accessibility audit (no axe-core run)
- Mobile-app PWA install / offline behaviour
- Cost analysis (Supabase egress, Brevo volume, storage growth)

---

**Next:** Step 4 — Rebuild Recommendation.
