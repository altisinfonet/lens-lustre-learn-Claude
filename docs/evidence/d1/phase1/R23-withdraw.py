import io, hashlib, os, sys
BLOCK = """-- ===========================================================================
-- WITHDRAWN under Auditor rulings R-24 / R-26, re-cut at 0032 under R-23.
-- NEUTRALISED, not merely renamed.
--
-- The UNAPPLIED_ prefix is NOT a dispatch control. apply-migration.yml's
-- allowlist is a glob on directory and extension: every .sql file under
-- supabase/migrations and supabase/rollback matches it, this one included.
-- The workflow reads no filename prefix and no comment -- it cats the file
-- into psql. Withdrawal by rename alone left this SQL one typed path away
-- from running.
--
-- THIS FILE IN PARTICULAR MUST NOT RUN. It carries no BEGIN and no COMMIT, so
-- under ON_ERROR_STOP a failure part-way leaves the earlier statements applied
-- and the rest not, across eleven money and account-control functions. It also
-- retains authenticated and service_role BY OMISSION rather than by grant,
-- which is safe only while those roles happen to hold named ACL entries --
-- the same reasoning that failed in the withdrawn 0029.
--
-- Every line of the original body below carries a leading "-- ". The body is
-- therefore inert on its own terms, and recoverable byte for byte:
--
--   strip this block, then strip exactly three characters from the start of
--   every remaining line, and the result is the original file.
--
-- sha256 of the original, before neutralisation (newline-preserving):
--   {sha}
--
-- The hash is carried here rather than in a separate evidence file so that the
-- record travels with the file.
--
-- Replacement: {repl}
-- ===========================================================================
DO $withdrawn$ BEGIN
  RAISE EXCEPTION
    'WITHDRAWN under Auditor rulings R-24/R-26, re-cut at 0032 under R-23. This file is the '
    'historical record of SQL that must not run. Its body is preserved below, commented. '
    'Replacement: %.', '{repl}'
  USING ERRCODE = 'raise_exception';
END $withdrawn$;
"""
PAIRS = [
 ("supabase/migrations/20260910_0027_p32_money_account_control_revoke.sql",
  "supabase/migrations/UNAPPLIED_20260910_0027_p32_money_account_control_revoke.sql",
  "supabase/migrations/20260910_0032_p32_money_account_control_revoke.sql"),
 ("supabase/rollback/20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql",
  "supabase/rollback/UNAPPLIED_20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql",
  "supabase/rollback/20260910_0032_p32_money_account_control_revoke_ROLLBACK.sql"),
]
rows=[]
for src, dst, repl in PAIRS:
    raw = io.open(src, encoding='utf-8', newline='').read()
    before = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    block = BLOCK.replace('{sha}', before).replace('{repl}', repl)
    assert '/*' not in block, 'guard block must contain no block comment'
    body = "\n".join('-- ' + l for l in raw.split('\n'))
    io.open(dst, 'w', encoding='utf-8', newline='').write(block + body)
    os.remove(src)
    new = io.open(dst, encoding='utf-8', newline='').read()
    assert new.startswith(block)
    rec = "\n".join(l[3:] for l in new[len(block):].split('\n'))
    after = hashlib.sha256(rec.encode('utf-8')).hexdigest()
    rows.append((dst, before, after, len(raw), len(new)))
print(f"{'file':<66}{'strip-and-rehash':>18}{'bytes':>18}")
ok=True
for p,b,a,lb,ln in rows:
    m = (b==a); ok &= m
    print(f"  {p.split('/')[-1][:62]:<66}{('MATCH' if m else '*** MISMATCH'):>18}{str(lb)+' -> '+str(ln):>18}")
print(f"\n  both reverse byte-for-byte: {ok}")
for p,b,a,lb,ln in rows:
    print(f"  recorded sha256 {b}  {p}")
