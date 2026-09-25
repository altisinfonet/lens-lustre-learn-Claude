"""D1 · R-13 · static acceptance checks on .github/workflows/apply-migration.yml.

Rows 1, 2 and 3 of the acceptance table. Run from the repository root:
    python3 docs/evidence/d1/phase1/R13-static-checks.py <base-sha>
"""
import sys, re, subprocess, io
sys.dont_write_bytecode = True

BASE = sys.argv[1] if len(sys.argv) > 1 else "5d563e7"
WF = ".github/workflows/apply-migration.yml"
fail = 0
def ok(label, got, want):
    global fail
    good = got == want
    print(f"  {'PASS' if good else 'FAIL'}  {label:<62} {got}" + ("" if good else f"   want={want}"))
    if not good: fail = 1

print("D1 · R-13 · STATIC ACCEPTANCE")
print(f"base {BASE}\n")

# ── ROW 2 · the file is valid YAML, and parses to the same structure minus
#           the one changed step.
print("-- ROW 2  YAML validity")
try:
    import yaml
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--break-system-packages", "pyyaml"], check=True)
    import yaml
cur = yaml.safe_load(io.open(WF, encoding="utf-8").read())
ok("parses as YAML", cur is not None, True)
base_txt = subprocess.run(["git", "show", f"{BASE}:{WF}"], capture_output=True).stdout.decode()
base = yaml.safe_load(base_txt)

# ── ROW 1 · every pre-existing gate is byte-identical.
print("\n-- ROW 1  every pre-existing gate line unchanged")
def steps(doc): return doc["jobs"]["apply"]["steps"]
bs, cs = steps(base), steps(cur)
ok("same number of steps", len(cs), len(bs))
ok("same step names, same order",
   [s.get("name") for s in cs], [s.get("name") for s in bs])
changed = [s.get("name") for b, s in zip(bs, cs) if b != s]
ok("exactly one step differs", changed, ["Run it"])
for key in ("environment", "runs-on", "timeout-minutes", "env"):
    ok(f"job.{key} unchanged", cur["jobs"]["apply"].get(key), base["jobs"]["apply"].get(key))
for key in ("on", True, "concurrency", "permissions"):
    if key in base or key in cur:
        ok(f"top-level {key!r} unchanged", cur.get(key), base.get(key))

# The gate steps, compared as whole objects (script text included).
GATES = ["The branch must match the target",
         "Refuse to start without the database credential",
         "The credential must point at the target database",
         "Validate the requested file",
         "Show the SQL that is about to run",
         "Install psql",
         "Confirm"]
bmap = {s.get("name"): s for s in bs}
cmap = {s.get("name"): s for s in cs}
for g in GATES:
    ok(f"gate byte-identical: {g[:44]}", cmap.get(g) == bmap.get(g), True)

# ── ROW 3 · no ${{ }} anywhere inside a run: block.
print("\n-- ROW 3  no ${{ }} inside any run: block")
hits = []
for s in cs:
    r = s.get("run")
    if r and "${{" in r:
        for i, line in enumerate(r.split("\n"), 1):
            if "${{" in line:
                hits.append(f"{s.get('name')}:{i}: {line.strip()}")
ok("run-block ${{ }} occurrences", len(hits), 0)
for h in hits: print(f"      !! {h}")

# Belt and braces: a raw text scan of the run: regions, not just the parsed map.
raw = io.open(WF, encoding="utf-8").read().split("\n")
inrun, textual = False, 0
for i, line in enumerate(raw, 1):
    if re.match(r"^\s*run:\s*\|", line): inrun = True; indent = len(line) - len(line.lstrip()); continue
    if inrun:
        if line.strip() and (len(line) - len(line.lstrip())) <= indent: inrun = False
        elif "${{" in line: textual += 1; print(f"      !! raw {i}: {line.strip()}")
ok("raw text scan of run: regions", textual, 0)

# ── The interlock is actually present and shaped as commanded.
print("\n-- the change itself")
run_step = cmap["Run it"]["run"]
ok("psql receives -c SET p32.lane", "-c \"SET p32.lane = '${TARGET_LANE}';\"" in run_step, True)
ok("-c precedes -f", run_step.index("-c \"SET p32.lane") < run_step.index('-f "$MIGRATION_PATH"'), True)
ok("lane re-asserted against the two literals", "staging|production) : ;;" in run_step, True)
ok("the re-assert precedes the psql call", run_step.index("staging|production) : ;;") < run_step.index("psql \"$DB_URL\""), True)
ok("port is parsed", "PORT=$(printf" in run_step, True)
ok("6543 refused with the mandated message",
   "transaction-mode pooler cannot carry p32.lane; the Environment secret must use the session pooler (5432)" in run_step, True)
ok("$DB_URL is never echoed", re.search(r'echo[^\n]*\$DB_URL', run_step) is None, True)
# Not a count of mentions -- a count of mentions is not a control. What matters
# is that every assignment of p32.lane derives from $TARGET_LANE and none of
# them hard-codes a lane.
assigns = re.findall(r"SET p32\.lane\s*=\s*([^;]+);", run_step)
ok("p32.lane assignments found", len(assigns), 1)
ok("every assignment is ${TARGET_LANE}", [a.strip() for a in assigns], ["'${TARGET_LANE}'"])
ok("no assignment hard-codes a lane",
   [a for a in assigns if re.search(r"'(staging|production)'", a)], [])
ok("exactly one psql invocation", run_step.count("psql "), 1)

print(f"\n  OVERALL: {'ALL STATIC CHECKS PASS' if not fail else '*** FAILED'}")
sys.exit(fail)
