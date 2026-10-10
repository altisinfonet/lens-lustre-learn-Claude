# P32 · D2 — THE CLIENT CALL-SITE INVENTORY

**Branch:** `d2/P32-callsite-inventory-20260904`, cut from `staging` @ `580dede`.
**Date:** 2026-09-04. **Author:** D2. **Read-only: this branch changes no source.**

Started before D1's function list landed, per the Auditor's ruling. This half is the lane-wide
sweep and does not depend on D1's input; the intersection is §6.

---

## 1 · The question this answers

Not "where is each function called". That is a list, and a list would not have caught either of
the two P31 defects. The question is:

> **When this call is REFUSED, what is the member told?**

Three verdicts:

| verdict | meaning |
|---|---|
| **FAIL-OPEN** | degrades safely. The member sees less, and nothing they are shown is untrue. |
| **FAIL-CLOSED** | the member sees an honest error, or the action is honestly refused. |
| **FAIL-WRONG** | **the member is told something untrue, or the failure is swallowed and nobody learns of it.** |

**FAIL-WRONG is the finding class.** A revoke against a FAIL-WRONG call site is how a security fix
becomes a member telling their friend the site is broken — or worse, a control that silently stops
controlling.

## 2 · Method, and its limits stated up front

Every `.rpc(` occurrence under `src/**` extracted with file, line and a 37-line window, then each
window scored for handling signals. **The signals bucket the sites; they do not decide the
verdict.** Every site in the unhandled buckets was then read individually — the verdicts in §4 and
§5 come from reading the code, not from the regex.

```
109 raw matches
  6  in __tests__            excluded
  3  in src/test/            excluded — ESLint fixture strings, not real calls
100 PRODUCTION CALL SITES   88 distinct functions
```

Of those 100: **29 have no error branch at all**, and **2 use `.then(() => {})`** — the exact
pattern P31 just removed from `ManagedPageView`.

**Limit, stated:** the window is 37 lines. A handler further away than that is scored "no" and was
caught by reading; a handler that exists but is wrong is scored "yes" and would not be. §5 is
therefore complete for the unhandled set and a spot-check for the handled set — **the 69 handled
sites have not each been read**, and this inventory does not claim they have.

## 3 · THE HEADLINE — two controls that fail silently OPEN, in the dangerous direction

These are not "the member is told something untrue". They are worse: **a protection that stops
protecting, invisibly, with the page looking entirely normal.** Neither depends on a revoke —
**both behave this way today on any network failure.**

### 3.1 · `filter_moderated_user_ids` — `src/pages/HashtagFeed.tsx:73` · **FAIL-WRONG (safety)**

```ts
supabase.rpc("filter_moderated_user_ids", { _ids: authorIds } as any),
...
const blockedAuthors = new Set(((moderatedRes.data as any[]) || []).map((r) => r.id));
const visiblePosts = data.filter((p) => !blockedAuthors.has(p.user_id));
```

On refusal `data` is null → `|| []` → `blockedAuthors` is **empty** → **nothing is filtered** and
**every banned or suspended author's posts appear in the hashtag results.**

The comment directly above it says why the RPC exists:

> *"BUG-119: mirror BUG-088 — hashtag results must exclude banned/suspended authors … anon has no
> SELECT on the mirror's moderation flags (BUG-121), so use the anon-callable ban-aware RPC"*

**The failure path reproduces exactly the bug the RPC was written to fix.** The `.error` field is
never read.

### 3.2 · `get_public_role_user_ids` — `src/pages/Discover.tsx:68` · **FAIL-WRONG (safety)**

```ts
const { data } = await supabase.rpc("get_public_role_user_ids" as any, { _role: "judge" });
const ids = (data as any[] | null || []).map(...);
setHiddenIds([...new Set(ids)]);          // ← [] on failure, and [] is NOT null
...
if (hiddenIds === null) return null;      // the "still loading" gate — passed
if (hiddenIds.length > 0) { query = query.not("id", "in", ...); }   // ← skipped entirely
```

