-- ============================================================================
-- ANYONE MAY TAG ANYONE. CONSENT MOVES; IT DOES NOT DISAPPEAR.
--
-- Owner decision, 2026-08-10: *"anyone tag anyone. not block it by ONLY
-- friends"*.
--
-- WHAT WAS ENFORCING IT: not a policy — a trigger. `validate_post_tag_insert`
-- (20260418111925) called `are_friends()` and raised
--
--     'You can only tag accepted friends'
--
-- so every tag of a non-friend was refused by the DATABASE, whatever the UI
-- offered. Changing only the picker would have produced a modal full of people
-- and an error on every one of them.
--
-- WHY THIS IS SAFE — the consent step is untouched and is the real protection:
--   * a new tag is inserted `status = 'pending'` (column default);
--   * RLS "Anyone views approved tags" restricts SELECT on anything not
--     approved to the tagger, the tagged member, and the post owner. So a
--     pending tag is invisible to everyone else;
--   * only the tagged member can move it to 'approved'
--     (validate_post_tag_update refuses any other writer, and refuses any
--     change other than status);
--   * once they decline, the tagger can NEVER re-tag them on that post — that
--     check is kept below, and it is the anti-harassment rule;
--   * `post_tags_no_self_tag` still forbids tagging yourself;
--   * 20 tags per post maximum, still enforced below.
--
-- So this widens who may ASK to tag you. It does not change who can make a tag
-- APPEAR. Nobody's name is attached to a photo without them pressing approve.
--
-- WHAT IS DELIBERATELY NOT CHANGED: every other rule in the trigger, and every
-- RLS policy on the table. This edits exactly one branch.
--
-- REVERSAL — restore the friend gate by re-adding, before the declined check:
--   DECLARE _is_friend boolean; ...
--   SELECT public.are_friends(NEW.tagger_id, NEW.tagged_user_id) INTO _is_friend;
--   IF NOT _is_friend THEN
--     RAISE EXCEPTION 'You can only tag accepted friends';
--   END IF;
-- `public.are_friends()` is left in place and is still used elsewhere, so a
-- reversal needs no other object recreated.
--
-- Migrations do NOT auto-apply on this project. This file is the record; the
-- statements were run by hand in the Supabase SQL editor.
-- ============================================================================

begin;

create or replace function public.validate_post_tag_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _tag_count integer;
  _was_declined boolean;
begin
  -- You may only create tags in your own name.
  if new.tagger_id <> auth.uid() then
    raise exception 'You can only create tags as yourself';
  end if;

  -- Cap per post (mirrors MAX_TAGS in src/components/post/TagPeopleModal.tsx).
  select count(*) into _tag_count
  from public.post_tags
  where post_id = new.post_id
    and status in ('pending', 'approved');

  if _tag_count >= 20 then
    raise exception 'Maximum of 20 tags per post reached';
  end if;

  -- REMOVED 2026-08-10 (owner decision): the are_friends() gate. See header.
  -- Consent is the pending -> approved step, not a prior friendship.

  -- A decline is permanent for this post. This is the anti-harassment rule and
  -- it matters MORE now that any member may tag any other, not less.
  select exists (
    select 1 from public.post_tags
    where post_id = new.post_id
      and tagger_id = new.tagger_id
      and tagged_user_id = new.tagged_user_id
      and status = 'declined'
  ) into _was_declined;

  if _was_declined then
    raise exception 'This user previously declined your tag on this post';
  end if;

  return new;
end;
$$;

comment on function public.validate_post_tag_insert() is
  'Guards post_tags inserts: tag as yourself only, 20 per post, and never after a decline. Friendship is NOT required (owner decision 2026-08-10). Consent is the tagged member approving a pending tag.';

-- The INSERT policy was named for a rule it never enforced: its body is only
-- `auth.uid() = tagger_id`. The friend check lived in the trigger above. Renamed
-- so the next reader is not misled into thinking friendship is checked here.
drop policy if exists "Friends create tags as themselves" on public.post_tags;
drop policy if exists "Members create tags as themselves" on public.post_tags;
create policy "Members create tags as themselves"
  on public.post_tags for insert
  with check (auth.uid() = tagger_id);

commit;
