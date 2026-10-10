# v3 — what could NOT be measured

Recorded under the standing rule: never silently convert one evidence category into another.

## B-1 · Git-for-Windows transcript — **BLOCKED**

**Requested:** "Git-for-Windows and Linux transcripts."
**Status:** the Linux transcripts are MEASURED on this host. **There is no Windows host in this
session.** No Windows transcript is supplied, and none is simulated. A transcript I typed out
would be a fabrication of the same class as the `MANIFEST.sha256` size I invented in an earlier
round.

What can honestly be said about Windows portability is a list of **risks**, not results —
`SPECIFIED, NOT EXECUTED`:

| Risk | Mitigation already in the scripts | Still unproven |
|---|---|---|
| CRLF line endings break `bash` | both scripts abort with `FATAL: CRLF line endings` | the check itself is untested on Windows |
| `python3` may only exist as `python` | none — the scripts call `python3` | would need a `PY=${PY:-python3}` shim |
| `sha256sum` absent in some shells | Git-for-Windows ships it in its usrbin | unverified |
| `mktemp -d` path contains spaces | every path is quoted | unverified |
| `core.autocrlf=true` rewrites fixture files | fixtures are created in a temp repo, not checked out | unverified |
| `declare -A` needs bash ≥ 4 | Git-for-Windows ships bash 5.x | unverified |

**To close B-1:** run `bash test_ledger_guard.sh` and `bash test_ci_propagation.sh` in Git Bash on
a Windows host and paste the output. That is a ten-minute task for anyone with the machine. It is
not a task I can honestly complete from here.

## B-2 · "Measured" exact-REV-16 report — **BLOCKED; ATTESTED supplied instead**

**Requested:** "a measured exact-REV-16 report."
**Status:** the guard has **no git access to `altisinfonet/lens-lustre-learn-Claude`** in this
session (`git push` blocked; `GH_TOKEN` returns 403 "GitHub access to this repository is not
enabled for this session"). `REV16_REPORT_V3.txt` was therefore produced with `--facts`, and
**every finding in it is printed with the `[ATTESTED]` tag**. The ledger file itself IS the real
one — 182,502 bytes, sha256 `f00f612a…5943` — so the document-only checks (LG-06, LG-07, LG-08,
LG-10) are measured; the git-derived checks (LG-01, LG-02, LG-04, LG-05, LG-09) are only as good
as `facts_rev16.json`, which I read from GitHub's compare and blob views at 12:02Z.

**To close B-2:** run the `--repo` form in any checkout of `staging`. One command, and every
`[ATTESTED]` tag becomes `[MEASURED]`.

## B-3 · Live-git ambiguous abbreviation — **SPECIFIED, NOT EXECUTED**

See `V3_FIX_EVIDENCE.md`, FIX 2 scope note. The attested branch is tested; the `GitFacts` branch
raising `Ambiguous` from git's own error text is not, because a 7-hex object collision cannot be
manufactured cheaply.
