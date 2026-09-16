#!/usr/bin/env bash
# Reproduces EXACTLY the bytes whose SHA-256 is recorded in yaml-static-validation.txt.
#
# BYTE CONTRACT (stated at revision 5, because revision 4 recorded a hash without its rule):
#   The hashed artifact is the content of the FIRST ```yaml fenced block in
#   05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md, taken as the bytes BETWEEN the line
#   following the opening ```yaml fence and the line containing the closing ``` fence,
#   INCLUDING the trailing LF of the last content line, and NOTHING else:
#     - the fence lines themselves are NOT included
#     - no leading or trailing whitespace is added or stripped
#     - exactly one LF terminates the final content line (this is the "+1 LF" in the contract)
#     - encoding UTF-8, line endings LF
# Equivalent Python: re.search(r'```yaml\n(.*?)```', src, re.S).group(1)
set -euo pipefail
f="${1:-05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md}"
awk '/^```yaml$/{if(!seen){seen=1;infence=1;next}} infence&&/^```$/{exit} infence{print}' "$f"
