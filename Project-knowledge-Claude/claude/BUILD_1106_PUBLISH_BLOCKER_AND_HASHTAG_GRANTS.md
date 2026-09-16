# BUILD 1106 / v1.2.14 — THE PUBLISHING BLOCKER, AND WHAT IT UNCOVERED

2026-08-17 · commit `f712736` · Android Build **#106 green, 7m 44s**
Production migration **20260817102540**

---

## 1. THE BLOCKER

Members could not publish from the Android app:

```
Could not publish
Cannot read properties of undefined (reading 'rest')
```

**Root cause — one word.** `usePostDrafts.ts:80` held

```ts
const rpc = supabase.rpc as unknown as UntypedRpc;
```

supabase-js defines it as a **method**: `rpc(fn,args,o){ return this.rest.rpc(...) }`.
Copying a method into a variable discards the object it belongs to. The copy ran
with `this === undefined` (ES modules are strict mode) and died on `this.rest`
— **before any network call**. Introduced 2026-08-12 in `a21a36e`; exactly one
call site, `publish_post_draft`, which is Share on a resumed draft.

The line directly above it was already safe and shows why:
`(t) => (supabase.from as X)(t)` looks the method up **in call position** every
time, so the receiver is still attached. A cast detaches nothing; only storing
the bare method does. **Codebase-wide scan: the only genuine instance.** The
four other hits call the method immediately and store the result.

**Proven at runtime, not by reading.** The new test builds a real supabase-js
client, renders the real hook, runs the real mutation, stubs only the socket.
Mutation-tested: old line → 3 of 4 fail with the exact production message; fix →
4 of 4 pass, RPC observed on the wire carrying `{_draft_id:"draft-abc"}`.

**Second fault in the same toast.** The member saw a raw JavaScript exception
and **no error code**, while `DRAFT-2002` sat in the log where nobody could see
it. `memberFacingFailure()` now shows a database refusal as written (ours
already carry `DRAFT-003`, `AUTH-0001`) and replaces a JavaScript fault with a
plain sentence. Both end with the code.

---

## 2. WHAT THE FIX UNCOVERED — CI REFUSED TO SHIP

Build **1105 failed**, correctly, on three defects in **my own hashtag
migration from that morning**:

```
recount_hashtags(uuid[])    EXECUTE by anon = TRUE   ← unauthenticated WRITE
suggest_hashtags(text,int)  EXECUTE by anon = TRUE
post_hashtags.author_id → auth.users FK      = NONE  ← deletion leaves rows
```

**Why they survived a day.** The file was named `20260816T1900_hashtag_index.sql`.
Both gates — `securityDefinerGrants` and `deletionCoverage` — select migrations
with `^(\d{14})`. Eight digits then a `T` does not match, so **neither gate ever
read the file**. The rename approved in cycle 5 is what exposed all three.

**The gate was not touched.**

### Migration 20260817102540 — scope, exactly three things

```sql
revoke all on function public.recount_hashtags(uuid[]) from public, anon, authenticated;
revoke all on function public.suggest_hashtags(text, integer) from public, anon;
grant execute on function public.suggest_hashtags(text, integer) to authenticated;
alter table public.post_hashtags add constraint post_hashtags_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete cascade;
```

**Pre-flight:** `recount_hashtags` ACL was `=X/postgres | postgres | anon |
authenticated | service_role` — PUBLIC included. 163 junction rows, 17 distinct
authors, **zero orphan author_id values**, so the FK validated without a rewrite.

**Post-migration, verified in production:**

| check | result |
|---|---|
| anon → recount_hashtags | **DENIED** |
| authenticated → recount_hashtags | **DENIED** |
| anon → suggest_hashtags | **DENIED** |
| authenticated → suggest_hashtags | **ALLOWED** (the typeahead) |
| postgres → recount_hashtags | ALLOWED (the trigger path) |
| FK | PRESENT, `convalidated = true` |
| data | 163 junction rows / 81 hashtags, unchanged |

**Authorization boundary, checked as instructed.** `recount_hashtags` cannot
forge a number — it recomputes from truth — but it was still an unauthenticated
write into `public.hashtags`, so every client role is now denied; its only
legitimate caller is the SECURITY DEFINER trigger owned by `postgres`.
`suggest_hashtags` keeps `authenticated` because composing requires sign-in; it
returns a tag, a display tag and two integers aggregated over **public posts
only**, exposes no author identity or post id, and cannot write. No argument
reaches another member's data through it.

**Functional proof after the revokes** (aborted transaction, nothing committed):

```
baseline  #nature = 2u/2p
insert    #nature = 2u/3p   #zzgrantprobe = 1u/1p   links = 2
delete    #nature = 2u/2p   orphans = 0
suggest('nat') -> 1 row
```

### Why the defining migration was amended

Both gates inspect the migration that **creates** the object — by design — so a
second file cannot satisfy them. Leaving it wrong meant a permanently red gate
whose only remedy is weakening the test. The delta was applied to production as
its own migration and the defining file corrected to match, so file and
production describe the same system.

---

## 3. RESULTS

```
typecheck            0
tests                1,913 passed, 1 skipped, 0 FAILURES
production build     0
Web build #129       SUCCESS  — the website carries the fix
Android Build #106   SUCCESS  — 7m 44s, versionCode 1106 / v1.2.14
```

## 4. NOT PROVEN — stated plainly

**ANDROID DEVICE RUNTIME: NOT PROVEN.** There is no phone here. The build is
proven; the app running on a handset is not. That verification is the owner's.

Also still open: the browser end-to-end journey
(photo → draft → resume → edit → Share → post row → media → feed) is **not yet
built**. The runtime hook test proves the fix; it does not walk the journey.
