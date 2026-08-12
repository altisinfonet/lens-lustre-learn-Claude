# INCIDENT — "a deleted account is still commenting"

Investigation closed 2026-08-06. **Code audit + live database measurement both
complete.** No fix implemented, as instructed.

> ## ⚠️ HEADLINE: THE REPORTED BREACH DID NOT HAPPEN
>
> **No unauthorized write occurred.** The deletion worked correctly. The comment
> in the screenshot was never written to the database. What the owner saw was a
> **zombie session** — an app that still LOOKS signed in — plus an optimistic UI
> update that rendered a comment which never persisted.
>
> A real authorization weakness does exist underneath, and it is worth fixing.
> But it did not fire in this incident, and calling this a P0 breach would be
> wrong.

---

## 1. What the live database actually says

All five queries run against production on 2026-08-06 (read-only).

| Query | Result | Meaning |
|---|---|---|
| `auth.users` where email ilike `%neilbasu.ramt%` | **0 rows** | The auth record IS deleted |
| `profiles` for that id | **0 rows** | The profile IS deleted |
| Orphaned comment authors (`post_comments` LEFT JOIN `profiles` WHERE profile IS NULL) | **0 rows** | **Not one comment in the entire table has an author without a profile** |
| Every comment on the screenshot's post | **1 row** — Dipannita Sen, "Lovely", `2026-08-05 17:52:11+00` | The "Darun" comment is **not there** |
| Any comment created `2026-08-06 03:00–05:00 UTC` (08:30–10:30 IST, the screenshot window) | **0 rows** | **Nothing was written by anyone in that window** |

**Conclusion: the deletion purge worked completely, and the ghost comment does
not exist in the database.**

### The "Darun" red herring
A `content ilike '%darun%'` search returns exactly one row — but it is
`2026-08-03 11:21:44+00`, authored by **Mainak Mridha**, a live member with a
profile and an auth record, on a different post. *Darun* is a common Bengali
word for "excellent"; its appearance in both places is coincidence. **Do not
mistake it for the screenshot's comment.**

---

## 2. What actually happened — corrected timeline

| # | Stage | Verdict | Evidence |
|---|---|---|---|
| 1 | Admin clicks Delete | ✅ PASS | `AdminUsers.tsx:383` → `delete-user` edge function |
| 2 | Auth record deleted | ✅ **PASS — verified** | `auth.users` returns 0 rows |
| 3 | Profile deleted | ✅ **PASS — verified** | `profiles` returns 0 rows |
| 4 | Data purge | ✅ **PASS — verified** | 0 orphaned comment authors table-wide |
| 5 | Session revoked on the device | ❌ **FAIL** | Screenshot 2 (09:47): profile sheet open on the deleted e-mail, build 1053 |
| 6 | Client restriction guard | ❌ **FAIL — fails open** | `useAuth.tsx` `checkRestricted`: `if (error \|\| !data) return false;` |
| 7 | Realtime guard | ❌ **FAIL — wrong event** | `useAuth.tsx:130` subscribes to `event: "UPDATE"` only; a DELETE never fires it |
| 8 | Member types a comment | — | Screenshot 3 (09:45) |
| 9 | Optimistic UI renders it | ⚠️ **This is what was seen** | `useAddComment.ts` `OptimisticComment`; name falls back to "Photographer" because the cached profile is gone |
| 10 | **Write reaches the database** | ❌ **DID NOT HAPPEN** | 0 comments written in the entire 2-hour window |
| 11 | Profile page | ❌ FAIL (spins forever) | Screenshot 1 (09:48): skeleton placeholders, because its queries return nothing |

**Why the write failed is NOT proven.** The access token expires after
**3600 seconds** (confirmed in Supabase → Authentication → Sessions), and the
refresh must fail once the user is gone — so the most likely explanation is the
token had already expired by 09:45. **A network trace would settle it; we do not
have one.** What IS proven is that nothing was written.

---

## 3. The genuine weakness — real, latent, did not fire here

**Verified against the live database**, not just the migration files. A query of
`information_schema` for foreign keys on `post_comments`, `post_reactions`,
`posts` and `comments` returns **6 constraints**:

```
comments.article_id      → journal_articles.id   CASCADE
comments.entry_id        → competition_entries.id CASCADE
comments.parent_id       → comments.id            CASCADE
post_comments.parent_id  → post_comments.id       CASCADE
post_comments.post_id    → posts.id               CASCADE
post_reactions.post_id   → posts.id               CASCADE
```

**Not one of them is on `user_id`.** Authorship is unconstrained.

Combined with the INSERT policy —

```sql
CREATE POLICY "Authenticated users can comment on visible posts" ON public.post_comments
  FOR INSERT WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM posts …));
```

