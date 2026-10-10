# SEC-P3E-1 (LOW) · post_shares SELECT scoped to post visibility

**Before:** `"Authenticated users can view shares" FOR SELECT TO authenticated USING (true)` — any member could read who shared which Friends-only / private post (and, where post_shares is published, receive it over realtime). Post content was never exposed.

**After (20261010_0003):** one permissive SELECT policy, `TO authenticated`:
`user_id = (SELECT auth.uid()) OR EXISTS (posts p WHERE p.id = post_id AND can_view_post((SELECT auth.uid()), p.user_id, p.privacy))`.
The second arm is post_reactions' own expression. The own-row arm is deliberate: unsharing is `DELETE … WHERE post_id AND user_id`, and PostgreSQL applies SELECT policies to the rows a DELETE's WHERE reads; without it a member cannot take down their share of a post that later became private (harness step 2 shows 0 rows deleted).

Unchanged: INSERT/DELETE/restrictive policies, grants, publication, the count trigger and recount job (SECURITY DEFINER). Client reads (ShareSummaryTooltip, PostDetail count, wall, unshare) only ask about visible posts or own rows.

**Evidence:** `p3e1-run-tests.sh` → `p3e1-transcript.txt`: 49 PASS / 0 FAIL, staging shape (not published) + production shape (in supabase_realtime). Fail-first (a stranger reads 3 of 3), apply, PROBE green, 6 PROBE mutants red (incl. a hidden always-true arm that passes the text checks), admin candidate skipped, rollback exact, drift and lane refusals.
Real staging (read-only, 08:2x UTC): the PROBE's live picks exist (3 authors, non-admin sharer + stranger).
Not proved here: realtime delivery itself (no realtime server in the scratch cluster); realtime filters postgres_changes by this same SELECT policy.
