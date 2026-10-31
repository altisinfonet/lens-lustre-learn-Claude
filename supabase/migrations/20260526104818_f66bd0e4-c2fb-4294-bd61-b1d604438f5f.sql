-- Harden ticket_replies INSERT: non-admins cannot set is_admin = true
DROP POLICY IF EXISTS "Users can reply to own tickets" ON public.ticket_replies;
CREATE POLICY "Users can reply to own tickets"
ON public.ticket_replies
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (is_admin = false OR public.has_role(auth.uid(), 'admin'::public.app_role))
  AND EXISTS (
    SELECT 1 FROM public.support_tickets st
    WHERE st.id = ticket_replies.ticket_id AND st.user_id = auth.uid()
  )
);

-- Revoke anon EXECUTE on 4 admin RPCs (admins call these via authenticated JWT)
REVOKE EXECUTE ON FUNCTION public.admin_flag_entry_for_review FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_rewind_stage FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_search_users FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_photo_rejected FROM anon;