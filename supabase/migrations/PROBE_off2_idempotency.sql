-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · OFF-2 · exactly once — the LIVE half. READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--
-- The list below is scripts/db-off2-outbox-contract.json (the build check fails
-- if a contract table is missing here). For each outbox action table:
--   key          the column idempotency_key exists; a VALID unique index on
--                exactly (<owner>, idempotency_key) exists under its name —
--                full (no predicate) unless the contract says partial; and no
--                (owner, key) pair repeats;
--   natural      a VALID unique index covers exactly the natural columns
--                (friendships: the least/greatest pair index counts);
--   update-only  the table exists (the action is an UPDATE to a fixed value).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  r     record;
  hits  text := '';
  ok    text := '';
  n     bigint;
  rel   regclass;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('posts',              'key',         'user_id',     'posts_user_idempotency_key',          true,  NULL::text[]),
      ('post_comments',      'key',         'user_id',     'post_comments_user_idempotency_key',  false, NULL),
      ('reports',            'key',         'reporter_id', 'reports_reporter_idempotency_key',    false, NULL),
      ('post_reactions',     'natural',     NULL,          NULL,                                  NULL,  ARRAY['post_id', 'user_id']),
      ('comment_reactions',  'natural',     NULL,          NULL,                                  NULL,  ARRAY['comment_id', 'user_id']),
      ('follows',            'natural',     NULL,          NULL,                                  NULL,  ARRAY['follower_id', 'following_id']),
      ('friendships',        'natural',     NULL,          NULL,                                  NULL,  ARRAY['requester_id', 'addressee_id']),
      ('post_reports',       'natural',     NULL,          NULL,                                  NULL,  ARRAY['post_id', 'reporter_id']),
      ('user_notifications', 'update-only', NULL,          NULL,                                  NULL,  NULL)
    ) AS c(tbl, kind, owner, uniq, partial, cols)
  LOOP
    rel := to_regclass('public.' || r.tbl);
    IF rel IS NULL THEN hits := hits || E'\n  ' || r.tbl || ': table missing'; CONTINUE; END IF;
    IF r.kind = 'key' THEN
      IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = rel AND attname = 'idempotency_key' AND NOT attisdropped) THEN
        hits := hits || E'\n  ' || r.tbl || ': no idempotency_key column'; CONTINUE;
      END IF;
      IF NOT EXISTS (
          SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
           WHERE i.indrelid = rel AND ic.relname = r.uniq AND i.indisunique AND i.indisvalid AND i.indisready
             AND i.indnkeyatts = 2 AND i.indexprs IS NULL
             AND (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = rel AND a.attnum = k.attnum) = ARRAY[r.owner, 'idempotency_key']::name[]
             AND ((i.indpred IS NULL) OR r.partial)) THEN
        hits := hits || E'\n  ' || r.tbl || ': no valid UNIQUE ' || r.uniq || ' on (' || r.owner || ', idempotency_key)'
                || CASE WHEN r.partial THEN '' ELSE ' without a predicate' END;
        CONTINUE;
      END IF;
      EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE idempotency_key IS NOT NULL GROUP BY %I, idempotency_key HAVING count(*) > 1) d',
                     r.tbl, r.owner) INTO n;
      IF n > 0 THEN hits := hits || E'\n  ' || r.tbl || ': ' || n || ' repeated (owner, key) pair(s)'; CONTINUE; END IF;
      ok := ok || ' ' || r.tbl || '[key]';
    ELSIF r.kind = 'natural' THEN
      IF NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid = rel AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
             AND (
               (i.indexprs IS NULL AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey) k(attnum)
                                          JOIN pg_attribute a ON a.attrelid = rel AND a.attnum = k.attnum)
                                       = (SELECT array_agg(x ORDER BY x) FROM unnest(r.cols) x))
               OR (i.indexprs IS NOT NULL AND pg_get_indexdef(i.indexrelid) ~* ('LEAST\(' || r.cols[1] || ', ' || r.cols[2] || '\).*GREATEST\(' || r.cols[1] || ', ' || r.cols[2] || '\)'))
             )) THEN
        hits := hits || E'\n  ' || r.tbl || ': no valid UNIQUE on exactly (' || array_to_string(r.cols, ', ') || ')';
        CONTINUE;
      END IF;
      ok := ok || ' ' || r.tbl || '[natural]';
    ELSE
      ok := ok || ' ' || r.tbl || '[update-only]';
    END IF;
  END LOOP;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL OFF-2: a repeated outbox send can create a second row:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS OFF-2: every outbox action table refuses a repeat:%', ok;
END
$probe$;
ROLLBACK;
