-- F-93 · unit 5 of 5 — give a URL to every profile that has none.
--
-- ORDER IS LOAD-BEARING: this runs AFTER unit 3 unlocks the column. Never
-- assign into a locked column — under the old trigger these rows would have
-- received a URL they could then never change.
--
-- ⚠ app.allow_custom_url_update IS SET **LOCAL**.
-- prevent_direct_custom_url_update() refuses any direct write unless that
-- setting is 'true'. It must be scoped to this transaction: a session-level
-- setting is exactly the mechanism F-78 disproved on the Supabase session
-- pooler, where a connection is not the same thing as a session. set_config's
-- third argument true = transaction-local.
--
-- custom_url_changed_at is deliberately NOT stamped. These members did not
-- choose these names; they must not lose their 12-month change to them. This
-- is the single most likely thing to get wrong here, so the probe tests it
-- directly: backfill a row, then immediately change it, and require success.

DO $backfill$
DECLARE
  _before  int;
  _after   int;
  _done    int := 0;
  _r       record;
  _url     text;
BEGIN
  PERFORM set_config('app.allow_custom_url_update', 'true', true);

  SELECT count(*) INTO _before FROM public.profiles WHERE custom_url IS NULL;
  RAISE NOTICE 'F-93 backfill: % profiles without a custom_url', _before;

  FOR _r IN
    SELECT id, full_name FROM public.profiles WHERE custom_url IS NULL ORDER BY created_at, id
  LOOP
    _url := public.generate_custom_url(_r.full_name, _r.id);

    UPDATE public.profiles SET custom_url = _url WHERE id = _r.id;

    -- The AFTER INSERT history trigger does not fire for an UPDATE, so the
    -- history row is written here. Without it resolve_custom_url() — which
    -- reads history, not profiles — would not find these members at all.
    INSERT INTO public.custom_url_history (user_id, custom_url, is_current)
    VALUES (_r.id, _url, true)
    ON CONFLICT DO NOTHING;

    _done := _done + 1;
  END LOOP;

  SELECT count(*) INTO _after FROM public.profiles WHERE custom_url IS NULL;

  IF _after <> 0 THEN
    RAISE EXCEPTION
      'F-93 backfill FAILED — % profiles still have no custom_url after assigning %. The acceptance criterion is zero.',
      _after, _done;
  END IF;

  RAISE NOTICE 'F-93 backfill: assigned %, remaining without a URL: %', _done, _after;
END
$backfill$;
