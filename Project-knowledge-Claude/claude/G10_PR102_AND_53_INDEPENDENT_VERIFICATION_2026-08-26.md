# PR #102 and §5.3 — independent verification — 2026-08-26

Verified from the remote and from GitHub directly, not from the executing session's report.
Read-only. Nothing merged, tagged, deleted or deployed by this session.

## 1. PR #102 — every claim checked

| Check | Result |
|---|---|
| Branch head / tree | `7b9d707a098e1dc477833d1ee1cea61061466f78` / `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` |
| Base | merge-base = `702e5ceb…` = current staging head; **1 commit, no drift** |
| Files changed | 9 — 8 added, 1 modified (`send-gift-credit/index.ts`) |
| Migration blob | `e25c3e7e` — byte-exact |
| Edge-function blob | `4c704d83` — byte-exact |
| `_shared/secureHeaders.ts` | `6d805c66` — **unchanged, G9 not regressed** |
| `supabase/migrations/` | exactly one addition; nothing modified or deleted |
| All 7 attached files vs the prepared originals | **all 7 md5-identical** |
| Schema-guard harness, re-run by this session on the committed tree | **41/41, exit 0** |

### CI on `7b9d707a` — §17-4 evidence for the PR tree

| Workflow | Run ID | Conclusion | Duration |
|---|---|---|---|
| Security | `32949191301` | success | 3/3 jobs, gitleaks full-history clean |
| Typecheck | `32949191433` | success | — |
| Web build | `32949191457` | success | lane assertion fired; production lane correctly skipped |
| UI gate | `32949191234` | **success** | run #114, 8m 00s total, job 7m 55s, artifact `ui-sweep-screenshots` sha256 `4c0e4f88…` |

The UI gate duration matches run #113 on the same base SHA almost exactly, which retires the
"is it hanging" question raised mid-run.

## 2. §5.3 secret-isolation negative test — VERIFIED, fresh

| Field | Value |
|---|---|
| Branch | `scratch/g10-53-secret-isolation-20260826`, head `9478cf768c47ba91cece3cddae02548e5f3ce8c2` |
| Delta vs staging | **one added file**: `.github/workflows/g10-secret-probe.yml` |
| Workflow name | `G10 secret isolation probe` |
| Run | `32950030302`, run #1, event `push`, job `probe` |
| Conclusion | **success**, 4s |

### The workflow source, read by this session

- **No `environment:` key.** The job body is `runs-on` + `steps` only. This is the point of the
  test: adding an environment would grant the job the very access it is trying to prove is
  withheld.
- Trigger is `push` restricted to `scratch/g10-53-secret-isolation-*` — outside both lanes. On
  `main` or `staging` the secret is *supposed* to resolve, so a pass there would mean the
  opposite of what it looks like.
- The step prints exactly one word: `EMPTY` when `DB_URL` is unset, `NON-EMPTY` otherwise. No
  value, no length, no hash, no prefix.
- **`exit 1` on the NON-EMPTY branch**, and no `continue-on-error`.

### Why the success conclusion is itself decisive

Because the workflow exits 1 whenever the secret resolves non-empty, a **successful** run is
proof that `secrets.SUPABASE_DB_URL` resolved **empty** on a branch outside both lanes. The
exit code carries the result independently of the echoed text.

**Not inherited from G3.** The two older probe branches, `scratch/secret-isolation-20260822`
and `scratch/secret-isolation-retest`, carry no probe workflow at their tips. This workflow was
authored fresh for this RC, as §5.3 requires.

### One limit, stated

This session could **not** independently re-read the literal log line. GitHub's log viewer
would not expand its steps under browser automation, and its in-page log search returned `0/0`
because unexpanded logs are not loaded. The executing session reported the line as
`2026-08-26T08:52:49.6186191Z EMPTY`. That specific string is therefore **reported, not
independently re-read here** — while the run ID, the branch, the workflow source and the
success conclusion all are.

## 3. Effect on the gates

- **G3 exit condition (§7): the §5.3 half is now VERIFIED.** The plan's §20 gave two reasons for
  G3 being AMBER; this removes one. The other — GitHub Environment creation and repository-secret
  deletion being OWNER-ATTESTED and unreadable from any session — still stands, so **G3 remains
  AMBER**, now for one reason instead of two.
- **§17-3** still cannot pass: **HS-10 remains live and unresolved.**
- **§17-4** has CI evidence for three trees now (main `b671e1f`, staging `702e5ce`, PR
  `7b9d707a`), but the production-lane host rules are still disarmed in `main`'s
  `web-build.yml`, so the line is still not satisfied as written.

## 4. Records correction the executing session does not have

That session reports the 23 production certificate deletions of 2026-08-25 as **NOT
OWNER-ATTESTED**. They **are** attested: the owner stated in this session, in writing, *"Ignore
the 23 production certificate deletions — I intentionally deleted them."* HS-1 is therefore not
live. The committed rollback files record the figures correctly either way; only the standing
of the attestation was stale.

## 5. Owner deletions now outstanding — five refs

Branch deletion returns HTTP 403 in every session tested, so all five are owner actions:

- `scratch/g10-53-secret-isolation-20260826` (new, from this run)
- `tool/pushcheck-1787718423`
- `scratch/lane-check-g3`
- `scratch/secret-isolation-20260822`
- `scratch/secret-isolation-retest`

§5.3 names branch deletion as part of the method, so the first one is not housekeeping — it is
the last step of the test.
