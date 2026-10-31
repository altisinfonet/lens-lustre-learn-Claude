# P1 interface — FROZEN 2026-09-27 by the Auditor — v2 (R-62: §1 privacy rule added). Changes only by the Auditor reopening it in writing.

1. ONLINE DOT = Supabase Realtime Presence (in memory; zero database writes).
   Channel name: "presence:online". Each signed-in client calls track({ u: <auth user id> }) once after SUBSCRIBED.
   Presence key = the user id, so two tabs of one member collapse to one entry.
   Client API (src/lib/presence/online.ts): isOnline(userId: string): boolean, plus the hook useOnline(userId).
   Failure: channel error or disconnect -> isOnline returns false (fail to "not online"). It never throws and never blocks render.
   untrack() and leave on pagehide / visibilitychange-hidden; track again on visible.
   PRIVACY: a client whose own profiles.privacy_settings->>'active_status' = 'off' never calls track(). If the member turns it off mid-session: untrack() immediately. If they turn it on: track(). isOnline() for such a member is therefore always false.

2. LAST SEEN = public.record_session_end(_platform text) RETURNS void
   SECURITY DEFINER, SET search_path = '', EXECUTE: authenticated and service_role only (no anon, no PUBLIC).
   _platform must be 'app' or 'web', else RAISE SQLSTATE 22023. Signed out (auth.uid() IS NULL) -> RETURN, with no error.
   Effect: UPDATE public.profiles SET last_active_at = now(), last_platform = _platform
           WHERE id = auth.uid() AND (last_active_at IS NULL OR last_active_at < now() - interval '60 seconds').
   (That condition is the two-tab rule: it resolves in the database, not by client leader election.)
   Client: called once on pagehide / visibilitychange-hidden, best-effort, never awaited on unload, never retried.

3. CRASH BOUND = public.backfill_last_seen() RETURNS integer (rows touched). pg_cron every 30 minutes.
   EXECUTE: service_role only.
   Sets profiles.last_active_at = max(member_activity_minutes.minute_bucket) for a member only where that max is
   more than 10 minutes newer than the stored value. A session that ends without the signal is therefore at most ~30 min stale.

4. READERS. "Last seen X ago" (formatLastSeen) keeps reading profiles.last_active_at.
   The green dot uses isOnline(userId), never isActiveNow(last_active_at). The admin list shows "Active now" when isOnline.

5. REMOVED. No client code writes profiles.last_active_at or profiles.last_platform. There is no client timer that touches profiles.
