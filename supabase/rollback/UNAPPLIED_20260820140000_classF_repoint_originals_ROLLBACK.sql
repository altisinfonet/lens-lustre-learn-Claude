-- ROLLBACK for UNAPPLIED_20260820140000_classF_repoint_originals.sql
--
-- EXACT, not reconstructed. The forward repair captured each post's whole
-- image_urls array BEFORE touching it, so this restores the bytes that were
-- there rather than re-deriving them from a rule.
--
-- Safe to run more than once: the second run finds the arrays already equal and
-- changes nothing.

begin;

update public.posts p
set image_urls = a.image_urls_before,
    image_url  = a.image_urls_before[1]
from public.media_repair_audit a
where a.post_id = p.id
  and a.repair = 'classF_repoint_originals'
  and p.image_urls is distinct from a.image_urls_before;

do $$
declare _left int;
begin
  select count(*) into _left
    from public.media_repair_audit a
    join public.posts p on p.id = a.post_id
   where a.repair='classF_repoint_originals'
     and p.image_urls is distinct from a.image_urls_before;
  if _left > 0 then
    raise exception 'ROLLBACK-001: % posts did not revert', _left;
  end if;
end $$;

commit;

-- The audit rows are KEPT. They are the record that the repair happened and was
-- undone; deleting them would erase the only evidence of both.
