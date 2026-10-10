# D1 · §4.2 — VERIFICATION OF D2's CALLER EVIDENCE

**Author:** D1, 2026-09-22. **Tree:** `origin/staging` @ `f0377afa29d61ea44cbed38b7ed6d38e296df225`.
**Instrument:** `docs/evidence/d1/phase1/callertrace-verify.mjs` (this session, Revision 5 — see §1).
**Raw result:** `docs/evidence/d1/phase1/caller-trace-20260922.json`.
**Zero confirmations:** `docs/evidence/d1/phase1/zero-caller-grep-transcript.txt`, measured 2026-09-22T05:33:08Z.

**Designated input (1-D2-01):**
- `claude/2026-09-21-D2-forensic-caller-inventory-P32.md` (79 names, measured 2026-09-21T14:39Z)
- `claude/2026-09-22-D2-setA-caller-trace.md` (Set A, measured 2026-09-22T05:23:32Z)

**This is a check, not a second inventory.** Where the two agree the agreement is recorded and
nothing is re-derived. Where they disagree the disagreement is recorded and **not silently
reconciled**.

---

## 1 · The instrument had to be corrected four times, and that is the reason to trust it

A classifier that never surprised its author has not been tested. Each revision below was caught
by a specific piece of contrary evidence, not by re-reading the code:

| rev | rule | what it missed | how it was caught |
|---|---|---|---|
| 1 | line-scoped left context before the name | `supabase.rpc(⏎ "x" as any,⏎)` | the §4.2 zero-grep transcript showed an occurrence of `backfill_tag_decision_drift_admin` in an **admin component**, which rev 1 had scored as a non-call |
| 2 | whole-file 120-char backward window, quoted literals only | the REST form `` `${SUPABASE_URL}/rest/v1/rpc/<name>` ``; also scored a **commented-out** example as a call | `record_test_agent_run` flipped from "has caller" to "none", against both D2 and rev 1 |
| 3 | 140-char backward window + comment exclusion | `(supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: …; error: … }>)("x", …)` — the cast's own `;`/`}` read as a closed statement | a plain `grep` for `admin_list_certificates` found a call in `AdminCertificates.tsx` that rev 3 had scored as a mention |
| 4 | **forward** scan from `.rpc` to the first string literal, 500 chars | the same cast shape, when a multi-line comment sits between the cast and the name — more than 500 characters | `admin_search_users_v2` appeared in `scripts/` but not in `AdminUsers.tsx` |
| **5** | comments blanked first (preserving offsets), then forward scan 1200 chars from `.rpc`, plus `rpc/<name>` | — | stable; every verdict it changed was then confirmed **by hand in the file** (§3) |

Scanning **backwards** from the name is the wrong direction: the text between `.rpc` and the name
is arbitrary TypeScript. `scripts/verify-schema-dependencies.mjs:230-238` already says so, in the
repository, in a comment about this exact trailing-comma shape. Revision 5 scans forward, which is
what that script does.

**Consequence for anyone re-using D2's numbers:** the "NO CALLER FOUND — 33 of 79" list in
`2026-09-21-D2-forensic-caller-inventory-P32.md` §3a was produced by a backward-scanning
classifier and is **wrong for at least five names**. It is wrong in the dangerous direction —
it reports *no caller* where a caller exists.

---

## 2 · AGREEMENT — recorded, not re-derived

### 2.1 · Set A (all three) — agrees exactly, line for line

| object | D2 (2026-09-22T05:23:32Z) | D1 (2026-09-22T05:35:10Z) | verdict |
|---|---|---|---|
| `claim_username(text)` | `src/components/OnboardingModal.tsx:338` | same | **AGREE** |
| `change_custom_url(text)` | `src/pages/EditProfile.tsx:513` | same | **AGREE** |
| `clear_custom_url()` | none | none | **AGREE** |

D2's auth-state reasoning also checks out against the repository:
`src/components/Layout.tsx:331` gates `OnboardingModal` behind `{user && …}`;
`src/pages/EditProfile.tsx:311` redirects a signed-out visitor to `/login`.
Neither Set A caller needs `anon`.

D2's `clear_custom_url` point is accepted and is load-bearing for the matrix: the absence of a
caller there is a **written Owner decision**, quoted at `src/pages/EditProfile.tsx:563-578`, not an
accident. `src/lib/__tests__/customUrlCannotBeRemoved.test.ts:58` pins it with
`expect(src).not.toContain("clear_custom_url")`. Its disposition class is therefore *not*
"no caller — written disposition owed"; the disposition exists.

### 2.2 · Set B and Set C — agreement on every other object

Every caller D2 reported, D1 reproduces at the same file and the same line, including the
awkward ones:

- `increment_managed_page_view` → `src/pages/ManagedPageView.tsx:69` (**not** `:34`; D2's standing
  correction against `P1-revocation-list.md` §2.2 is confirmed a third time)
