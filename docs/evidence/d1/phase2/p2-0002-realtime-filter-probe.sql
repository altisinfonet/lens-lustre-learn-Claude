-- P2 · 0002 · F-P2-1 probe. READ-ONLY: one SELECT of a STABLE function with
-- synthetic arguments. Touches no table, no subscription, no slot.
-- Asks Realtime's own filter function whether a DELETE would be delivered to a
-- filtered subscriber, given the old-row image each replica identity produces.
-- Ran on staging (fpszggreishhuvdpkmdr) 2026-09-26; safe to run on production.
WITH f AS (SELECT
  ARRAY[('user_id','eq','11111111-1111-1111-1111-111111111111',false)::realtime.user_defined_filter] AS sp_filter,
  ARRAY[('competition_id','eq','22222222-2222-2222-2222-222222222222',false)::realtime.user_defined_filter] AS crp_filter),
c AS (SELECT
  ARRAY[('id','uuid','2950'::oid,'"33333333-3333-3333-3333-333333333333"'::jsonb,true,true)::realtime.wal_column] AS sp_identity_default,
  ARRAY[('id','uuid','2950'::oid,'"33333333-3333-3333-3333-333333333333"'::jsonb,true,true)::realtime.wal_column,
        ('user_id','uuid','2950'::oid,'"11111111-1111-1111-1111-111111111111"'::jsonb,false,true)::realtime.wal_column] AS sp_identity_full,
  ARRAY[('competition_id','uuid','2950'::oid,'"22222222-2222-2222-2222-222222222222"'::jsonb,true,true)::realtime.wal_column,
        ('round_number','int4','23'::oid,'2'::jsonb,true,true)::realtime.wal_column] AS crp_identity_default)
SELECT 'scheduled_posts DELETE, filter user_id, FULL'      AS case_, realtime.is_visible_through_filters(sp_identity_full, sp_filter)     AS delivered FROM c, f
UNION ALL SELECT 'scheduled_posts DELETE, filter user_id, DEFAULT',        realtime.is_visible_through_filters(sp_identity_default, sp_filter) FROM c, f
UNION ALL SELECT 'competition_round_publish DELETE, filter competition_id, DEFAULT', realtime.is_visible_through_filters(crp_identity_default, crp_filter) FROM c, f
UNION ALL SELECT 'competition_round_publish DELETE, no filter, DEFAULT',   realtime.is_visible_through_filters(crp_identity_default, NULL) FROM c;
-- Staging, 2026-09-26: true / false / true / true.
