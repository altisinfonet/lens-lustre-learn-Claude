# The permission layer — what is actually exposed, and what only looks exposed

**Measured against production `jtdtehuqtinjxropkkcn` on 2026-09-01 between 11:06Z and 11:22Z. Read-only throughout.**

**What I did not do, and it matters:** I did not call a single one of these functions. Every statement below comes from reading function definitions, privilege grants and policy definitions in the catalogue. So when I say a function is "unguarded", I mean **its source contains no identity check** — not that I proved it leaks. Proving that would mean calling it against production, which I am not permitted to do and would not do uninvited.

---

## Read this part first: the scary number is mostly not real

The vendor's own linter reports **1,046 issues** — 546 security, 500 performance. That number will frighten anyone who sees it, and it should not.

The largest single block is "**248 SECURITY DEFINER functions executable by `anon`**" — i.e. by anybody on the internet, with no login. Written that way it sounds like 248 open doors into your database. I checked, systematically, across all 248 rather than by sampling:

| What the 248 actually are | Count |
|---|---|
| **Trigger functions** — no arguments, return `trigger`; cannot be usefully called through the API at all | **115** |
| **Callable, and the source does check identity** (`has_role` / `auth.uid()` / `is_admin`) | **71** |
| **Callable, and the source never mentions identity** | **62** |

And of those 62, **most are meant to be public.** `verify_certificate`, `username_available`, `resolve_custom_url`, `global_search`, `get_top_contributors`, `suggest_username` — a logged-out visitor is supposed to be able to do those things. That is a working public website, not a hole.

I spot-checked nine of the most alarming-looking names by reading their bodies (2026-09-01 11:10Z). **Eight of nine guard themselves properly.** `admin_search_users`, `search_profiles_admin`, `get_profile_admin`, `admin_set_photo_rejected`, `admin_rewind_stage`, `get_judge_collusion_admin`, `wallet_ledger_v2_diff_report` all open with a `has_role(auth.uid(), 'admin')` check and either raise an exception or return nothing. Whoever wrote those did it correctly.

**So: 1,046 advisories collapse to a handful of things worth acting on.** Those are below. I am reporting the reduction as prominently as the findings, because publishing "248 admin functions open to the internet" would have been alarming, quotable, and wrong.

---

## The findings that survive scrutiny

### 1. Anyone can test whether an email address has an account here

`public.email_exists(_email text)` — SECURITY DEFINER, executable by `anon`, no identity check in its body.

**Plain language.** With nothing but your public API key — which is in the JavaScript of your website, visible to everyone — a stranger can ask "does neil@example.com have a 50mm Retina World account?" and get a yes or no. Repeatedly. As fast as they like.

**Why this is the classic one.** It is called account enumeration. An attacker takes a list of a million leaked email addresses, asks your site which of them are members, and now has a verified list of your members' email addresses. That list is what phishing campaigns and credential-stuffing runs are built from. The member has done nothing wrong and will never know.

**Why 400 million members makes it worse.** The value of the answer scales with your membership. At 400 M members, "is this address a member?" is a question worth money to the wrong people, and your API answers it for free, without a login, with no rate limit that I could see from the catalogue.

**The better way.** Signup and password-reset flows should answer identically whether or not the address exists ("if that address is registered, we've sent an email"). If the front end needs `email_exists` for form validation, it should be behind an authenticated or rate-limited edge function, never an anon RPC.

---

### 2. Certificates can be searched by a person's name, without logging in

`public.search_certificates(_name text, _course_title text, _issued_date date)` — SECURITY DEFINER, `anon`-executable, no identity check.
`public.verify_certificate(_cert_id text)`, `verify_certificate_by_token(_token text)` — same.
`public.verify_staff_id(_id_number text)` — same.

**Why I am raising this specifically.** In this same conversation you told me what you want:

> "all certificates PDF be stored in R2 and in DB user specific link will be there which is visible only the certificate owner itself."

`search_certificates` takes a **person's name** and returns matching certificates. That is the opposite of owner-only. A public **verify by ID or token** endpoint is normal and correct — that is how certificate verification is supposed to work, and I would not change it. **Search by name is a different thing**: it turns a verification tool into a directory of who has won what, browsable by anyone.

`verify_staff_id(_id_number text)` lets anyone probe staff ID numbers unauthenticated, which is the same shape of problem applied to your staff.

**The better way.** Keep verify-by-token public — an unguessable token per certificate is exactly right, and it is what your stated design already implies. Remove the name search from the anon role, or require a token alongside the name. When the R2 migration happens, make the object key itself the unguessable token; then "owner-only link" and "publicly verifiable" stop being in conflict.

