# .github/workflows/ledger-guard.yml   — v3. NOT COMMITTED; a file for review.
# Read-only. No secrets. No provider access.
#
# DO NOT COMMIT THIS FILE, tools/ledger_guard.py, or its tests BEFORE PROMOTION.
# The frozen application/code RC is a42b209e4f70a6efed4f3dcdb654e0f994416594. Every commit
# after it on `staging` touches docs/PROMOTION_LEDGER.md ONLY. Adding .github/workflows/**
# or tools/** would be a NON-DOCS change after a42b209e: it would create a new code RC,
# invalidate §3 identity, §3.2 counts, the §25 evidence rows and the PR #104 description,
# and force scope and evidence to be reopened and re-signed. Install AFTER the promotion
# tag exists, as a separate PR.
name: ledger-guard

on:
  push:
    paths:
      - 'docs/PROMOTION_LEDGER.md'
      - 'tools/ledger_guard.py'
      - 'tools/test_ledger_guard.sh'          # v2: the test suite is a path trigger too -
      - 'tools/test_ci_propagation.sh'        #     a change to the tests must re-run them
      - '.github/workflows/ledger-guard.yml'
  pull_request:
    paths:
      - 'docs/PROMOTION_LEDGER.md'
      - 'tools/ledger_guard.py'
      - 'tools/test_ledger_guard.sh'
      - 'tools/test_ci_propagation.sh'
      - '.github/workflows/ledger-guard.yml'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout with full history
        uses: actions/checkout@v4
        with:
          fetch-depth: 0        # REQUIRED. A shallow clone is what produced "205 commits" (C-2).

      - name: Fetch the promotion base (FATAL on failure)
        run: |
          set -euo pipefail
          # v2: no `|| true`. If the base cannot be fetched, LG-05 would silently compare
          # against nothing, and a stale count would pass. That is worse than a red build.
          git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
          git rev-parse --verify origin/main

      - name: Fetch tags so LG-09 can see REMOTE tags
        run: |
          set -euo pipefail
          git fetch --tags --force origin

      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }

      - name: Self-test the guard before trusting it
        run: |
          set -euo pipefail
          bash tools/test_ledger_guard.sh
          bash tools/test_ci_propagation.sh

      - name: Audit the ledger
        run: |
          # No `set -e` in THIS step: the guard's non-zero exit is the result we want to
          # read, not an error to abort on. `pipefail` + PIPESTATUS[0] give the guard's own
          # status, never tee's. Do NOT append `|| true` to the pipeline - that overwrites
          # PIPESTATUS and turns every failure into a pass.
          set -uo pipefail
          python3 tools/ledger_guard.py \
            --repo . \
            --ledger docs/PROMOTION_LEDGER.md \
            --base origin/main \
            | tee ledger-guard-report.txt
          st="${PIPESTATUS[0]}"
          case "$st" in
            0) echo "::notice::ledger-guard: clean" ;;
            1) echo "::error::ledger-guard: FAIL findings present" ;;
            2) echo "::error::ledger-guard: usage or environment error" ;;
            3) echo "::error::ledger-guard: BLOCKED - a check could NOT be performed; this is neither a pass nor an ordinary failure, restore the missing input and re-run" ;;
            *) echo "::error::ledger-guard: unexpected exit $st" ;;
          esac
          exit "$st"

      - name: Upload the report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ledger-guard-report
          path: ledger-guard-report.txt
