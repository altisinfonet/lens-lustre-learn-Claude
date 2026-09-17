# CLAUDE.md — repository operating pointer

This file is intentionally small. It does not restate policy — it points to
where policy actually lives, in priority order, and states a few rules that
apply regardless of which document you're reading.

## 1. Document hierarchy (read in this order, only as far as the task needs)

1. **`docs/ADDENDUM_A_EXECUTION_MASTER.md`** — current engineering operating
   authority: roles, the SQL-apply / Promotion / Gate vocabulary, file
   ownership, branch and PR discipline. Start here for *how work is done*.
2. **`docs/gates/GATE_REGISTER.md`** — current gate/evidence status per unit.
3. **`docs/PROMOTION_LEDGER.md`** — the Auditor's promotion/evidence record.
   Single author (the Auditor). Do not edit it to "catch up" a unit yourself.
4. **`docs/gates/PRODUCTION_LEDGER.md`** — what is actually true on
   production today.
5. **`docs/DECISIONS.md`** — recorded decisions and their rationale.
6. **Current task evidence/state** (this session's own fresh inspection,
   live GitHub Actions runs, live database queries) **outranks all of the
   above** when they disagree. Documents record what was true when written;
   they are not re-verified on every read.

Any other `.md` file in this repository not listed above — including
`AI_CONTROL.md`, `AI_EVIDENCE.md`, `docs/MASTER_EXECUTION_PLAN.md`,
`docs/claude/**`, and dated reports at the repo root — is historical unless
a document in the hierarchy above explicitly promotes it back to current.
Several of these historical documents carry their own supersession notice
at the top; read that notice before relying on anything below it.

## 2. Working rules, every session

- Inspect before changing anything. Never trust a prior claim — your own,
  a document's, or another session's — without re-verifying it against the
  live repository, the live workflow run, or the live database.
- Follow **INSPECT → PLAN → IMPLEMENT → VERIFY → AUDIT** for engineering
  work; the Addendum names what evidence closes each step.
- Branch from `staging`, never `main`, for development. One scoped unit per
  PR.
- Never blindly revoke database privileges; inspect actual callers first —
  see `docs/ADDENDUM_A_EXECUTION_MASTER.md` and F-62 in
  `docs/gates/GATE_REGISTER.md` for why a REVOKE can be a silent no-op.
- Security-relevant DB changes ship with migration + rollback + PROBE, and
  are applied only through the sanctioned `apply-migration.yml` workflow.
  Never apply SQL to production manually.
- Verify actual GitHub Actions / database evidence before declaring
  anything complete. Distinguish **code merged** (PR landed on `staging`),
  **staging-applied** (SQL run against staging), **production-applied**
  (SQL run against production), and **VERIFIED** (live evidence re-checked
  after the fact) — these are four different, non-interchangeable states.
- Read only the documents this task actually needs. Avoid re-reading large
  ledgers end-to-end when a targeted section or a fresh live check answers
  the question.
- Do not modify a governance document outside its own ownership/scope
  (e.g. `docs/PROMOTION_LEDGER.md` is the Auditor's file).
