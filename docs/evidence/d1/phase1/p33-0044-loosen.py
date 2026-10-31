#!/usr/bin/env python3
"""Produce the deliberately LOOSENED copies of 20260910_0044 that the harness
runs to show each guard is load-bearing (C-34). Each copy removes ONE thing and
nothing else, and asserts the text it removes was actually there — a loosener
that silently removed nothing would make every "RED as required" a lie.

    python3 p33-0044-loosen.py <variant> <out.sql>
variants: no-deps-check · cascade · no-body-check · no-version-check
"""
import io, sys, os
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '../../../../supabase/migrations/20260910_0044_p33_plpgsql_check_out_of_public.sql')

def cut(s, start, end):
    i, j = s.index(start), s.index(end)
    assert i < j, (start, end)
    return s[:i] + s[j:]

variant, out = sys.argv[1], sys.argv[2]
s = io.open(SRC, encoding='utf-8').read()
orig = s
if variant == 'no-deps-check':          # precondition 4 gone; RESTRICT still there
    s = cut(s, '  -- 4 · nothing outside the extension depends', '  -- 5 · no function body')
elif variant == 'cascade':               # precondition 4 gone AND RESTRICT -> CASCADE
    s = cut(s, '  -- 4 · nothing outside the extension depends', '  -- 5 · no function body')
    assert 'DROP EXTENSION plpgsql_check RESTRICT;' in s
    s = s.replace('DROP EXTENSION plpgsql_check RESTRICT;', 'DROP EXTENSION plpgsql_check CASCADE;')
elif variant == 'no-body-check':         # precondition 5 gone
    s = cut(s, '  -- 5 · no function body outside', '  -- 6 · no cron job')
elif variant == 'no-version-check':      # postcondition 2 gone
    s = cut(s, '  -- 2 · the same version. A move, not an upgrade.', '  -- 3 · 0 plpgsql_check functions in public')
else:
    sys.exit(f'unknown variant {variant}')
assert s != orig, 'the loosening removed nothing'
io.open(out, 'w', encoding='utf-8').write(s)
print(f'{variant}: {len(orig) - len(s):+d} chars removed -> {out}')
