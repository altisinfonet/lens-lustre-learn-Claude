-- FIXTURE · 20261013_0004 · attach detect_duplicate_post() (installed by the
-- runner from 20261011_0002, verbatim) the way production attaches it.
CREATE TRIGGER trg_detect_duplicate_post BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.detect_duplicate_post();
