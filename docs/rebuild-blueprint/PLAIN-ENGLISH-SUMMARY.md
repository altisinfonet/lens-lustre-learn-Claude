# 50mm Retina World — Plain-English Rebuild Guide

**For:** Founder / non-technical stakeholders
**Date:** 2026-05-12
**Based on:** Steps 1, 2A–2J, 3, and 4 forensic blueprints

---

## How to read this document

Every section has the same three parts:

1. **What it is right now** — the honest current state, in plain English.
2. **What it should be** — the target after the rebuild work.
3. **How we fix it** — the concrete actions and roughly how long they take.

No jargon where avoidable. Where a technical name matters (because your devs will need it), it's in `code font`.

---

## 0. The Big Picture (read this first)

### What it is right now
You have a **large, mature, mostly-healthy** photo-competition platform. About 900 source files, ~120 database tables, 35 server functions. The core rules (UTC time, soft-delete, judging contracts, wallet votes) are **rock-solid and battle-tested**. But ~65 small-to-medium issues have accumulated — most are localized, a handful are dangerous.

### What it should be
A platform that keeps everything that works, but where the **5 most dangerous corners** are bullet-proofed and the developer team can move 2–3× faster on new features without breaking old ones.

### How we fix it
**Do NOT rewrite from scratch.** A rewrite would cost ~80–120 engineer-weeks, take 6–9 months, and re-introduce bugs you've already paid to fix. Instead, do a **14-week phased hardening** (~27 engineer-weeks) that fixes the dangerous corners in place. Same product, much stronger foundation.

---

## 1. Money & Wallet (the highest-priority area)

### What it is right now
- Members earn money (votes, referrals, gifts) and withdraw to their bank.
- Two **different code paths** can deduct money from a wallet: one when a withdrawal is requested, another when an admin approves it. If both fire, a user could be **debited twice** for the same withdrawal.
- Manual deposits (UPI/bank) and gateway deposits (Stripe/PayPal/Razorpay) use **different** logic. A small change in one can leave the other unprotected.
- The "ledger" table (`wallet_transactions`) can be written to **directly** from the app instead of only through one safe function. That's like leaving the cash drawer unlocked.
- The bank-details and referral tables are accessed with "trust me, this is the right shape" code (`as any`), which means a future database change can crash payments without warning.

### What it should be
- **One single safe function** in the database handles every wallet move (credit, debit, refund, penalty). Nothing else can touch the ledger.
- Every deposit method (manual or gateway) goes through the **same** path with the **same** safety checks.
- Every wallet operation has an **idempotency key** — meaning if the network hiccups and a request fires twice, only one debit happens.
- Type-safe code everywhere money is involved. Schema changes can't silently break payments.
- A daily reconciliation report shows **zero drift** between what users earned and what's in the ledger.

### How we fix it
**Phase 1 of the plan — 3 weeks, top priority.**
1. Build one SQL function called `wallet_transaction()` that does every credit/debit.
2. Lock the `wallet_transactions` table so only that function can write to it.
3. Convert the withdrawal flow + every deposit gateway to use it, with a 1-week shadow-test (writes go both old and new way, results compared) before the cut-over.
4. Re-generate the type definitions and ban `as any` in the wallet code via an automatic check.

---

## 2. Judging System (the most complex area)

### What it is right now
- 4-round judging (Round 1 → 2 → 3 → 4 finals) with 10 SOW criteria, per-photo decisions, and a 100% judge-coverage gate before any round can close.
- The competition's "current round" is stored as **text** in three different formats: `'round2'`, `'r3'`, `'4'`. A regex extracts the digit. If anyone forgets the regex and writes plain `::int`, every judging save crashes.
- The system **dual-emits** stage labels: a new format (`status`) and an old format (`status_legacy`). New code that picks the wrong one will quietly disagree with the rest of the app.
- `useJudgePhotoData` is a **422-line monster hook** that does fetching, decision-aggregation, realtime, and persistence all at once. Hard to change safely.

