-- ═══════════════════════════════════════════════════════════════════════════
-- DELETING A CERTIFICATE MUST DELETE WHAT STILL POINTS AT IT.
--
-- ── The gap, measured, not assumed ─────────────────────────────────────────
--
-- On 2026-08-25 a probe certificate was deleted on staging through the exact
-- path the admin screen uses (role `authenticated`, admin's `sub` in the JWT).
-- Every surface that could still know about it was then checked:
--
--   row in certificates ........................ gone
--   verify_certificate('CERT-515778DBFB') ...... 0   not verifiable  ✅
--   verify_certificate_by_token(<token>) ....... 0   not verifiable  ✅
--   certificate_testimonials ................... 0   FK cascades     ✅
--   token / certificate_id anywhere ............ 0                   ✅
--   user_notifications.reference_id ............ 1   ORPHAN          ❌
--
-- `certificates` is referenced by exactly one FK — certificate_testimonials,
-- ON DELETE CASCADE — and by one column with NO foreign key at all:
-- `user_notifications.reference_id`. Nothing cleans that up, so the member
-- keeps a notification reading
--
--     "New Certificate!  You've earned: <title> 🎓"
--
-- for a certificate that no longer exists. Tapping it goes nowhere.
--
-- Every other loose reference column in the schema was measured against
-- `certificates` and every one of them holds ZERO certificate ids:
-- admin_notifications.reference_id, held_result_notifications.entity_id,
-- held_result_notifications.in_app_reference_id, notification_emit_log.entity_id,
-- certificates.reference_id. `user_notifications` is the only leak.
--
-- Already present before this migration:  staging 3 orphans, PRODUCTION 1.
-- Those historical rows are NOT touched here — see the note at the bottom.
--
-- ── Why a trigger and not a line in the admin screen ───────────────────────
--
-- The admin button is one delete path. A certificate can also be removed by
-- SQL, by a future cascade, by a support script. A trigger covers all of them,
-- and it cannot be forgotten by the next person who writes a delete.
--
-- ── Why SECURITY DEFINER ──────────────────────────────────────────────────
--
-- `user_notifications` carries  "Users can delete own notifications"  USING
-- (auth.uid() = user_id). An admin deleting ANOTHER member's certificate is
-- not that member, so under the caller's own rights the cleanup would silently
-- delete nothing — the exact class of failure this whole change is about.
-- SECURITY DEFINER is what makes the cleanup actually happen, with a pinned
-- search_path and a body that can only ever delete rows keyed to OLD.id.
--
-- ── Why BEFORE DELETE ─────────────────────────────────────────────────────
--
-- BEFORE, so there is never an instant in which the certificate is gone and
-- the notification still points at it. If the cleanup fails, the whole delete
-- fails and the admin is told — nothing half-succeeds.
--
-- ── Why by reference_id alone, not by type ────────────────────────────────
--
-- Measured on staging: every notification currently pointing at a certificate
-- is type 'certificate_issued'. Keying the delete on reference_id alone also
-- covers any future type (a revocation notice, say) without needing this
-- trigger edited again. A uuid identifies one row in one table; a notification
-- whose reference_id IS this certificate is about this certificate.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cleanup_certificate_references()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only rows keyed to the certificate being deleted. There is no branch here
  -- and no dynamic SQL: this statement cannot touch anything else.
  delete from public.user_notifications
   where reference_id = OLD.id;

  return OLD;
end;
$function$;

revoke all on function public.cleanup_certificate_references() from public;
revoke all on function public.cleanup_certificate_references() from anon;
revoke all on function public.cleanup_certificate_references() from authenticated;

drop trigger if exists trg_cleanup_certificate_references on public.certificates;

create trigger trg_cleanup_certificate_references
  before delete on public.certificates
  for each row
  execute function public.cleanup_certificate_references();

-- ── The historical orphans are deliberately NOT deleted here ───────────────
--
-- staging 3, production 1 as measured on 2026-08-25. Removing them is a
-- change to members' existing notification lists, which is a separate
-- decision with a separate blast radius, and it does not belong inside a
-- schema migration that is otherwise pure structure. The query that finds
-- them, for when that decision is made:
--
--   select n.id, n.user_id, n.title, n.created_at
--   from public.user_notifications n
--   where not exists (select 1 from public.certificates c where c.id = n.reference_id)
--     and n.type = 'certificate_issued';
