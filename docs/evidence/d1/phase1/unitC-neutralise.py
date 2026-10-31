import io, hashlib, sys
BLOCK = """-- ===========================================================================
-- WITHDRAWN under Auditor rulings R-24 / R-26, Unit C.
-- NEUTRALISED, not merely renamed.
--
-- The UNAPPLIED_ prefix is NOT a dispatch control. apply-migration.yml's
-- allowlist is a glob on directory and extension: every .sql file under
-- supabase/migrations and supabase/rollback matches it, this one included.
-- The workflow reads no filename prefix and no comment -- it cats the file
-- into psql. Withdrawal by rename alone left this SQL one typed path away
-- from running.
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
    'WITHDRAWN under Auditor rulings R-24/R-26, Unit C. This file is the historical record of SQL '
    'that must not run. Its body is preserved below, commented. Replacement: %.', '{repl}'
  USING ERRCODE = 'raise_exception';
END $withdrawn$;
"""
NINE=[l.strip() for l in io.open('/tmp/uc/nine.txt') if l.strip()]
rows=[]
for p in NINE:
    raw=io.open(p,encoding='utf-8',newline='').read()
    before=hashlib.sha256(raw.encode('utf-8')).hexdigest()
    block=BLOCK.replace('{sha}',before).replace('{repl}','none')
    assert '/*' not in block, 'guard block must contain no block comment'
    body="\n".join('-- '+l for l in raw.split('\n'))
    io.open(p,'w',encoding='utf-8',newline='').write(block+body)
    new=io.open(p,encoding='utf-8',newline='').read()
    assert new.startswith(block)
    rec="\n".join(l[3:] for l in new[len(block):].split('\n'))
    after=hashlib.sha256(rec.encode('utf-8')).hexdigest()
    rows.append((p,before,after,len(raw),len(new)))
print(f"{'file':<62}{'strip-and-rehash':>18}{'bytes':>18}")
ok=True
for p,b,a,lb,ln in rows:
    m = b==a; ok &= m
    print(f"  {p.split('/')[-1][:58]:<62}{('MATCH' if m else '*** MISMATCH'):>18}{str(lb)+' -> '+str(ln):>18}")
print(f"\n  all nine reverse byte-for-byte: {ok}")
