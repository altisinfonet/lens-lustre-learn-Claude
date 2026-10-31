#!/usr/bin/env python3
"""U4 · neutralise the one rollback that exists only on `main`.

`supabase/rollback/UNAPPLIED_20260910_0023_f105de_referral_reward_production_close_ROLLBACK.sql`
never existed on staging, so the staging-side corrections (Units A, B and C)
never reached it. It carries TWO executable `GRANT ... TO PUBLIC` statements on
`process_referral_reward`, and promoting staging to main without touching it
would carry the R-11 hazard onto the lane that serves production.

The mechanism is R-26's, unchanged from Unit C, and the reason it is a
neutralisation rather than a rename is R-24: the `UNAPPLIED_` prefix is NOT a
dispatch control. apply-migration.yml's allowlist is a glob on directory and
extension, so every .sql file under supabase/rollback matches it, prefix or no
prefix. The workflow reads no filename and no comment -- it hands the file to
psql. Withdrawal by rename leaves the SQL one typed path away from running.

Reversible by construction, and proven so rather than asserted: strip the guard
block, strip exactly three characters from the start of every remaining line,
and the sha256 of the result must equal the sha256 recorded IN the guard block.
This script performs that check on its own output before writing anything.

    python3 docs/evidence/d1/phase1/p1-promote-neutralise-0023.py [--check]
"""
import io, os, sys, hashlib
sys.dont_write_bytecode = True

TARGET = 'supabase/rollback/UNAPPLIED_20260910_0023_f105de_referral_reward_production_close_ROLLBACK.sql'
REPL   = 'supabase/rollback/20260910_0024_f105de_referral_reward_production_close_ROLLBACK.sql'

BLOCK = """-- ===========================================================================
-- WITHDRAWN under Auditor rulings R-24 / R-26, carried onto `main` by the
-- P-1 promotion of 2026-09-25. NEUTRALISED, not merely renamed.
--
-- This file exists ONLY on `main`. The staging-side corrections (Units A, B
-- and C) never reached it, so it still carries TWO executable
-- `GRANT ... TO PUBLIC` statements on public.process_referral_reward.
--
-- The UNAPPLIED_ prefix is NOT a dispatch control. apply-migration.yml's
-- allowlist is a glob on directory and extension: every .sql file under
-- supabase/migrations and supabase/rollback matches it, this one included.
-- The workflow reads no filename prefix and no comment -- it cats the file
-- into psql. Withdrawal by rename alone left this SQL one typed path away
-- from running, on the lane that serves production.
--
-- Every line of the original body below carries a leading "-- ". The body is
-- therefore inert on its own terms, and recoverable byte for byte:
--
--   strip this block, then strip exactly three characters from the start of
--   every remaining line, and the result is the original file.
--
--   sha256 of the original, before neutralisation (newline-preserving):
--     {sha}
--
-- The hash is carried here rather than in a separate evidence file so that the
-- record travels with the file.
--
-- Replacement: {repl}
-- ===========================================================================
DO $withdrawn$ BEGIN
  RAISE EXCEPTION
    'WITHDRAWN under Auditor rulings R-24/R-26, P-1 promotion 2026-09-25. This file is the '
    'historical record of SQL that must not run: it granted EXECUTE to PUBLIC. Its body is '
    'preserved below, commented. Replacement: %.', '{repl}'
  USING ERRCODE = 'raise_exception';
END $withdrawn$;
"""

def neutralise(raw: str, sha: str) -> str:
    block = BLOCK.replace('{sha}', sha).replace('{repl}', REPL)
    assert '/*' not in block and '*/' not in block, 'the guard block must contain no block comment'
    # newline-preserving: split on \n and keep the trailing element, so a file
    # ending without a newline round-trips as itself.
    lines = raw.split('\n')
    return block + '\n'.join('-- ' + l for l in lines)

def recover(neutralised: str) -> str:
    body = neutralised.split('-- ===========================================================================\n', 2)[-1]
    body = body.split("END $withdrawn$;\n", 1)[1]
    return '\n'.join(l[3:] for l in body.split('\n'))

def main():
    check_only = '--check' in sys.argv
    raw = io.open(TARGET, encoding='utf-8', newline='').read()
    before = hashlib.sha256(raw.encode('utf-8')).hexdigest()

    if raw.lstrip().startswith('-- ====') and 'WITHDRAWN under Auditor rulings R-24 / R-26' in raw[:3000]:
        print(f"  already neutralised: {TARGET}")
        rec = recover(raw)
        got = hashlib.sha256(rec.encode('utf-8')).hexdigest()
        want = [l.strip() for l in raw.split('\n') if l.strip().startswith('--     ') and len(l.strip()) == 71]
        want = want[0][7:] if want else '(not found)'
        ok = got == want
        print(f"  strip-and-rehash : {got}")
        print(f"  recorded in file : {want}")
        print(f"  {'PASS' if ok else 'FAIL'}  the original is recoverable byte for byte")
        sys.exit(0 if ok else 1)

    out = neutralise(raw, before)
    # Prove reversibility BEFORE writing. A neutralisation that cannot be undone
    # is a deletion with a comment on it.
    rec = recover(out)
    after = hashlib.sha256(rec.encode('utf-8')).hexdigest()
    print(f"  file            : {TARGET}")
    print(f"  sha256 before   : {before}")
    print(f"  strip-and-rehash: {after}")
    if after != before:
        print("  FAIL  the neutralised file does not strip back to the original. Nothing written.")
        sys.exit(1)
    print("  PASS  reversible byte for byte")
    if check_only:
        print("  --check: nothing written")
        return
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(out)
    print(f"  written ({len(raw)} -> {len(out)} bytes)")

if __name__ == '__main__':
    main()
