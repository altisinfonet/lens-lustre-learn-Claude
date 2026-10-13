-- FIXTURE · 20261013_0004 · STAGING shape only: the keep 20261013_0001 left on
-- staging (authenticated SELECT on post_media, granted by postgres). Applied on
-- top of 10_production_shape.sql; everything else is identical.
GRANT SELECT ON public.post_media TO authenticated;