---

### 3. Eight unauthenticated functions can cause the database to do work — or to write

Of the 62 unguarded callable functions, **8 are VOLATILE**, meaning they may write:

| Function | What concerns me |
|---|---|
| `recompute_entry_from_tag_assignments(p_entry_id uuid)` | anyone can trigger an expensive recomputation, for any entry id, as often as they like |
| `recompute_entry_public_status(p_entry_id uuid)` | same |
| `increment_managed_page_view(_page_id text)` | anyone can inflate any page's view count without limit |
| `_gen_competition_order_no()` | anyone can burn competition order numbers |
| `set_write_path(p text)` | sets a write path, unauthenticated — the name alone warrants a look |
| `get_broadcast_feed(...)` (two forms) | a feed reader marked VOLATILE, so it may be writing during a read |
| `record_test_agent_run(p_token text, …)` | takes a shared secret as its **first argument** rather than a header |

**Plain language — and this is the part that matters at your scale.** Most attacks on a large platform are not clever. They are *amplification*: find a request that is cheap for the attacker and expensive for you, then repeat it. A single HTTP call to `recompute_entry_public_status` costs an attacker nothing and costs your database a full recomputation. With no login, no cost, and no rate limit visible from the catalogue, that is a denial-of-service lever handed out with the public key.

`record_test_agent_run` is defensible — it authenticates by token, which is a real decision, not an oversight. But a secret passed as an SQL argument ends up in query logs and `pg_stat_statements` in a way a header does not.

**The better way.** Anything that writes or computes should require a session, or sit behind an edge function with rate limiting. `increment_managed_page_view` should be a fire-and-forget counter at the edge, never a database call from an anonymous browser.

---

### 4. One function with no guard at all

`public.get_primary_admin_user_id()` is, in full:

```sql
SELECT user_id FROM public.user_roles WHERE role = 'admin'
ORDER BY created_at ASC NULLS LAST, user_id ASC LIMIT 1
```

SECURITY DEFINER, `anon`-executable, no check of any kind. It hands the platform owner's user id to anyone who asks.

**But here is the boring explanation, and it mostly holds.** The neighbouring function `get_public_role_user_ids(_role)` deliberately allows exactly two roles to be enumerated — `'admin'` and `'judge'` — and raises an exception for anything else. So somebody decided, on purpose, that admin and judge user ids are public. `get_primary_admin_user_id` is consistent with that decision, not a contradiction of it.

**What I would still change.** A user id is not a credential, so this is not a breach. It is a targeting aid: it tells an attacker precisely which account to aim at. If admin ids must be enumerable for the app to work, that decision should be written down where the next developer will find it. If they need not be, close both.

---

### 5. The real performance finding: 384 places where the database checks permission more than once, per row

**What I measured (as of 2026-09-01 11:18Z):** the linter reports **384 instances of "multiple permissive policies"** — a table where one role, for one action, is governed by two or more permissive policies. Plus **29 policies that re-evaluate `auth.uid()` for every single row**. Across **688 policies** in total.

The worst tables: `post_tags` (11 policies), `newsletter_subscribers` (10), then `comments`, `posts`, `post_comments`, `image_comments` and `profiles` at 9 each.

**Plain language.** A permissive policy is an "OR". Two of them on the same table and action means the database asks *both* questions about *every row it considers* and lets the row through if either says yes. `posts` has 9 policies, 5 permissive. So reading the feed means evaluating several permission expressions against every candidate post — and where `auth.uid()` is not wrapped properly, working out who you are, again, for every row.

**Why 400 million members breaks this.** This is the purest example in the whole audit of a cost that is invisible now and fatal later. Today a feed query considers a few hundred rows, so a few hundred extra checks cost nothing. Scale the tables to hundreds of millions and the multiplier is unchanged but the row count is not. The query does not get slower gradually; it falls off a cliff, and the profiler blames the query rather than the policies, because the policy work is charged to whatever statement triggered it. This is the same hiding place as the `user_roles` scans in part 3.

**The better way.** Consolidate: one permissive policy per table per action per role, with the OR conditions written inside it, so the planner sees one expression. Wrap every `auth.uid()` as `(select auth.uid())` so it is computed once per query rather than once per row. Both are mechanical changes with no behaviour difference — and this is, in my judgement, the highest-value performance work available in the database.

---

### 6. Four views bypass row security by design

**ERROR level, the only ERROR-level findings in the whole security set:** `entry_public_status`, `judge_decisions_owner_safe`, `judge_tag_assignments_owner_safe`, `judge_comments_owner_safe` are all defined `SECURITY DEFINER`.

