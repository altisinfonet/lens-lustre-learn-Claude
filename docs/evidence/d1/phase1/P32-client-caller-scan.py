#!/usr/bin/env python3
"""Client caller scan for a set of database function names.

WHY THIS FILE EXISTS, AND WHY IT IS COMMITTED RATHER THAN DESCRIBED
===================================================================

The first version of this scan, written for P32 units 0034/0035 on
2026-09-25, reported ZERO client callers for `create_system_post`. There are
two. It matched the `.rpc` cast form with

    \\(\\s*[A-Za-z_$][\\w$.]*\\.rpc\\s+as\\s+[^)]*\\)\\s*\\(\\s*["'`](NAME)["'`]

and `[^)]*` cannot span the nested parentheses in the shape the codebase
actually uses:

    (supabase.rpc as unknown as (
        name: string, args: Record<string, unknown>
      ) => PostgrestBuilder
    )("create_system_post", { ... })

so both real call sites -- src/lib/profilePostHelper.ts:41 and
src/pages/MyPhotos.tsx:409 -- were invisible. It did not change that unit's
grouping, because create_system_post belonged to 0035 either way. It could
just as easily have been a function about to lose the grant its only caller
needed.

This is the same defect class as C-A8 and C-A10 (a line-scoped instrument
reading multi-line source) and as the R-23 caller scan (a single-line
`.rpc("name"` regex that missed two multi-line calls of
admin_delete_auth_user). Three times in two days, each time in scaffolding
rather than in the unit, because scaffolding gets less scrutiny than the work
it measures. So the corrected instrument is committed, the way
unitC-sqlscan.py was, instead of being re-derived and re-broken.

THE METHOD
==========

Shape-independent by construction. It does not try to model the call syntax.
For every occurrence of a QUOTED function name it looks BACK a fixed window
for `.rpc` in any form -- plain, multi-line, or wrapped in an arbitrarily
nested `as` cast -- and separately matches REST `rpc/<name>` paths. Anything
that is a Supabase RPC call has `.rpc` shortly before the name; nothing else
plausibly does. A window rather than a grammar is deliberate: a grammar is
what failed.

`--window` widens the look-back if a call is ever written with more than 300
characters of type annotation between `.rpc` and the name. Raise it and
re-run rather than trusting the default.

KNOWN LIMITS, stated so the next reader does not assume more than it gives
-------------------------------------------------------------------------
  * A call whose function name is built at runtime (a variable, a template
    literal, a lookup table) has no quoted literal to find and will not
    appear. Nothing in this repository does that today; if that changes, this
    instrument stops being sufficient on its own.
  * `.rpc` more than `--window` characters before the name is missed.
  * It reports call SITES. Which role a site runs as -- anon key, user
    session, or SUPABASE_SERVICE_ROLE_KEY -- is not something a text scan can
    tell you. Resolve each receiver to its client by hand; P32's inventory
    did, and that is what separated the service-role edge callers from the
    signed-in ones.

USAGE
=====
    python3 P32-client-caller-scan.py NAMES.txt [--root .] [--window 300]
    python3 P32-client-caller-scan.py --names a,b,c

NAMES.txt is one bare function name per line, or a TSV whose second
tab-separated field is the name (so the unit signature TSVs work directly).

Exit status is 0 always: this reports, it does not judge. The judging is the
acceptance table's job.
"""
import os, re, sys, argparse

DIRS = ("src", "supabase/functions", "functions", "scripts", "public", "tools")
EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".html")
# Generated Supabase type declarations: every function name appears there as a
# type, and none of them is a call.
SKIP = {"src/integrations/supabase/types.ts"}


def is_test(path: str) -> bool:
    return ("__tests__" in path or "/uiharness/" in path
            or path.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")))


def load_names(arg_names, path):
    if arg_names:
        return [n.strip() for n in arg_names.split(",") if n.strip()]
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        out.append(line.split("\t")[1].strip() if "\t" in line else line.strip())
    seen, uniq = set(), []
    for n in out:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    return uniq


def scan(names, root=".", window=300):
    alt = "|".join(sorted(set(names), key=len, reverse=True))
    quoted = re.compile(r'["\'`](' + alt + r')["\'`]')
    rest = re.compile(r"rpc/(" + alt + r")\b")
    back_rpc = re.compile(r"\.rpc\b", re.S)
    hits, files = {}, 0
    for d in DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dp, _, fs in os.walk(base):
            for f in fs:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, root)
                if rel in SKIP or not f.endswith(EXTS):
                    continue
                try:
                    src = open(p, encoding="utf-8", errors="ignore").read()
                except OSError:
                    continue
                files += 1
                for m in quoted.finditer(src):
                    if back_rpc.search(src[max(0, m.start() - window):m.start()]):
                        hits.setdefault(m.group(1), set()).add(
                            (rel, src[:m.start()].count("\n") + 1, "rpc", is_test(rel)))
                for m in rest.finditer(src):
                    hits.setdefault(m.group(1), set()).add(
                        (rel, src[:m.start()].count("\n") + 1, "rest", is_test(rel)))
    return hits, files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names_file", nargs="?")
    ap.add_argument("--names")
    ap.add_argument("--root", default=".")
    ap.add_argument("--window", type=int, default=300)
    a = ap.parse_args()
    if not a.names_file and not a.names:
        ap.error("give a names file or --names")
    names = load_names(a.names, a.names_file)
    hits, files = scan(names, a.root, a.window)

    print(f"CLIENT CALLER SCAN — {len(names)} names, {files} files under "
          f"{', '.join(DIRS)}")
    print(f"look-back window: {a.window} characters\n")

    prod = {n: sorted(v) for n, v in hits.items() if any(not x[3] for x in v)}
    testonly = {n: sorted(v) for n, v in hits.items() if n not in prod}
    none = sorted(set(names) - set(hits))

    print(f"WITH A PRODUCTION CLIENT CALL SITE ({len(prod)}):\n")
    for n in sorted(prod):
        for (p, l, k, t) in prod[n]:
            print(f"  {n:<40} {p}:{l}  [{k}]" + ("  (test)" if t else ""))
    print(f"\nTEST OR SCRIPT CALL SITES ONLY ({len(testonly)}):\n")
    for n in sorted(testonly):
        for (p, l, k, t) in testonly[n]:
            print(f"  {n:<40} {p}:{l}  [{k}]")
    print(f"\nNO CLIENT CALL SITE OF ANY KIND ({len(none)}):\n")
    for n in none:
        print(f"  {n}")
    print(f"\n  {len(prod)} production · {len(testonly)} test-only · {len(none)} none"
          f"   = {len(names)} names")

    # The regression this instrument exists to prevent. If create_system_post
    # is in the name list, its two known call sites must be found.
    if "create_system_post" in names:
        found = {p for (p, l, k, t) in hits.get("create_system_post", ())}
        want = {"src/lib/profilePostHelper.ts", "src/pages/MyPhotos.tsx"}
        missing = want - found
        print("\n  SELF-CHECK create_system_post (the call shape that broke the first scan):")
        print(f"    both nested-cast call sites found: {not missing}"
              + (f"   MISSING {sorted(missing)}" if missing else ""))


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    main()