### What it should be
- `current_round` stored as a clean **whole number** (1, 2, 3, 4). No regex. No format ambiguity.
- Only the new format remains. The legacy mirror is gone. There's exactly one source of truth per photo's status.
- The big judging hook is split into 4 small, focused hooks. New developers can understand it in an afternoon.
- All the strong invariants you've built (NR-only-in-R1, R4-only tagging, 10-criteria mandatory, declared-vs-locked, per-judge realtime privacy) **stay exactly the same** — they're working.

### How we fix it
**Phase 1 (schema) + Phase 4 (refactor) — done during a Round 4 declared period when no one is actively judging.**
1. Add a new `current_round_int` column, dual-write for one release, then swap readers and drop the text column.
2. Verify zero consumers of `status_legacy` via grep + production logs, then remove it from the consensus function.
3. Split the 422-line hook into: `useJudgePhotoFetch`, `useJudgeDecisionAggregator`, `useJudgeRealtime`, `useJudgePersistence`.

---

## 3. Notifications & Email

### What it is right now
- Emails (Brevo) and in-app notifications fire from **database triggers only** — this is **excellent**. It's CI-locked so nobody can accidentally bypass it.
- 9 templates for judging lifecycle, all working.
- **Gap:** Brevo sends back bounce/complaint webhooks, but they aren't surfaced in any admin dashboard. So you don't know when emails are silently failing.
- The `manage-notifications` server function uses an "anonymous" key when it should use a privileged "service" key. It works today but is fragile if security policies tighten.

### What it should be
- Keep the trigger-only architecture exactly as-is — it's the project's safest subsystem.
- An admin panel widget shows **bounce rate, complaint rate, queue depth** in real time.
- `manage-notifications` runs with proper service-role privileges and an audit log.

### How we fix it
**Phase 2 + Phase 5 — 1 week total.**
1. Switch `manage-notifications` to the service-role key with a per-call audit row.
2. Add a Brevo deliverability widget on `/admin/health`.

---

## 4. Database & Security (RLS)

### What it is right now
- ~120 tables, almost all with row-level security policies. **Strong.**
- 8 helper functions guard sensitive operations. **Strong.**
- A few tables allow direct writes that should only happen through guarded functions (the wallet ledger is the worst offender — see Section 1).
- A few realtime channels (`feed-live`, `live-admin-sync`, `admin_notifications`) are **broadcast to everyone** and the client decides what to render. This works today but wastes bandwidth and is a theoretical info-leak if the client code has a bug.

### What it should be
- Every sensitive table is **write-protected** at the database level — the app physically cannot bypass the safe function.
- Every realtime channel either has a **server-side filter** (e.g. only admins see admin events) or is documented as intentionally public.

### How we fix it
**Phase 2 + Phase 3 — 4 weeks.**
1. Revoke direct INSERT/UPDATE on `wallet_transactions`, `notification_emit_log`, and any other "ledger-shaped" table.
2. Add server-side filters on the three open realtime channels.
3. Run the Supabase linter on every table touched by the audit and fix any policy gaps it surfaces.

---

## 5. UI / Design System

### What it is right now
- Beautiful, distinctive dark editorial theme with a 590px center column. **Working.**
- 271 components, 49 shadcn primitives, custom "Auto" wrappers (`AutoBadge`, `AutoRole`) that keep role/badge rendering consistent everywhere.
- **Bugs:** the body font variable resolves to **Helvetica** even though Inter is imported (a one-line fix). Several `!important` flags in the container CSS. No automatic check that prevents devs from writing raw colors like `bg-blue-500` (which break the dark theme).
- 90 admin components built without a shared layout — each one re-invents the page header, toolbar, and table styles slightly differently.

### What it should be
- Body font correctly renders Inter. Container CSS clean. A lint rule blocks raw color classes.
- 3 shared admin primitives (`<AdminPage>`, `<AdminTable>`, `<AdminToolbar>`) that all 90 admin pages use.
- A Storybook + visual-regression harness so design drift is caught before it ships.

### How we fix it
**Phase 4 — 3 weeks. This is the one phase where you can optionally choose to also re-skin `/judge` and `/feed` if you want a visual refresh, without touching any of the working logic underneath.**

---

## 6. Performance, Cache & Realtime

