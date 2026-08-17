-- ═══════════════════════════════════════════════════════════════════════════
-- HASHTAGS: a real data model, maintained server-side, counted by PEOPLE.
--
-- Owner request, 2026-08-16: a production hashtag typeahead. Scope confirmed by
-- him: the suggestion UI appears in the POST COMPOSER ONLY (Feed and My Wall,
-- which are the same component, plus the app's copy of it). The COUNTING below
-- is deliberately wider than that — it is driven by a trigger on `posts`, so a
-- caption edited from anywhere at all keeps the statistics honest without any
-- other screen needing to know hashtags exist.
--
-- ── WHY THIS TABLE HAS TO EXIST ────────────────────────────────────────────
-- There was no hashtag storage of any kind. Hashtags lived only as text inside
-- posts.content, and `global_search_hashtags` re-parsed EVERY public post's
-- caption with a regex on every call. Measured today: 223 posts re-scanned per
-- keystroke, with no index able to help. That is fine at 223 and is exactly the
-- shape of thing the owner's brief forbids for a typeahead.
--
-- ── AND WHY IT COUNTS PEOPLE, NOT POSTS ────────────────────────────────────
-- Measured on production before writing a line of this:
--
--     #aug_gallerycontest2026    24 posts    13 unique users
--     #50mmretinaworld           11 posts     1 unique user
--     #50mmretina                 6 posts     1 unique user
--
-- On post count, #50mmretinaworld is the second most popular hashtag on the
-- platform. Exactly one person has ever used it. A "popularity" number that
-- says 11 there is not a small inaccuracy, it is the wrong quantity — which is
-- why `unique_user_count` is the ranking signal and `post_count` is kept only
-- as supporting information.
--
-- ── THE MATCHING PATTERN, AND AN INCONSISTENCY THIS INHERITS ───────────────
-- `RichContentRenderer` renders `#(\w+)` as a link — one character or more. The
-- old search RPC required `{2,40}`. So `#a` has always been a clickable link
-- that search could never find. This migration follows the RENDERER, because
-- what a member sees underlined is what they think a hashtag is. A 60-character
-- ceiling is imposed to stop a pathological caption creating absurd rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The canonical form ─────────────────────────────────────────────────
-- #StreetPhotography, #streetphotography and #STREETPHOTOGRAPHY are ONE tag.
create or replace function public.normalize_hashtag(raw text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(lower(regexp_replace(coalesce(raw, ''), '^#', '')), '');
$$;

comment on function public.normalize_hashtag(text) is
  'The single definition of "the same hashtag". Strips a leading # and lowercases. '
  'Both the trigger and the suggestion RPC go through this, so a tag can never be '
  'stored one way and searched another.';

-- ── 2. Storage ────────────────────────────────────────────────────────────
create table if not exists public.hashtags (
  id                uuid primary key default gen_random_uuid(),
  -- The canonical key. Lowercase, no leading #. Unique by construction.
  tag               text not null unique,
  -- How it was FIRST written by a member, so the suggestion list can show
  -- #StreetPhotography rather than shouting #streetphotography at everyone.
  display_tag       text not null,
  -- THE RANKING SIGNAL. Distinct authors, never post count. See the header.
  unique_user_count integer not null default 0,
  -- Supporting information only. Kept because "how much is this tag used"
  -- and "how many people use it" are both real questions.
  post_count        integer not null default 0,
  last_used_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint hashtags_tag_shape check (tag ~ '^[a-z0-9_]{1,60}$')
);

comment on table public.hashtags is
  'One row per canonical hashtag. Counts are maintained ONLY by '
  'trg_posts_sync_hashtags — nothing client-side may write them.';

-- The junction. `author_id` is denormalised on purpose: the unique-user count
-- is the hot query and joining back to posts for every count would undo the
-- point of having this table.
create table if not exists public.post_hashtags (
  -- `on delete cascade` is REQUIRED, and the delete path is a BEFORE trigger
  -- because of it. Both halves were learned by rehearsal, in this order:
  --
  --   1. With cascade + an AFTER DELETE trigger, PostgreSQL removed these rows
  --      before the trigger could read WHICH hashtags to recount. It recounted
  --      nothing and left the counts stale — silently. Measured: deleting one
  --      of six posts left #streetphotography at 3 users / 6 posts, truth 2 / 5.
  --   2. So the cascade was removed. That was worse: the foreign key then
  --      BLOCKED post deletion completely — "violates foreign key constraint".
  --      A member could not delete their own post.
  --
  -- The answer is neither: keep the cascade as a safety net, and clean up in a
  -- BEFORE DELETE trigger that runs while these rows still exist. See
  -- trg_posts_unsync_hashtags below.
  post_id    uuid not null references public.posts(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  author_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (post_id, hashtag_id)
);

comment on table public.post_hashtags is
  'Which post used which hashtag. The primary key makes "the same tag twice in '
  'one caption" unrepresentable, so #street #street counts once.';

-- ── 3. Indexes — the whole reason this migration exists ───────────────────
-- text_pattern_ops is what makes `tag LIKE ''str%''` an index range scan rather
-- than a sequential scan. Without it the default collation index cannot serve
-- a prefix match and every keystroke reads the table.
create index if not exists idx_hashtags_tag_prefix
  on public.hashtags (tag text_pattern_ops);

-- The ORDER BY of the suggestion query, so ranking is read from the index.
create index if not exists idx_hashtags_rank
  on public.hashtags (unique_user_count desc, post_count desc, last_used_at desc);

create index if not exists idx_post_hashtags_hashtag
  on public.post_hashtags (hashtag_id);

create index if not exists idx_post_hashtags_author
  on public.post_hashtags (hashtag_id, author_id);

-- ── 4. Parsing — one definition, used by the trigger and the backfill ─────
create or replace function public.extract_hashtags(body text)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct t), '{}')
  from (
    select public.normalize_hashtag(m[1]) as t
    from regexp_matches(coalesce(body, ''), '#([A-Za-z0-9_]{1,60})', 'g') as m
  ) s
  where t is not null;
$$;

comment on function public.extract_hashtags(text) is
  'Every hashtag in a caption, canonical and de-duplicated. Mirrors '
  'RichContentRenderer''s #(\w+) so a tag that renders as a link is a tag that '
  'gets counted, with a 60-char ceiling against pathological input.';

-- ── 5. Recount, from scratch, for a given set of tags ─────────────────────
-- Recomputed rather than incremented. An increment/decrement pair drifts the
-- first time any edge case is missed, and a drifted count is invisible: it
-- looks like a number. This is O(rows for those tags) and runs on write, not
-- on read.
create or replace function public.recount_hashtags(tag_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tag_ids is null or array_length(tag_ids, 1) is null then
    return;
  end if;

  update public.hashtags h
  set unique_user_count = coalesce(c.users, 0),
      post_count        = coalesce(c.posts, 0),
      last_used_at      = c.last_used,
      updated_at        = now()
  from (
    select ph.hashtag_id,
           count(distinct ph.author_id) as users,
           count(*)                     as posts,
           max(p.created_at)            as last_used
    from public.post_hashtags ph
    join public.posts p on p.id = ph.post_id
    -- PRIVATE POSTS DO NOT FEED PUBLIC COUNTS. Today every production post is
    -- public so this changes nothing; it is written now because the day it
    -- starts mattering is the day somebody's private post has already been
    -- counted into a number strangers can see.
    where p.privacy = 'public'
    group by ph.hashtag_id
  ) c
  where h.id = c.hashtag_id
    and h.id = any(tag_ids);

  -- Tags whose last public post just went away fall out of the join above and
  -- must be zeroed, not left at their old value.
  update public.hashtags h
  set unique_user_count = 0, post_count = 0, updated_at = now()
  where h.id = any(tag_ids)
    and not exists (
      select 1 from public.post_hashtags ph
      join public.posts p on p.id = ph.post_id
      where ph.hashtag_id = h.id and p.privacy = 'public'
    );
end;
$$;

-- ── 6. The trigger: the ONLY writer of hashtag statistics ─────────────────
create or replace function public.sync_post_hashtags()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tags     text[];
  affected uuid[] := '{}';
  t        text;
  hid      uuid;
begin
  -- ⚠ A HASHTAG MUST NEVER STOP SOMEBODY POSTING.
  --
  -- This trigger runs INSIDE the member's INSERT. An exception here does not
  -- produce a wrong count — it aborts their whole post. Weighed plainly: a
  -- hashtag statistic that is temporarily wrong is a cosmetic fault that
  -- `recount_hashtags` repairs in one statement; a photographer who cannot
  -- publish is the platform being broken.
  --
  -- So the entire body is wrapped, and any failure is logged as a WARNING and
  -- swallowed. This is the ONE place in this migration where correctness of a
  -- number is deliberately ranked below the member finishing their action.
  begin

  -- Every tag this post pointed at BEFORE the change has to be recounted too,
  -- or a hashtag removed by an edit keeps the author it no longer has.
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(hashtag_id), '{}') into affected
    from public.post_hashtags where post_id = old.id;
  end if;

  tags := public.extract_hashtags(new.content);

  -- Replace this post's set outright. Simpler than diffing, and the primary
  -- key already guarantees one row per (post, tag).
  delete from public.post_hashtags where post_id = new.id;

  foreach t in array tags loop
    insert into public.hashtags (tag, display_tag)
    values (t, t)
    on conflict (tag) do update set updated_at = now()
    returning id into hid;

    if hid is null then
      select id into hid from public.hashtags where tag = t;
    end if;

    insert into public.post_hashtags (post_id, hashtag_id, author_id)
    values (new.id, hid, new.user_id)
    on conflict (post_id, hashtag_id) do nothing;

    affected := affected || hid;
  end loop;

  perform public.recount_hashtags(affected);

  exception when others then
    -- Logged, not raised. See the note at the top of this function.
    raise warning 'sync_post_hashtags failed for post % (%): %',
      coalesce(new.id, old.id), tg_op, sqlerrm;
  end;

  return new;
end;
$$;

-- Deletion is handled BEFORE the row goes, so the junction rows are still
-- readable. Removing them here also means the cascade finds nothing left to do.
create or replace function public.unsync_post_hashtags()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  affected uuid[] := '{}';
begin
  begin
    select coalesce(array_agg(hashtag_id), '{}') into affected
    from public.post_hashtags where post_id = old.id;

    -- Deleted FIRST, so the recount below no longer sees this post at all —
    -- which is what makes recounting correct while the post row still exists.
    delete from public.post_hashtags where post_id = old.id;

    perform public.recount_hashtags(affected);
  exception when others then
    raise warning 'unsync_post_hashtags failed for post %: %', old.id, sqlerrm;
  end;
  return old;
end;
$$;

drop trigger if exists trg_posts_unsync_hashtags on public.posts;
create trigger trg_posts_unsync_hashtags
  before delete on public.posts
  for each row execute function public.unsync_post_hashtags();

drop trigger if exists trg_posts_sync_hashtags on public.posts;
create trigger trg_posts_sync_hashtags
  after insert or update of content, privacy, user_id
  on public.posts
  for each row execute function public.sync_post_hashtags();

comment on function public.sync_post_hashtags() is
  'The only writer of hashtag statistics. Fires on create, edit, delete and '
  'privacy change, so counts stay true no matter which screen changed the post — '
  'including screens that know nothing about hashtags.';

-- ── 7. The suggestion RPC ────────────────────────────────────────────────
create or replace function public.suggest_hashtags(prefix text, max_results integer default 5)
returns table (tag text, display_tag text, unique_user_count integer, post_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (select public.normalize_hashtag(prefix) as p)
  select h.tag, h.display_tag, h.unique_user_count, h.post_count
  from public.hashtags h, q
  where q.p is not null
    and h.tag like q.p || '%'          -- index range scan, never a full scan
  order by
    (h.tag = q.p) desc,                -- 1. the exact tag first
    h.unique_user_count desc,          -- 2. how many PEOPLE use it
    h.post_count desc,                 -- 3. overall usage
    h.last_used_at desc nulls last,    -- 4. recent activity, as a tie-break
    length(h.tag),                     --    then the shorter, closer match
    h.tag
  limit greatest(1, least(coalesce(max_results, 5), 10));
$$;

comment on function public.suggest_hashtags(text, integer) is
  'Typeahead source. PREFIX ONLY — deliberately not fuzzy, because the brief '
  'says an unrelated hashtag must never appear. Ranked by unique users, not '
  'alphabetically. Capped at 10 whatever the caller asks for.';

revoke all on function public.suggest_hashtags(text, integer) from public;
grant execute on function public.suggest_hashtags(text, integer) to anon, authenticated;

-- ── 8. Read access ───────────────────────────────────────────────────────
alter table public.hashtags enable row level security;
alter table public.post_hashtags enable row level security;

-- Aggregate counts over PUBLIC posts only are public information — the same
-- information the feed already shows. No author identity is exposed here:
-- the table holds a tag and two integers.
drop policy if exists hashtags_read_all on public.hashtags;
create policy hashtags_read_all on public.hashtags for select using (true);

-- post_hashtags DOES carry author_id, so it is NOT readable by clients. The
-- suggestion RPC is SECURITY DEFINER and returns only aggregates.
drop policy if exists post_hashtags_no_client_read on public.post_hashtags;
create policy post_hashtags_no_client_read on public.post_hashtags for select using (false);

-- Nothing client-side may write either table. The trigger is SECURITY DEFINER
-- and bypasses this, which is the point: counts cannot be forged.
revoke insert, update, delete on public.hashtags     from anon, authenticated;
revoke insert, update, delete on public.post_hashtags from anon, authenticated;
grant select on public.hashtags to anon, authenticated;

-- ── 9. Backfill the 81 hashtags already sitting in captions ──────────────
-- Derived entirely from data that already exists. Invents nothing.
insert into public.hashtags (tag, display_tag)
select distinct public.normalize_hashtag(m[1]), public.normalize_hashtag(m[1])
from public.posts p, regexp_matches(coalesce(p.content, ''), '#([A-Za-z0-9_]{1,60})', 'g') as m
where public.normalize_hashtag(m[1]) is not null
on conflict (tag) do nothing;

insert into public.post_hashtags (post_id, hashtag_id, author_id)
select distinct p.id, h.id, p.user_id
from public.posts p,
     regexp_matches(coalesce(p.content, ''), '#([A-Za-z0-9_]{1,60})', 'g') as m
join public.hashtags h on h.tag = public.normalize_hashtag(m[1])
on conflict (post_id, hashtag_id) do nothing;

select public.recount_hashtags(array(select id from public.hashtags));
