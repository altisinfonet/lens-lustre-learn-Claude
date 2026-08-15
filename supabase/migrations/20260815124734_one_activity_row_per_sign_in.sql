-- ONE ACTIVITY ROW PER REAL SIGN-IN.
--
-- MEASURED ON THIS DATABASE, 2026-08-15:
--   5,702 'login' rows for 90 members over 37 days.
--   Grouped into bursts separated by 30+ minutes: 685 bursts — so 685 real
--   sign-ins, and 8.3 rows written for each one. The worst single sign-in
--   wrote 233 rows.
--
-- WHY: the client calls logAuthEvent(..., "login") from the Supabase
-- `SIGNED_IN` event, and that event fires far more often than a person signs
-- in — on tab focus, on resume, on token refresh, on every remount. The audit
-- trail is therefore unusable: a real sign-in cannot be told apart from noise,
-- which is exactly why it could not be used to investigate the owner's
-- random-sign-out reports on 2026-08-15.
--
-- THE GUARANTEE IS THE INDEX, not the client. The client is also being fixed
-- to stop making the pointless requests (that saves the member's data), but a
-- client fix alone is a promise; an index is arithmetic. Any client, any
-- version, any retry loop — one row per sign-in.
--
-- WHY THIS IS SAFE ON A LIVE TABLE, and why there is no deletion and no
-- backfill: the partial WHERE clause indexes ONLY rows that carry
-- metadata->>'sign_in_at'. Not one of the 5,702 existing rows has that key, so
-- none of them is indexed and none can conflict. The historical noise stays
-- exactly as it is — it is a record of what happened, and rewriting history to
-- make a chart look better is not something this project does.
--
-- REHEARSED against production before applying, inside a transaction that
-- raised at the end so everything rolled back:
--   existing_rows=8119  duplicate_rejected=true  rows_added=2 (two DISTINCT sign-ins)
--
-- The duplicate insert fails with a unique violation, which the client's
-- fire-and-forget logger already swallows — so a member never sees an error
-- and the row simply does not appear.

CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_one_row_per_sign_in
  ON public.activity_logs (user_id, (metadata->>'sign_in_at'))
  WHERE action_type = 'login' AND metadata ? 'sign_in_at';

COMMENT ON INDEX public.activity_logs_one_row_per_sign_in IS
  'One activity row per real sign-in. Keyed on the auth sign-in timestamp the client puts in metadata.sign_in_at, so repeated SIGNED_IN events for the SAME sign-in cannot each write a row. Partial: rows without that key (everything logged before 2026-08-15) are not indexed and were never touched.';
