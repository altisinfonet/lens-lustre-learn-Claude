# A11b — CORS census instrument lineage · **ANSWERED ALONE, AHEAD OF EVERYTHING ELSE**

Date: 2026-08-30 · Read-only. No branch, commit, push, merge, tag, deploy, migration, §5.3 probe,
provider write, ledger edit or secret read. **Nothing here closes a §25 row (§25.4).**

---

## THE ANSWER

**The CORS census does NOT share `tokenize()` or `closure()` from `07_ws4_reference_impl.py`, and
does not share any module that does. It is an independent regex + substring classifier over raw
file bytes.**

**Therefore: the CORS census does NOT join drift as INFERRED, and does NOT require a re-run after
A9. `27 / 39 / 2 / 3` stands.** C-3 and C-4 are unaffected by the lexer defect.

I did not settle this by asserting the old script was clean. I settled it by **re-deriving the whole
census with a new instrument written today**, which reproduces it with **zero mechanism
disagreements across all 71 functions**.

---

## 1. Requirement → Instrument → Evidence → Result → Status

| # | Requirement | Instrument | Evidence | Result | Status |
|---|---|---|---|---|---|
| **A11b-1** | Identify the producing script | search of the on-disk tree, the session transcript, and the CLI debug log | `PRODUCER_FRAGMENT_RECOVERED.txt` | **Identified, partially recovered.** The repo-side producer ran at `2026-08-30T07:27:19.054Z` as an **inline heredoc**; it was never written to disk. Its **first 12 lines survive verbatim**; the remainder does not | **VERIFIED (identification) / partial recovery** |
| **A11b-2** | Does it import or call `tokenize()` / `closure()`? | direct reading of the recovered source | fragment below | **NO.** Its imports are `json, os, re` — nothing else. No `sys.path` insertion, no `subprocess`, no `importlib`, no reference to `07_ws4_reference_impl` in any form | **VERIFIED, on the recovered portion** |
| **A11b-3** | Any *shared module* that does? | inputs traced | `WO2_lane_delta/cors_census.json` (production side), `<RC>/supabase/functions/<slug>/index.ts` (repo side) | **NO.** Both inputs are **raw text read with `open()`**. Neither is a product of `closure()`. The production side is captured deployment bundle text; the repo side is one file per slug | **VERIFIED** |
| **A11b-4** | Structural discriminator — would a `closure()`-based census have looked like this? | comparison against the A9 closure failure set | §3 | **NO — and this is decisive.** All four slugs whose `closure()` returned **exit 3** under the defective lexer carry **determinate** CORS verdicts in the census. A census routed through `closure()` would have returned UNKNOWN or nothing for them | **VERIFIED** |
| **A11b-5** | Independent re-derivation | `cors_reclassify_independent.py` — written from scratch today; no import, no subprocess, no shared module with the reference implementation | `CORS_CENSUS_71_A11b_INDEPENDENT.json` | **0 mechanism disagreements across all 71.** `27 shared / 39 local-wildcard / 2 external-specifier / 3 none`, and the same single prod-vs-repo disagreement (`submit-judge-decision`) | **VERIFIED** |

---

## 2. The producing script, as far as it survives

Recovered from the CLI debug log, `2026-08-30T07:27:19.054Z`. **The log truncates every captured
action at ~500 characters; this is all there is.** Verbatim:

```python
python3 <<'PY'
import json,os,re
RC="/home/claude/rc_a42b209e/supabase/functions"
cen=json.load(open("/home/claude/WO2_lane_delta/cors_census.json"))
ACAO=re.compile(r'["\']Access-Control-Allow-Origin["\']\s*:\s*([^,\n}]+)')
def repo_mech(slug):
    p=os.path.join(RC,slug,"index.ts")
    if not os.path.exists(p): return "NOT IN REPO", None
    s=open(p,encoding="utf-8",errors="replace").read()
    gsh="getSecureHeaders" in s
    loc=bool(re.search(r'\b(co        <<< TRUNCATED BY THE LOG >>>
```

