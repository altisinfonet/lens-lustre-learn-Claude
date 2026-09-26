# Phase 2 kickoff — Stop the machine talking to itself (P1, P2, P10)
Opened 2026-09-27 by the Auditor after Phase 1 closed (R-60).
Migration block: 20260920_0001 – 20260920_0099.
Object reservation (2-D1-01): public.profiles (last_active_at, last_platform), public.scheduled_posts,
public.competition_round_publish, publication supabase_realtime, public.member_activity_minutes (read-only use),
public.profiles_public_data (written by trigger on every profiles update),
new: public.record_session_end(text), public.backfill_last_seen().
Seven-day rule — PROMOTION CONDITION: P-2 is not promoted until docs/evidence/d1/phase2/profiles-deadrows-7day.md
holds seven consecutive dated readings, all < 10 %, each confirmed by the Auditor's own SELECT. Any reading >= 10 %
restarts the window. The window is real elapsed time and is never shortened. Phase 3 work may start during it; P-2 may not.
Staging note: staging's supabase_realtime publication is empty (0 tables), so no realtime feature works on staging today — Phase 3 item.
A-2 converts competition_round_publish only (R-62); profiles and scheduled_posts keep FULL with written justifications.