- `get_broadcast_feed` → `src/hooks/feed/useFeedQuery.ts:91`, the 4-argument overload, one site
- `log_app_event` → `src/lib/logger.ts:275`; `log_client_error` → `src/lib/reportClientError.ts:167`
- `release_judge_lock` → `useJudgingLock.ts:59`, `:165`, and `:183` — the third is a
  `navigator.sendBeacon` to `/rest/v1/rpc/release_judge_lock`, not a `.rpc()` call at all
- `record_test_agent_run` → `scripts/test-agent/run-checks.mjs:139`, also a REST path, posting with
  the anon key by design
- the 17 edge-only (service_role) callers of §9a, and the 24 session-gated frontend callers of §9b

---

## 3 · DISAGREEMENT — seven objects, every one in the same direction

Each was confirmed **by reading the file**, not by trusting the classifier. All seven are cases
where D2 reported *no caller* or *test-only* and a real production caller exists.

| # | object | D2 verdict | D1 measurement (2026-09-22T05:35:10Z) | shape that defeated D2's classifier |
|---|---|---|---|---|
| 1 | `backfill_tag_decision_drift_admin` | NO CALLER FOUND (§3a) | **`src/components/admin/JudgingInvariantsAudit.tsx:152`** | `supabase.rpc(⏎ "x" as any,⏎)` |
| 2 | `admin_delete_auth_user` | NO CALLER FOUND (§3a) | **`supabase/functions/delete-my-account/index.ts:80`**, **`supabase/functions/delete-user/index.ts:71`** | `adminClient.rpc(⏎ "x",⏎ {…})` |
| 3 | `admin_list_certificates` | NO CALLER FOUND (§3a) | **`src/components/admin/AdminCertificates.tsx:148`** | cast-inside-the-parens |
| 4 | `admin_search_certificate_recipients` | NO CALLER FOUND (§3a) | **`src/components/admin/AdminCertificates.tsx:260`** | cast-inside-the-parens |
| 5 | `admin_search_users_v2` | NO CALLER FOUND (§3a) | **`src/components/admin/AdminUsers.tsx:277`** | cast-inside-the-parens |
| 6 | `create_system_post` | TEST/CI ONLY (§3b) | **`src/lib/profilePostHelper.ts:41`**, **`src/pages/MyPhotos.tsx:409`** | cast-inside-the-parens |
| 7 | `admin_purge_orphan_user_data` | one caller | **two** — `delete-my-account/index.ts:168` *and* `delete-user/index.ts:157` | multi-line |

Quoted, so the reader need not take my word for it:

```ts
// src/components/admin/AdminCertificates.tsx:143-150
const { data, error } = await (supabase.rpc as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown[] | null; error: { message: string } | null }>)(
  // Call position, never stored — see src/lib/media/postMediaWrite.ts.
  "admin_list_certificates",
  { _query: "", _type: t || null, _limit: CERTS_PAGE_SIZE, _offset: p * CERTS_PAGE_SIZE },
);
```

```ts
// src/lib/profilePostHelper.ts:36-41
const { data: postId, error } = await (
  supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>
)("create_system_post", { … });
```

### 3.1 · What the disagreement does and does not change

**It does not invalidate PR #274.** Four of the seven (`admin_delete_auth_user`,
`admin_list_certificates`, `admin_search_certificate_recipients`, `admin_search_users_v2`) are
inside #274's `0027`/`0028`. #274's **own** in-file call-site inventory lists the
`delete-user` / `delete-my-account` callers for `admin_delete_auth_user` correctly, and its shape
— `REVOKE FROM public, anon` + `GRANT TO authenticated, service_role` — is the right shape for an
admin-UI or service_role caller either way. So the migration is right and **D2's 2026-09-21
inventory is the artefact that is wrong**.

**It does change the basis.** Anyone dispositioning these four as "no caller, therefore safe"
would be reasoning from a false premise onto a true conclusion. In the matrix their basis is
recorded as *"authenticated admin-UI caller, `authenticated` retained"*, never *"no caller"*.

**It changes one disposition outright.** `create_system_post` is not test-only. It has two
authenticated member-facing callers (`profilePostHelper.ts`, `MyPhotos.tsx`). A closure that
revoked `authenticated` on the strength of D2 §3b would break member post creation.

---

## 4 · The half D2 could not measure — cron, triggers and inner callers (D2 §10 item 6)

D2 handed this over explicitly: *"needs a `cron.job` and `pg_trigger` read — **D1's lane, not
mine**"*, and warned that *"'no caller in the application tree' is not 'no caller'."* That warning
was correct. **Twenty of D2's 33 "no caller found" names have a caller in the SQL lane.**

### 4.1 · Live `cron.job`, staging `fpszggreishhuvdpkmdr`, read 2026-09-22T05:30:00Z