> ⚠ **CORRECTED 2026-08-30 by auditor ruling. Original wording preserved below the correction.**
> ~~"The import graph is the first line… Python cannot reach `tokenize()` without one."~~
> **That claim is wrong and is withdrawn.** In Python `import` is a *statement*, legal inside any
> function body at any line. Twelve recovered lines out of an unrecoverable script **cannot**
> establish what the whole file imports.
>
> **Corrected wording:** *No import beyond `json`, `os`, `re` appears in the twelve recovered lines.
> The remainder is unrecoverable, so this **corroborates**; the **structural discriminator decides**
> (§3).*

The classification primitives visible in the recovered lines are a **compiled regex** on the
`Access-Control-Allow-Origin` header key and a **substring test** `"getSecureHeaders" in s` — the
signature of a grep/regex classifier. **This is corroboration, not proof.**

**Recovery limit, stated rather than glossed.** The remainder of this script, and the whole of the
**production-side** producer that wrote `WO2_lane_delta/cors_census.json` at ~06:55, are **not
recoverable**: both were inline heredocs, neither was saved to disk, the session transcript retains
only the post-compaction window (13:04 onward), and the debug log truncates. **On the unrecovered
portion I have no direct source evidence**, which is exactly why A11b-4 and A11b-5 exist — they
answer the question without depending on source recovery at all.

The production-side output's own schema corroborates the method: each record carries an `acao` field
holding the **literal matched text** (e.g. `"\"*\""`) — a regex capture group, not a parse result.

---

## 3. The structural discriminator — **THE DECISIVE ARGUMENT** (so ruled by the auditor)

**This section alone settles A11b.** §2 corroborates and §4 confirms by reproduction, but neither is
load-bearing: §2 rests on a partial recovery, and §4 is agreement between two instruments rather
than a property of the original. **This is the argument that stands on its own.**

Under the defective lexer, `closure()` returned **exit 3** for exactly four slugs. Here is how the
census classifies those same four:

| Slug | `closure()` under the old lexer | CORS census verdict | Independent re-derivation |
|---|---|---|---|
| `auth-email-hook` | **exit 3, UNPARSEABLE** | `LOCAL cors object` | `LOCAL cors object` |
| `preview-transactional-email` | **exit 3, UNPARSEABLE** | `LOCAL cors object` | `LOCAL cors object` |
| `process-email-queue` | **exit 3, UNPARSEABLE** | `NO CORS handling` | `NO CORS handling` |
| `send-transactional-email` | **exit 3, UNPARSEABLE** | `LOCAL cors object` | `LOCAL cors object` |

**A census that consumed `closure()` output could not have produced determinate verdicts for these
four.** It did. It therefore did not consume `closure()` output. This is a positive discriminating
test, not an absence-of-evidence argument.

---

## 4. Independent re-derivation — the decisive evidence

`cors_reclassify_independent.py` was written today, for this question. It shares nothing with the
reference implementation: no import, no subprocess, no common module. It reads the captured
deployment bundle text and the RC's `index.ts` files directly and applies four declared rules
(shared-helper → external-specifier → local-object → none).

**Result: `0` mechanism disagreements across all 71 slugs.**

| | ORIGINAL census | INDEPENDENT re-derivation |
|---|---|---|
| `secureHeaders.ts (shared)` — production | **27** | **27** |
| `LOCAL cors object` (wildcard) — production | **39** | **39** |
| `external specifier import` — production | **2** | **2** |
| `NO CORS handling` — production | **3** | **3** |
| repo-side split | 28 / 38 / 2 / 3 | 28 / 38 / 2 / 3 |
| prod-vs-repo disagreements | **1** — `submit-judge-decision` | **1** — `submit-judge-decision` |

**C-4 is reproduced exactly:** promotion changes the CORS mechanism of **exactly one** function.
*"Promotion fixes CORS" reaches 1 of 39* — unchanged.

### 4.1 My own instrument was wrong first, and the original census was right — disclosed

