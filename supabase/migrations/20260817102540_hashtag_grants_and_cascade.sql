-- ═══════════════════════════════════════════════════════════════════════════
-- HASHTAG SYSTEM — CLOSE THE TWO GRANTS AND ADD THE MISSING CASCADE.
--
-- Applied to production 2026-08-17 as version 20260817102540.
--
-- These are three defects in my own migration of earlier today
-- (20260817051750_hashtag_index.sql), and they went unseen for a reason worth
-- recording: that file was originally named `20260816T1900_hashtag_index.sql`.
-- `securityDefinerGrants.test.ts` selects migrations with `^(\d{14})` — eight
-- digits then a `T` does not match — so the security gate never looked at it.
-- Renaming the file to the 14-digit convention is what made all three visible,
-- and CI then correctly refused to cut an Android build.
--
-- Scope is exactly three things. Nothing else is touched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. recount_hashtags — CLOSED TO EVERY CLIENT ROLE ─────────────────────
-- Measured before this ran: acl = {=X/postgres, postgres, anon, authenticated,
-- service_role} — i.e. PUBLIC as well. It is reachable at
-- /rest/v1/rpc/recount_hashtags by anyone holding the publishable key.
--
-- It cannot forge a number: it RECOMPUTES from post_hashtags joined to posts,
-- so the worst a caller gets back is the correct answer. But it is still an
-- unauthenticated WRITE into public.hashtags, and no client has any business
-- calling it. Its only legitimate caller is trg_posts_sync_hashtags →
-- sync_post_hashtags(), which is SECURITY DEFINER owned by postgres; inside
-- that function the effective user is the owner, so the trigger path keeps
-- working with every client grant removed.
revoke all on function public.recount_hashtags(uuid[]) from public;
revoke all on function public.recount_hashtags(uuid[]) from anon;
revoke all on function public.recount_hashtags(uuid[]) from authenticated;

-- ── 2. suggest_hashtags — CLOSED TO anon, KEPT FOR authenticated ──────────
-- The typeahead lives in the post composer, and composing requires a signed-in
-- member, so `authenticated` is the whole audience. A logged-out visitor has
-- no box to type into.
--
-- Authenticated access stays INSIDE its authorization boundary: the function
-- returns tag, display_tag and two integers, aggregated over PUBLIC posts only
-- (recount_hashtags filters `p.privacy = 'public'`). It exposes no author
-- identity, no post id and nothing private, and it cannot write. There is no
-- argument by which one member reaches another member's data through it.
revoke all on function public.suggest_hashtags(text, integer) from public;
revoke all on function public.suggest_hashtags(text, integer) from anon;
grant execute on function public.suggest_hashtags(text, integer) to authenticated;

-- ── 3. post_hashtags.author_id — CASCADE FROM auth.users ──────────────────
-- The column was created `author_id uuid not null` with no reference, so
-- deleting an account left its junction rows behind for ever — the same
-- 41-table gap deletionCoverage.test.ts exists to stop growing.
--
-- Verified before this ran: 163 rows, 17 distinct authors, and EVERY author_id
-- already exists in auth.users, so the constraint validates without a rewrite
-- and without touching a single row.
--
-- Counts stay correct through a deletion: removing the account cascades its
-- posts, and each post deletion fires trg_posts_unsync_hashtags, which
-- recounts the affected tags.
alter table public.post_hashtags
  add constraint post_hashtags_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete cascade;

comment on constraint post_hashtags_author_id_fkey on public.post_hashtags is
  'Account deletion must not leave a member''s hashtag rows behind. Added '
  '2026-08-17 after the gate that checks for it could finally see this table.';

-- ── VERIFIED IN PRODUCTION AFTER APPLYING ─────────────────────────────────
--   anon          -> recount_hashtags   DENIED
--   authenticated -> recount_hashtags   DENIED
--   anon          -> suggest_hashtags   DENIED
--   authenticated -> suggest_hashtags   ALLOWED   (the typeahead)
--   postgres      -> recount_hashtags   ALLOWED   (the trigger path)
--   FK post_hashtags_author_id_fkey     PRESENT, convalidated = true
--   163 junction rows / 81 hashtags     unchanged
--
-- Functional probe, run inside a deliberately aborted transaction:
--   baseline  #nature = 2u/2p
--   insert    #nature = 2u/3p   #zzgrantprobe = 1u/1p   links = 2
--   delete    #nature = 2u/2p   orphans = 0
--   suggest('nat') -> 1 row