### What it is right now
- One global query cache with sensible defaults. **Working.**
- A clever `dashboardInitGate` pre-loads everything new pages need in one shot, eliminating the typical "10 small requests on every page load" problem.
- A few caches (e.g. `AutoRole`'s in-memory copy) duplicate what's already in the main cache — wastes memory and can drift.
- Some cache invalidations are too broad — they refresh more data than necessary.

### What it should be
- One cache. No duplicates.
- Tighter invalidation keys so updates only refresh what actually changed.
- Bandwidth metrics on every realtime channel with alerts if usage spikes.

### How we fix it
**Phase 3 — 2 weeks.**
1. Fold `AutoRole`'s cache into the main React Query cache.
2. Audit every `invalidateQueries` call and tighten its key.
3. Add a metrics dashboard for realtime traffic.

---

## 7. The 14-Week Roadmap at a glance

| Phase | What happens | Weeks | Why it matters |
|---|---|---|---|
| **0. Freeze & Guardrails** | Lock the contracts; turn on stricter automated checks. | 1 | Stops new bugs from being added while you fix old ones. |
| **1. Money & Schema** | One wallet function. `current_round` becomes a number. Drop legacy mirror. | 3 | **Eliminates the only "real money at risk" issues.** |
| **2. Type Safety & RLS** | Kill `as any` in financial code. Lock down direct table writes. | 2 | Future schema changes can't silently break payments. |
| **3. Realtime & Cache** | Server-side filters. One cache. Metrics. | 2 | Ready for 10× more users. |
| **4. UI Cleanup (optional re-skin)** | Fix font/container bugs. Extract admin layout. Optional `/judge` + `/feed` refresh. | 3 | Faster admin development; fresher look if desired. |
| **5. Observability** | Health dashboards, structured logs, Brevo webhook surfacing. | 2 | You can see problems before users report them. |
| **6. Decommission** | Delete every `_legacy` / `_v2` / `_old`. Final security scan. | 1 | Clean codebase that the next developer thanks you for. |
| **Total** | | **14 weeks** | ~27 engineer-weeks + ~3 consultant-weeks |

---

## 8. What we are explicitly NOT changing

These subsystems are production-grade. **Do not touch them beyond the targeted fixes above:**

- The notification trigger architecture (it's CI-locked and works perfectly).
- The atomic vote-casting function and its public view.
- The "Frozen Contract v3" stage keys.
- `useGatedEntryStatus` — the only legal way to read entry status in the UI.
- The per-judge realtime filter (R5) — privacy invariant, CI-proven.
- The `dashboardInitGate` pre-loader.
- The WebP-only image pipeline.
- The Brevo email integration.
- The Forensic Mandate and the PROVE-block CI gate — the cultural keystones that keep the project safe.

---

## 9. The bottom-line answer to "rewrite or refactor?"

| Question | Plain answer |
|---|---|
| Should we rewrite from scratch? | **No.** Too expensive, too risky, and the core is genuinely good. |
| Should we leave it alone? | **No.** The wallet double-debit risk is real money. |
| What's the right path? | **A 14-week, in-place, phased hardening.** |
| What does it cost? | ~27 engineer-weeks + ~3 consultant-weeks. About **¼ the cost of a rewrite.** |
| What do we get? | All P0 risks gone, type-safe finance, faster dev velocity, optionally a refreshed `/judge` and `/feed` look — without losing a single one of the 18 months of hard-won invariants. |

---

## 10. The 5 things to do first (week-by-week sequence)

1. **Week 1:** Turn on the new CI gates (`audit-forbidden.yml` extended to wallet + RLS).
2. **Weeks 2–3:** Build and shadow-test the `wallet_transaction()` function.
3. **Week 4:** Cut over withdrawals + every deposit gateway to the new function.
4. **Week 4–5:** Migrate `current_round` from text to integer (during a Round 4 declared period).
5. **Week 5:** Drop `status_legacy` mirror; you're now P0-clean.

Everything after that is improvement, not emergency.

---

*This document is the plain-English summary of the full 12-document blueprint (Steps 1, 2A–2J, 3, 4) located in `docs/rebuild-blueprint/`. For technical details on any section, ask your engineering team to refer to the corresponding step document.*