| jobid | schedule | calls |
|---|---|---|
| 1 | `7 * * * *` | `public.wallet_ledger_v2_diff_snapshot('1 hour')` |
| 2 | **`5 seconds`** | `public.process_post_jobs(100)` |
| 4 | `20 3 * * *` | `public.prune_old_notifications(90, 5000)` |
| 5 | `30 3 * * *` | `public.emit_birthday_notifications()` |
| 6 | `25 3 * * *` | `public.prune_client_errors(30)` |
| 7 | `20 0 * * *` | `public.rollup_engagement_daily(…)` ×2 |
| 8 | `10 3 * * *` | `public.mark_expiring_post_drafts(7)` |

Jobs 9–12 are `net.http_post` calls to edge functions and name none of the reserved objects.

These seven run as the job owner, **not** as `anon`. A `REVOKE … FROM public, anon` does not
touch them. That is the point: it converts seven "no caller — written disposition owed" rows into
straightforward `internal/service-role only` rows.

> **⚠ SECURITY FINDING, raised here and deliberately not quoted:** four `cron.job.command` values
> (jobids 9, 10, 11, 12) embed **the anon JWT and two shared bearer secrets in plaintext** in the
> command text. `cron.job` is readable by any role with access to the `cron` schema, and the
> command text lands in `cron.job_run_details` and the statement logs. This is the skill §7 rule
> — *"never pass a secret as an SQL argument — it lands in query logs and `pg_stat_statements`"* —
> violated at the scheduler layer. **No secret value is reproduced in this file or any other
> artefact of this session.** It is outside P32's scope; it is recorded, not fixed (§5 of the work
> order: a defect outside the unit is recorded). It wants its own unit.

### 4.2 · Callers inside other function bodies (`supabase/migrations/**`, read 2026-09-22T05:30:18Z)

| object | called from |
|---|---|
| `clear_custom_url` | `change_custom_url` |
| `_gen_competition_order_no` | `submit_competition_entry` |
| `admin_rewind_stage` | `guard_stage_key_immutability`, `judging_write_decision_atomic` |
| `recompute_entry_from_tag_assignments` | `trg_recompute_entry_after_tag_change` |
| `recompute_entry_public_status` | `trg_recompute_entry_public_status`, `_tg_entry_public_status_recompute`, `_tg_round_publish_recompute`, `_tg_v3_catalog_recompute` |
| `_ensure_stats_row` | `trg_follows_counts`, `trg_friendships_counts` |
| `create_system_post` | `enforce_post_categories` |
| `emit_notification` | 9 notify/backfill functions |
| `enqueue_post_job` | `enqueue_post_created_job`, `notify_post_comment`, `notify_post_reaction`, `notify_post_tag` |
| `generate_custom_url` | `custom_url_slug`, `tg_profiles_assign_custom_url` |
| `log_push_outcome` | `push_on_notification` |
| `mark_expiring_post_drafts` | `enforce_post_draft_rules` |
| `pj_handle_comment_notification` · `pj_handle_reaction_notification` · `pj_handle_recount_engagement` · `pj_handle_tag_notification` | `process_post_jobs` |
| `recount_hashtags` | `sync_post_hashtags`, `unsync_post_hashtags` |
| `wallet_transaction` | `admin_wallet_credit`, `process_referral_reward`, `enroll_in_course`, `approve_deposit`, `wallet_ledger_apply_v2`, `request_withdrawal`, `soft_void_wallet_transactions`, `expire_gift_credit` |

**The technical point that decides most of these rows:** an inner call from one
`SECURITY DEFINER` function to another is executed **as the definer**, so it does not consult the
caller's `EXECUTE` privilege at all. Revoking `anon` from an object that is only ever reached
through a trigger or an outer definer function **cannot** break it. These are
`internal/service-role only`, and the closure is grant-only with no caller risk.

### 4.3 · Genuinely orphan — no application caller, no cron entry, no inner caller

Confirmed at **2026-09-22T05:33:08Z** and at **05:35:10Z**; absence is only true at a moment:

`expiring_post_drafts` · `prune_activity_minutes` · `reap_post_drafts` · `refresh_viewer_buckets`
· `password_verification_hook` · `apply_decision_to_remaining` · `get_derived_status_drift_admin`

`password_verification_hook` is orphan **because GoTrue invokes it out of band as
`supabase_auth_admin`**, which is precisely why its zero is not a reason to relax about it. D2
said the same and D2 was right.

The remaining six are candidates for `no caller — written disposition owed` — and per the skill,
*"a feature that has never worked is a decision, not a bug"*, so each is owed *make it work* or
*remove it honestly*, not a silent revoke.

---

## 5 · What this file does not do

It does not authorise anything. `P1-revocation-list.md` **Revision 2** clears exactly one object
and it is none of these. Caller evidence is an input to a disposition; it is not a disposition.