**Plain language.** A view like this runs as its *creator*, not as the person reading it — so row-level security on the underlying tables does not apply. Three are named `_owner_safe`, which tells me the intent was to hand back only the owner's own rows. **That intent now lives entirely inside the view's own WHERE clause.** If it is right, the design works. If anyone ever edits that clause carelessly, every member sees every judge's decisions, and no policy anywhere will stop it.

I have not read the four view bodies. That should be done, deliberately, by someone who knows what each is meant to return — and each should carry a test that proves a member cannot see another member's rows through it.

---

### 7. Seven tables have security switched on and no rules — including two leftover backups of member data

`categories_migration_dropped` · `client_errors` · `contributor_engagement_daily` · `media_repair_audit` · `member_activity_minutes` · `posts_dead_host_backup_20260812` · `push_delivery_log`

**Plain language.** Row security is on, and there are no policies. In Postgres that means **nobody can read them through the API** — only the server-side service key. For the five server-side tables (`client_errors`, `push_delivery_log`, `member_activity_minutes`, `contributor_engagement_daily`, `media_repair_audit`) that is the correct and deliberate configuration. **No action needed, and I want to be clear about that** — this is an INFO-level lint, not a hole.

The two that stand out are `categories_migration_dropped` and **`posts_dead_host_backup_20260812`** — a backup copy of your posts table, made on 12 August, still sitting in the production database. Locked down correctly, but it is member content living past its purpose, and it ties to the **13 leftover tables** I reported earlier. Data you keep is data you are responsible for.

---

### 8. Compromised-password checking is switched off

Supabase Auth can check new passwords against the HaveIBeenPwned breach corpus and refuse ones that are already public. **It is disabled** (measured 2026-09-01 11:07Z).

**Plain language.** Right now a member can set their password to one that is already circulating in a public breach dump, and nothing stops them. This is a single toggle in the Auth settings, it costs nothing, and it prevents the most common way ordinary accounts get taken over. Of everything in this report, it is the best ratio of safety gained to effort spent.

---

### 9. Small, mechanical, worth doing

- **6 tables have no primary key.** At scale that blocks efficient replication and safe deduplication.
- **2 pairs of identical duplicate indexes**: `feed_events` has `idx_feed_events_post` and `idx_feed_events_post_id`; `judge_decisions` has `judge_decisions_entry_judge_round_photo_unique` and `judge_decisions_unique_per_judge_round_photo`. Every write updates both. Drop one of each.
- **1 foreign key with no covering index**: `post_hashtags.author_id`. On a photography platform, hashtags will not stay small.
- **9 functions with a mutable `search_path`.** I checked whether any of them are SECURITY DEFINER — **none are** (verified 2026-09-01 11:08Z, count = 0). That removes the privilege-escalation risk this warning usually signals. Worth tidying; not urgent.
- **`plpgsql_check` is installed in the `public` schema** and should be moved.

**One number I will not give you a single answer for.** Unused indexes: the vendor lint reports **78**; my own count today says **298 indexes have never been scanned, of which 125 are droppable** (the other 173 back primary keys or unique constraints and must stay), totalling 2,336 kB. My earlier report to you said 188. Three methods, three numbers, measured at different times with different filters. **I have not reconciled them and I would not drop a single index on any of these numbers until I had.** I am telling you the disagreement rather than picking the number that sounds best.

---

## Order I would act in

| | Action | Effort |
|---|---|---|
| 1 | Turn on compromised-password protection | one toggle |
| 2 | Take `email_exists` off the `anon` role | minutes |
| 3 | Take `search_certificates` (name search) off `anon`; keep verify-by-token | minutes |
| 4 | Consolidate permissive policies; wrap `auth.uid()` in a subselect | days — **biggest scale win in the database** |
| 5 | Put the 8 volatile anon functions behind a session or a rate-limited edge function | days |
| 6 | Read and test the four SECURITY DEFINER views | hours |
| 7 | Drop the two duplicate indexes; index `post_hashtags.author_id`; drop `posts_dead_host_backup_20260812` | hours |
| 8 | Reconcile the unused-index counts, then act | hours |

---

*Measured by Developer 2 / Session 2, read-only against production, 2026-09-01 11:06Z–11:22Z. No function was called. No writes, no schema changes, no deployments. Where a figure comes from the vendor's linter rather than my own query, I have said so; where I verified the linter's claim independently, I have said that too. Status: VERIFIED for everything I queried myself; the linter's categorisations are RELAYED except where I re-derived them.*