`auth.uid()` reads the `sub` claim from a signed JWT. It never asks whether that
id still belongs to an account. **So for up to one hour after deletion, a
deleted account's still-valid token WOULD be accepted for writes.** It simply
was not used inside that window here.

This also corrects a comment in our own code: `delete-user/index.ts:70` claims
deleting `auth.users` "cascades the FK-linked public tables". For
`post_comments` that is **false** — which is exactly why that function must
delete 40 tables by hand.

---

## 4. Findings, classified

| # | Finding | Class | Severity | Why |
|---|---|---|---|---|
| 1 | Two client guards leave a deleted account looking signed in | **Session Management Bug** | **P1** | The member sees a working app that silently does nothing. Confusing and reportable — which is exactly what happened |
| 2 | No FK on `user_id` + RLS authorises on the token alone | **Authorization / Database weakness** | **P1** | Real and exploitable for ≤1h after deletion. **Latent — did not fire here** |
| 3 | Optimistic UI shows a comment that never persisted, with no rollback the member can see | **UI Bug** | **P2** | This is what made it *look* like a breach. The strongest single contributor to the false alarm |
| 4 | Nothing logs a write attempt from a principal with no account | **Observability Gap** | **P2** | The only evidence in existence was a screenshot |
| 5 | `delete-user` purges by a point-in-time sweep, not a constraint | **Business Logic Bug** | **P2** | Anything written after the loop would survive. Nothing did |
| 6 | "Photographer" + placeholder is indistinguishable from a failed lookup (`DB-3005`) | **UI ambiguity** | **P3** | Correct degradation, ambiguous signal |
| 7 | Code comment claims an FK cascade that does not exist | **Documentation defect** | **P3** | Would mislead the next investigation |

**Severity revision.** The reported incident — *"a deleted user is writing to the
database"* — **did not occur**, so P0 is not warranted for the incident. The
underlying weakness (#2) is genuine and I would fix it at **P1**. That is my
honest read; the call is the owner's.

---

## 5. First security boundary that failed

```
Client guard      ❌ fails open        ← first to fail, but NOT a security boundary
Realtime guard    ❌ blind to DELETE   ← also client-side
JWT validation    ✅ behaved correctly
Session revocation ❌ does not exist    ← FIRST REAL FAILURE
Authorization/RLS  ⚠️ would have allowed a write — untested here
Database           ⚠️ no FK to catch it — untested here
```

**Session revocation is the first real boundary that failed.** RLS and the
database would both have failed too, but were never reached, because no write
was attempted inside the token's remaining lifetime.

---

## 6. Unknowns remaining

1. **Why the write failed** — expired token is the likely reason but is not
   proven. Needs a network trace from the affected device, or a controlled
   reproduction.
2. **Whether other endpoints behave the same** within the 1-hour window — not
   tested; requires a live request with a valid ghost token.
3. **Reproduction** — not attempted. Needs a throwaway account the owner creates
   and deletes; the sandbox cannot sign in and deletion is irreversible.

---

## 7. Recommended fixes — NOT IMPLEMENTED

Ordered by value, not by depth.

1. **Split the fail-open branch** in `checkRestricted` — sign out on
   `!data && !error`, stay signed in on `error`. Small, safe, and it is what the
   owner actually asked for ("instant log off"). **Fixes the reported symptom.**
2. **Widen the realtime guard** to `event: "*"` so a DELETE ejects the session.
3. **Add `user_id` foreign keys** — `REFERENCES auth.users(id) ON DELETE CASCADE`
   on `post_comments` and every other table in the purge loop. Closes weakness #2
   permanently and replaces 40 hand-written deletes with a constraint.
   ✅ **Safe to add: the orphan query returned 0 rows, so nothing blocks it.**
4. **Log ghost write attempts** with a new code, so this is never invisible again.
5. **Make the optimistic comment roll back visibly** when the insert fails —
   otherwise the UI keeps telling members something happened when it did not.

⚠️ **A RESTRICTIVE RLS policy requiring a profiles row is deliberately NOT
recommended.** That is the exact shape that blocked 39% of members from posting
in the profile-photo-gate incident (`PROFILE_PHOTO_GATE_IMPACT.md`). The foreign
key gives the same guarantee without a policy that can wall out live members.

---

## 8. Confidence

- **No comment was written: 99%.** Two independent queries — the post has one
  comment, and the whole table has none in the window.
- **The account is fully deleted: 100%.** Both tables return 0 rows.
- **The purge left no orphans: 100%.** Table-wide check.
- **No FK on `user_id`: 100%.** Live `information_schema`, not migrations.
- **Access-token window is 3600s: 100%.** Read from the dashboard.
- **That an expired token is why the write failed: ~70%.** Plausible and
  consistent, not proven.
