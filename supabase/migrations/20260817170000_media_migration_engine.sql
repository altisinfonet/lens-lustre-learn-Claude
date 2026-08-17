-- ═══════════════════════════════════════════════════════════════════════════
-- MEDIA MIGRATION ENGINE — THE TRANSACTION THE OLD BACKFILL DID NOT HAVE.
--
-- ⚠ NOT APPLIED. Written in Control Cycle 6 as a reviewed artifact only.
--   Production ledger is at 20260817102540 and this is not in it.
--
-- WHY THIS IS SQL AND NOT MORE TYPESCRIPT
-- The abandoned `backfill-media-objects` wrote a post's media through five or
-- six separate PostgREST calls with no transaction around them. Audited
-- 2026-08-17: a post that failed on its third slide left the first two
-- committed and orphaned, and a run that died between the insert and
-- `media_mark_ready` left a row that poisoned that post on EVERY future run,
-- for ever, because `UNIQUE (owner_id, sha256)` then refused a replacement and
-- the code refused to use what was there.
--
-- supabase-js cannot span a transaction. A Postgres function is one. So the
-- unit of work moves into the database: one call, one post, all of its media
-- rows and all of its references, or nothing at all.
--
-- WHAT IT DOES NOT DO
--   • it does not decide WHICH posts to migrate — the manifest does that
--   • it does not fetch or hash anything — the caller has already done that
--     and passes the measurements in
--   • it does not touch posts.image_urls, ever
--   • it weakens no constraint, drops no trigger, and grants nothing to anon
--     or authenticated
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. FENCE DIGEST (READ-ONLY) ────────────────────────────────────────────
-- The migrator must prove the live population IS the approved manifest, not
-- merely the same size. This returns a digest over the sorted key set, built
-- from exactly the shape `keySetText()` builds in manifestPlan.ts:
--     post_id|ord|source_url  (newline joined, sorted, md5)
--
-- md5 rather than sha256 so no extension is required; this is a change-detector
-- between two sets we both hold, not a security primitive. Content identity is
-- still SHA-256 and still lives in media_objects.sha256.
create or replace function public.media_migration_fence_digest(_fence timestamptz)
returns table (key_set_md5 text, item_count integer, post_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cand as (
    select p.id::text as post_id, u.ord::int as ord, u.url
    from public.posts p
    cross join lateral unnest(p.image_urls) with ordinality as u(url, ord)
    where p.image_urls is not null
      and p.privacy = 'public'
      and p.created_at <= _fence
      and u.url ~ '^https://cdn\.50mmretina\.com/post-images/[0-9a-f-]{36}/posts/[^/?]+$'
  )
  select md5(string_agg(post_id||'|'||ord||'|'||url, E'\n' order by post_id||'|'||ord||'|'||url)),
         count(*)::int,
         count(distinct post_id)::int
  from cand;
$$;

revoke all on function public.media_migration_fence_digest(timestamptz) from public;
revoke all on function public.media_migration_fence_digest(timestamptz) from anon;
revoke all on function public.media_migration_fence_digest(timestamptz) from authenticated;

comment on function public.media_migration_fence_digest(timestamptz) is
  'Read-only. Digest over the fenced candidate key set so a migration can prove '
  'it is operating on the approved SET, not merely on the approved COUNT.';


-- ── 2. MIGRATE ONE POST — ALL OF IT, OR NONE OF IT ────────────────────────
-- `_items` is a jsonb array, already verified against the manifest by the
-- caller, each element:
--   { "ord": 1, "sha256": "<64 hex>", "width": 1, "height": 1,
--     "bytes": 1, "mime": "image/webp", "visibility": "public",
--     "object_path": "post-images/<owner>/posts/<file>" }
--
-- `_owner_id` is passed separately and every item is checked against it, so a
-- caller cannot mix owners inside one post.
--
-- IDEMPOTENT: a post that already has references returns 'skipped' and writes
-- nothing. Safe to call again after any failure.
--
-- SELF-REPAIRING: an existing media row for the same (owner, sha256) that is
-- stuck in 'pending' or 'verified' is driven forward here rather than throwing
-- for ever. That is the permanent dead end from the old migrator, closed.
create or replace function public.media_migrate_post(
  _post_id uuid,
  _owner_id uuid,
  _items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _item jsonb;
  _sha bytea;
  _mid uuid;
  _state text;
  _created int := 0;
  _reused  int := 0;
  _repaired int := 0;
  _refs int := 0;
  _ids uuid[] := '{}';
  _actual_owner uuid;
  _live_slides int;
  _existing int;
  _matched int;
begin
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'MIG-2001 _items must be a non-empty array' using errcode = '22023';
  end if;

  -- The post must exist, and the owner the caller claims must be its real
  -- author. Never take the caller's word for whose photograph this is.
  select user_id, coalesce(cardinality(image_urls), 0) into _actual_owner, _live_slides
  from public.posts where id = _post_id;
  if not found then
    raise exception 'MIG-2002 post % does not exist', _post_id using errcode = '23503';
  end if;
  if _actual_owner is distinct from _owner_id then
    raise exception 'MIG-2003 post % belongs to %, not %', _post_id, _actual_owner, _owner_id
      using errcode = '23514';
  end if;

  -- ── ALREADY DONE? PROVE IT. ────────────────────────────────────────────
  -- ⚠ This block replaces a bare `if exists (…) then return 'skipped'`.
  -- Audited 2026-08-17 (Cycle 7): existence alone checked NOTHING — not ord,
  -- not owner, not sha256, not dimensions, not mime, not readiness. This
  -- function is all-or-nothing so IT cannot leave a partial set, but the check
  -- does not know who wrote the rows: `post_publish_with_media` (which
  -- `authenticated` may execute), the abandoned backfill, or a manual repair
  -- all produce references this would have accepted unseen.
  --
  -- So: a post that already has references is compared, row for row, against
  -- the items supplied. Three outcomes and no fourth — verified-skip, or
  -- refuse. Never a silent skip.
  select count(*) into _existing from public.post_media where post_id = _post_id;
  if _existing > 0 then
    if _existing <> jsonb_array_length(_items) then
      raise exception 'MIG-2020 post % has % references, manifest has % — refusing to skip',
        _post_id, _existing, jsonb_array_length(_items) using errcode = '23514';
    end if;
    -- Every existing reference must match the manifest item at that position:
    -- content hash, dimensions, size, mime, owner, and readiness.
    select count(*) into _matched
    from public.post_media pm
    join public.media_objects mo on mo.id = pm.media_id
    join lateral (
      select (e->>'ord')::int - 1            as ord0,
             decode(e->>'sha256','hex')      as sha,
             (e->>'width')::int              as w,
             (e->>'height')::int             as h,
             (e->>'bytes')::bigint           as b,
             e->>'mime'                      as m
      from jsonb_array_elements(_items) e
    ) it on it.ord0 = pm.ord
    where pm.post_id = _post_id
      and mo.sha256 = it.sha and mo.width = it.w and mo.height = it.h
      and mo.bytes = it.b and mo.mime = it.m
      and mo.owner_id = _owner_id and mo.state = 'ready';

    if _matched <> _existing then
      raise exception 'MIG-2021 post % has % references but only % match the manifest — refusing to skip',
        _post_id, _existing, _matched using errcode = '23514';
    end if;
    -- Proven equal. A different word from 'skipped', deliberately.
    return jsonb_build_object('post_id', _post_id, 'result', 'verified-skip',
                              'references', _existing, 'invariants_checked',
                              jsonb_build_array('count','ord','sha256','width','height',
                                                'bytes','mime','owner_id','state'));
  end if;

  -- Whole post or nothing: the number of items must equal the number of
  -- photographs the post actually carries.
  if jsonb_array_length(_items) <> _live_slides then
    raise exception 'MIG-2004 post % has % slides, % items supplied',
      _post_id, _live_slides, jsonb_array_length(_items) using errcode = '23514';
  end if;

  for _item in select * from jsonb_array_elements(_items) loop
    if length(_item->>'sha256') <> 64 or (_item->>'sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'MIG-2005 sha256 must be 64 lowercase hex characters' using errcode = '22023';
    end if;
    -- The object path must belong to the owner. Cycle 5A found three rows in
    -- the OLD migrator's population where it did not.
    if split_part(_item->>'object_path', '/', 2) <> _owner_id::text then
      raise exception 'MIG-2006 object_path % is not in owner %s folder', _item->>'object_path', _owner_id
        using errcode = '23514';
    end if;
    _sha := decode(_item->>'sha256', 'hex');

    select id, state into _mid, _state
    from public.media_objects where owner_id = _owner_id and sha256 = _sha;

    if _mid is null then
      insert into public.media_objects (owner_id, sha256, width, height, bytes, mime, visibility)
      values (_owner_id, _sha,
              (_item->>'width')::int, (_item->>'height')::int, (_item->>'bytes')::bigint,
              _item->>'mime', _item->>'visibility')
      returning id, state into _mid, _state;
      _created := _created + 1;
    else
      -- Content identity already exists. Reuse it — but never reuse something
      -- quarantined, and never silently accept a row whose recorded shape
      -- disagrees with the bytes we just verified.
      if _state = 'quarantined' then
        raise exception 'MIG-2007 media % for this content is quarantined', _mid using errcode = '23514';
      end if;
      if exists (
        select 1 from public.media_objects
        where id = _mid
          and (width <> (_item->>'width')::int
            or height <> (_item->>'height')::int
            or bytes <> (_item->>'bytes')::bigint
            or mime <> _item->>'mime')
      ) then
        raise exception 'MIG-2008 existing media % disagrees with the verified bytes', _mid
          using errcode = '23514';
      end if;
      if _state = 'ready' then
        _reused := _reused + 1;
      else
        _repaired := _repaired + 1;   -- stuck pending/verified: drive it forward
      end if;
    end if;

    -- Walk the state machine. The trigger refuses pending -> ready, so this
    -- proves the bytes were looked at rather than asserting it.
    if _state = 'pending' then
      update public.media_objects set state = 'verified', verified_at = now() where id = _mid;
      _state := 'verified';
    end if;
    if _state = 'verified' then
      update public.media_objects
      set state = 'ready',
          derivatives = jsonb_build_object('original', _item->>'object_path')
      where id = _mid;
    end if;

    _ids := _ids || _mid;
  end loop;

  -- References, in the manifest's own order, contiguous from 0 because
  -- post_media.ord is 0-based while the manifest's ord is 1-based.
  insert into public.post_media (post_id, ord, media_id)
  select _post_id, (i.idx - 1), i.mid
  from (
    select row_number() over (order by (e->>'ord')::int) as idx,
           _ids[row_number() over (order by (e->>'ord')::int)] as mid
    from jsonb_array_elements(_items) e
  ) i;
  get diagnostics _refs = row_count;

  -- Post-write verification INSIDE the transaction, so a mismatch rolls the
  -- whole post back instead of being reported after the fact.
  if _refs <> jsonb_array_length(_items) then
    raise exception 'MIG-2009 wrote % references, expected %', _refs, jsonb_array_length(_items)
      using errcode = '23514';
  end if;
  if (select count(*) from public.post_media where post_id = _post_id) <> _refs then
    raise exception 'MIG-2010 verification read-back disagrees for post %', _post_id using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_media pm
    join public.media_objects mo on mo.id = pm.media_id
    where pm.post_id = _post_id and (mo.state <> 'ready' or mo.owner_id <> _owner_id)
  ) then
    raise exception 'MIG-2011 a reference on post % points at media that is not ready or not owned', _post_id
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'post_id', _post_id, 'result', 'migrated',
    'media_created', _created, 'media_reused', _reused,
    'media_repaired', _repaired, 'references', _refs);
end;
$$;

revoke all on function public.media_migrate_post(uuid, uuid, jsonb) from public;
revoke all on function public.media_migrate_post(uuid, uuid, jsonb) from anon;
revoke all on function public.media_migrate_post(uuid, uuid, jsonb) from authenticated;

comment on function public.media_migrate_post(uuid, uuid, jsonb) is
  'One post, one transaction: all of its media_objects rows and all of its '
  'post_media references, or none. Idempotent; repairs a media row stuck below '
  'ready. Never touches posts.image_urls. service_role only.';


-- ── 3. RECONCILIATION (READ-ONLY) ─────────────────────────────────────────
create or replace function public.media_migration_reconcile()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'post_media_rows',        (select count(*) from public.post_media),
    'media_objects_rows',     (select count(*) from public.media_objects),
    'unreferenced_media',     (select count(*) from public.media_objects mo
                               where not exists (select 1 from public.post_media pm where pm.media_id = mo.id)),
    'non_ready_media',        (select count(*) from public.media_objects where state <> 'ready'),
    'refs_to_non_ready',      (select count(*) from public.post_media pm
                               join public.media_objects mo on mo.id = pm.media_id where mo.state <> 'ready'),
    'refs_with_owner_mismatch',(select count(*) from public.post_media pm
                               join public.media_objects mo on mo.id = pm.media_id
                               join public.posts p on p.id = pm.post_id
                               where mo.owner_id <> p.user_id),
    'posts_with_gapped_ords', (select count(*) from (
                                 select post_id from public.post_media
                                 group by post_id having max(ord) <> count(*) - 1) g),
    -- ⚠ COUNT EQUALITY MUST NOT BE ABLE TO PRODUCE A PASS.
    -- Audited 2026-08-17 (Cycle 7): the previous reconciliation compared
    -- totals only, so a post carrying the right NUMBER of references pointing
    -- at the WRONG media reconciled clean. This digest is over the actual
    -- (post, position, content) triples, so the end state must be the manifest
    -- itself and not merely the same size as it.
    'ref_set_md5', (select md5(string_agg(k, E'\n' order by k)) from (
                      select pm.post_id::text||'|'||pm.ord::text||'|'||encode(mo.sha256,'hex') as k
                      from public.post_media pm
                      join public.media_objects mo on mo.id = pm.media_id) t)
  );
$$;

revoke all on function public.media_migration_reconcile() from public;
revoke all on function public.media_migration_reconcile() from anon;
revoke all on function public.media_migration_reconcile() from authenticated;

comment on function public.media_migration_reconcile() is
  'Read-only end-state check for the media migration. service_role only.';

-- ── NOT GRANTED TO ANY CLIENT ROLE ────────────────────────────────────────
-- `anon` and `authenticated` have no privilege on media_objects or post_media
-- and gain none here. The client switch will need its own reviewed grant; that
-- is a separate decision and must be column-scoped so sha256 stays server-side.
