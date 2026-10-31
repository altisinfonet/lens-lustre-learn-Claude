---
name: PROVE block CI gate (R6)
description: PRs touching judging surfaces must include a fully-filled PROVE block; enforced by .github/workflows/prove-block-required.yml
type: constraint
---
# Phase R6 — Prove before patch

`.github/PULL_REQUEST_TEMPLATE.md` ships a mandatory `PROVE` block.

`.github/workflows/prove-block-required.yml` runs on every PR. If the diff
touches any judging surface (see globs in the workflow), CI fails unless the
PR description contains:

1. `BEGIN PROVE BLOCK` / `END PROVE BLOCK` markers
2. `## PROVE` header
3. All six required sections, each with non-empty (non-comment) content:
   - `### 1. SOW citation`
   - `### 2. Failing case (before)`
   - `### 3. Fix (line-by-line diff captured)`
   - `### 4. Passing case (after)`
   - `### 5. Forensic audit checklist` (every box ticked)
   - `### 6. Author attestation` (Rule 5 — Claude-only — ticked)

**Why:** Mandate Rule 1. No assumptions, no guesswork. Every judging change
must carry on-record proof against SOW + live data before it can ship.

**How to apply:** Never disable, weaken, or bypass this workflow. If a
legitimate non-judging PR is mis-flagged, narrow the globs in the workflow —
do not remove the gate.
