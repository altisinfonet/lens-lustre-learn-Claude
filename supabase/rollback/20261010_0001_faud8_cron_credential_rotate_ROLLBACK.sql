-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261010_0001 — F-AUD-8 cron credential rotation
-- Puts every copy 0001 changed back, byte for byte, from vault 'faud8_undo:<name>',
-- restores the record 'faud8_rotation:last' as it was, deletes the undo copies.
-- Only possible BEFORE 20261010_0002 (finalize deletes the way back).
-- USE IT ONLY while the OLD values still work where the edge functions read them
-- (old CRON_SECRET still set / old key not revoked) — otherwise it restores
-- credentials the functions now refuse. Values travel vault → vault only.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires faud8_undo:*.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $restore$
DECLARE
  _r   record;
  _id  uuid;
  _n   int := 0;
  _rec text;
BEGIN
  -- RB-PRE-001 · a rotation is pending (not finalized).
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'faud8_undo:@record') THEN
    RAISE EXCEPTION 'F-AUD-8-0001-RB-PRE-001: no pending rotation (faud8_undo:@record absent) — nothing to roll back, or 20261010_0002 already finalized it'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- RB-PRE-002 · every undo copy names a copy that still exists.
  FOR _r IN SELECT name FROM vault.secrets WHERE name LIKE 'faud8\_undo:%' AND name <> 'faud8_undo:@record' LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = substr(_r.name, 12)) THEN
      RAISE EXCEPTION 'F-AUD-8-0001-RB-PRE-002: % has no copy % to restore — refusing to guess', _r.name, substr(_r.name, 12)
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  FOR _r IN SELECT name, decrypted_secret AS d FROM vault.decrypted_secrets
             WHERE name LIKE 'faud8\_undo:%' AND name <> 'faud8_undo:@record' ORDER BY name LOOP
    SELECT id INTO _id FROM vault.secrets WHERE name = substr(_r.name, 12);
    PERFORM vault.update_secret(_id, _r.d);
    _n := _n + 1;
  END LOOP;

  SELECT decrypted_secret INTO _rec FROM vault.decrypted_secrets WHERE name = 'faud8_undo:@record';
  IF _rec = 'null' THEN
    DELETE FROM vault.secrets WHERE name = 'faud8_rotation:last';
  ELSE
    PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'faud8_rotation:last'), _rec);
  END IF;

  -- RB-POST-001 · byte for byte, then the undo copies go.
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets u JOIN vault.decrypted_secrets c ON c.name = substr(u.name, 12)
              WHERE u.name LIKE 'faud8\_undo:%' AND u.name <> 'faud8_undo:@record'
                AND c.decrypted_secret IS DISTINCT FROM u.decrypted_secret) THEN
    RAISE EXCEPTION 'F-AUD-8-0001-RB-POST-001: a copy differs from its undo copy after the restore' USING ERRCODE = 'raise_exception';
  END IF;
  DELETE FROM vault.secrets WHERE name LIKE 'faud8\_undo:%';
  RAISE NOTICE 'F-AUD-8-0001-RB: % cop(y/ies) restored byte for byte; record restored; undo copies deleted', _n;
END
$restore$;

COMMIT;