My first pass used `\bcors\b`, which does not match the identifier actually in the source,
`corsHeaders`. It misclassified `submit-judge-comment` and `submit-judge-tag` as `NO CORS handling`.
Direct reading settled it — both carry
`import { corsHeaders } from "npm:@supabase/supabase-js@2/cors"`, so **`external specifier import`
is correct and the original census had them right**. Pattern corrected in the shipped script, with
the error and the correction recorded in a comment beside it. Recording this because an independent
instrument that only ever agrees is not evidence that it was independent.

---

## 5. New finding raised while answering — **C-20**

> **C-20. The `prod_wildcard: false` flag on the 27 shared-helper functions is over-simple.**
>
> Measured by direct read of `_shared/secureHeaders.ts` lines 113–119:
>
> ```ts
> const acao = !isCorsRequest
>   ? { "Access-Control-Allow-Origin": "*" }
>   : allowed
>     ? { "Access-Control-Allow-Origin": requestOrigin, "Vary": "Origin" }
>     : { "Vary": "Origin" };
> ```
>
> `getSecureHeaders` emits `Access-Control-Allow-Origin: *` on the **non-CORS path** — a request
> that sends no `Origin` header. "27 allowlist" is accurate **for browser cross-origin requests**;
> a caller sending no `Origin` receives `*`.
>
> **This does not change the 27/39 split and does not change C-3's substance** — a wildcard returned
> to a caller that sent no `Origin` is not the same exposure as a wildcard on a credentialed
> cross-origin response. It is recorded because the boolean flag as published implies a stronger
> claim than the code supports. My independent classifier declines to set the flag from the entry
> file at all (`None`), which is why 27 rows differ on that field and on no other.

## 6. New finding — **F-30**, and it is a process finding about this engagement

> **F-30. The CORS census's instrument was never shipped with its number.**
>
> `CORS_CENSUS_71.json` is in the pack. The script that produced it never was — it was an inline
> heredoc, run once, never written to disk. That is the entire reason A11b was expensive, and the
> reason the auditor could not answer it themselves: **they had the output and not the instrument,
> which is precisely the position that makes corroboration meaningless.**
>
> **Rule, for the record:** *an instrument that produces a published number ships with the number.*
> This sits alongside the four rules already produced by this engagement, and it is the same parent
> rule again — **compression is where scope falls off.** Keeping the output and discarding the
> instrument is the compression.
>
> Both instruments produced under WO-9A/A11b (`ws4_reference_impl_A9.py`,
> `cors_reclassify_independent.py`) ship with their outputs, in the pack.
>
> **ADOPTED 2026-08-30 as a standing rule of this engagement by the compiler.** It joins the four
> rules already produced here, under the same parent rule: *compression is where scope falls off.*

---

## 7. Consequences for the ledger

| Item | Before A11b | After A11b |
|---|---|---|
| Drift totals 19/21/31, 19/22/30, 21/21/29, 21/22/28 | **INFERRED** (auditor's ruling — corroboration inherited the defect) | **INFERRED**, unchanged by A11b. A9 has re-run them through a repaired tokenizer with identical results; returning them to VERIFIED is the auditor's call, not mine |
| **CORS census 27/39/2/3** | **UNKNOWN lineage** | **Independent of the lexer — VERIFIED on THREE instruments:** this session's original, this session's independent re-derivation, and **Developer 2, working blind, who produced 39 wildcard / 27 gated / 5 neither** (their 5 = the 2 external-specifier + 3 none). RELAYED for Developer 2's figure; VERIFIED for the two run here |
| **C-3** (population splits four ways) | HIGH, lineage unknown | **HIGH, lineage settled** |
| **C-4** (promotion reaches 1 of 39) | lineage unknown | **reproduced exactly by a second instrument** |
| **C-20** | — | **NEW** — the allowlist flag is over-simple; substance unchanged. *(Issued as C-19; renumbered to C-20 by the compiler, who had already published a C-19 today. Correction numbers are issued by the compiler from now on.)* |
| **F-30** | — | **NEW** — process rule: instruments ship with their numbers |

**Nothing above closes a §25 row.** A14 and A15 follow separately, as ordered.
