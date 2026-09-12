-- F-98 ROLLBACK — restores the PUBLIC grant, which is the DEFECT.
-- Running this makes clear_custom_url member-callable again and reopens anon
-- execute on all three. It exists for completeness, not because it should be
-- run. If it ever is, F-96's bypass and the Owner's have-none rule are both
-- open again.
GRANT EXECUTE ON FUNCTION public.clear_custom_url()      TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_custom_url(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_username(text)    TO PUBLIC;