`hiddenIds` starts `null` and that null correctly gates the query. **On refusal it is set to `[]`,
which is not null**, so the gate opens and the judge-exclusion filter is skipped. The comment again
names the exact consequence:

> *"a direct `.eq("role","judge")` returns `[]` and judges leak into Discover results (breaks
> judge-privacy contract)"*

**The empty-array fallback reproduces the leak the RPC exists to prevent.**

Both are the Standing Rule 21 shape turned inside out: the comment correctly describes the failure
mode, and the code beneath it implements that failure mode as its fallback.

## 4 · The other FAIL-WRONG sites — the member is told something untrue

| function | site | what the member is told |
|---|---|---|
| `get_my_certificate_entries` | `Certificates.tsx:131` | **"you have no certificates"** when they have some. The P31 harm exactly, on the member's own page. |
| `get_my_unread_notifications_grouped` | `useNotificationsQuery.ts:193` | badge reads **0 unread**; notifications silently missed. |
| `get_public_role_user_ids` | `lib/adminBrand.ts:35` | admin brand name and verified badge **disappear for every non-admin viewer** — the comment says so verbatim. |
| `app_has_role` | `useFriendFollow.ts:91` | an admin renders as **not** an admin. |
| `are_friends` | `useProfileData.ts:69` | an existing friend is shown **"Add friend"**. |
| `mutual_friends_count`·`mutual_friend_ids` | `MutualFriends.tsx:29,30`, `Friends.tsx:151,155`, `DiscoverCard.tsx:38` | **"0 mutual friends"** when there are many. |
| `get_my_story_view_counts` | `ProfileStories.tsx:335`, `FeedStoriesBar.tsx:82` | owner told **nobody viewed** their story. |
| `get_post_view_counts` | `useFeedQuery.ts:210` | view counts read **0**. |
| `resolve_custom_url` | `CustomUrlProfile.tsx:20` | *mitigated* — falls back to a `profiles_public_data` read; only if BOTH fail does a real profile URL render **`/not-found`**. |

## 5 · The two swallowed RPCs — `.then(() => {})`, no handler at all

Exactly the pattern P31 removed from `ManagedPageView`. Both are RPCs; **every other
`.then(() => {})` in `src/**` (7 of them) is a `.from()` table write**, same pattern but outside
P32's scope — recorded so the next sweep does not have to re-derive it.

| function | site | consequence of a swallowed refusal |
|---|---|---|
| `release_judge_lock` | `useJudgingLock.ts:165` | **the lock is never released.** Another judge is locked out of that entry until it expires. Operationally worse than a view counter, and invisible. |
| `process_referral_reward` | `CompetitionSubmit.tsx:328` | a referral reward is **silently not paid**, with nothing logged. Money. |

## 6 · The intersection with D1 — how to read it when the list lands

Per the ruling, a function D1 names for which **no call site exists here** is itself a finding: a
database function the app never calls has a different disposition from one it depends on. That
comparison needs D1's list; this file supplies the client side of it, and the appendix is the
complete set so the intersection can be taken mechanically rather than by memory.

**Nothing in this branch is fixed.** The disposition list is the Auditor's to freeze before anyone
writes code — the sequencing P30 got right.

## 7 · What this inventory does NOT establish

- The 69 sites with an error branch were **not each read**. Bucketed by signal, spot-checked only.
- Whether each function is **anon-executable or VOLATILE** is D1's measurement, not taken here.
- No call site was exercised against a live refusal except the P31 ones already proved in
  `docs/evidence/d2/P31/browser/`. These verdicts are read from code; the two in §3 deserve a
  browser reading before anyone acts on them, and D2 cannot take it from a container whose egress
  to the site is blocked.

Full table: `appendix-all-call-sites.md`.
