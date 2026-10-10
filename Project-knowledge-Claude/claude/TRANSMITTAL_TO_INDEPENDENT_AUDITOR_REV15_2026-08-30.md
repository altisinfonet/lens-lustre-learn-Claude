# Transmittal to the independent auditor — pack rev15

**Authored by the compiler/audit session.** These are my words, not the owner's; he is forwarding them. Auditor-to-auditor.
Date: 2026-08-30. Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16), re-verified in my container today. **No commits, tags, pushes, merges, deployments, migrations or provider writes.**

---

## 1. The question, first, because everything else waits on it

**What do you need in order to begin the 138-file review?**

It has not begun on any side — not ours, and by your own statement not yours. **Six of the nine release gates now wait on it.** Both developer sessions have run out of work that shortens this release; nothing further we measure moves that date by a day.

One thing that should make it cheaper than you may be assuming: **a replacement RC does not invalidate the review.** All three patched files are already members of the 138, and the patches add and delete no paths — verified by empty symmetric difference of the path sets plus per-item membership, not by the count matching. **The delta is three files and 43 changed lines.** So the 138 you review now stays reviewed.

Two smaller decisions also sit with you: whether you want the A15 navigation index at all (offered, not built — if you close rows by agreeing with our index, the index has audited itself), and the four §25.3 rows below.

---

## 2. CORRECTION — my §25.3 negatives were sent to you undated. Here they are, stamped.

Your standard and mine: **a negative measurement carries its as-of time.** "Not present" and "zero of N" without a timestamp are not measurements — positives are durable, negatives decay. I sent you a page of bare negatives this morning. Corrected:

| Row | Negative | **As-of (UTC)** |
|---|---|---|
| 1.4 | No R2 token spans both `50mm` and `50mm-staging` | **2026-08-30T13:46:13Z** |
| 1.6b | `isolation-probe/` — 0 objects in `50mm` | **2026-08-30T13:46:54Z** |
| 1.6b | `isolation-probe/` — 0 objects in `50mm-staging` | **2026-08-30T13:47:52Z** |
| 1.6c | 0 reusable Access policies; no Access application covers `staging.50mmretina.com` | **2026-08-30T13:49:22Z – 13:49:55Z** |
| 1.5 | `staging` environment — no secrets, no variables | **2026-08-30T13:50:48Z** |
| 1.5 | `production` — no required reviewers, no wait timer | **2026-08-30T13:52:07Z** |
| 1.5 | `SUPABASE_DB_URL` **not** among repository secrets; 0 repository variables | **2026-08-30T13:55:48Z – 13:56:30Z** |

All captured by me in the owner's browser, read-only, names and scopes only, **no secret value viewed**. Classification **OWNER-ATTESTED** — I captured them, so I do not audit them, and §25.4 means they cannot close a §25 row. **The closure is yours.**

**One trap in row 1.6c, recorded because I nearly fell into it:** the Access **Applications** page shows a "choose a plan" paywall that reads as *nothing configured*. The **Legacy policies** tab shows one live application. Anyone re-checking this must open the Legacy tab.

---

## 3. What has changed in the evidence since your rev6 review

### Now VERIFIED by two instruments that share no code

A second session measured the 71 bundles blind — its own comparator, no sight of our output, and it was never told any expected figure.

| | our instrument | blind instrument |
|---|---|---|
| CORS classes | 39 wildcard / 27 gated / 5 neither | **identical** |
| `_shared/secureHeaders.ts` md5 | one value, `58b9f45d5200a9b19f1b24011dfc3511` | **identical** |
| bundles carrying that file | 27 of 71 | **27 of 71** |
| storage-lane assertion, deployed | 0 of 71 | **0 of 71** |
| MATCH at the RC | 21 | **21** |
| header-only at the RC | 22 | **22** |

**The MATCH and header-only comparisons were run by membership, not by count, and the symmetric difference is empty in both directions.** We had already found, inside one instrument, two sets of 21 with **overlap zero** — so counts are not accepted here as agreement.

### Your two rev6 findings

- **Storage-lane magnitude — you were right that it was open, and the population hypothesis is confirmed.** Only **ten deployed functions reference the object store at all**, and the ten §23.5.1 risk 3 names are exactly the ten the RC guards in source (twelve in source, ten deployed). *"Absent in ten functions"* is materially accurate. **B13 does not need to be re-taken.** My "seven times smaller" claim is withdrawn — it was my inference, not the ledger's statement.
  **What survives is a wording defect:** the sentence implies the other 61 have the guard. None of the 71 does, and the ten named are the ten the release *fixes*, not the ten it leaves behind. §28.3 tidy-list item, or a correction at promotion. Your ruling.
- **`702e5ce`** — you were right, and I have withdrawn my "parallel to main" framing entirely. It is a commit on `origin/staging` (ledger §5.4 lists it in the `origin/main..origin/staging` manifest as rows 9–12); §23.5.3's classification stands. **Your narrower point is the one I adopted:** `WO3_drift_702e5ce.json` measures *deployed vs staging-as-of-2026-08-26* and must not be presented as "repo state before this release."

### A defect you should know about, because you corroborated from our output files

**F-41: for 18 of 71 records the published DRIFT verdict rested on no content comparison at all.** Our classifier compared path *sets* and returned before hashing anything. It was right for 16 of them — but by accident of ordering; the evidence confirming them did not exist until today. All 18 are now content-confirmed. **Two verdicts flipped to MATCH** (`handle-email-suppression`, `handle-email-unsubscribe` — the difference was a 2-byte `deno.json`, byte-identical on both sides, counted as a path-set difference).

**Bearing on your work:** the drift totals you recomputed from our JSON were, at that time, partly unevidenced. They are evidenced now. The corrected reading at the RC is **21 MATCH / 22 header-only / 28 DRIFT / 0 UNKNOWN** — which I reconstructed and counted myself from the published per-function table (`951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da`, 3,623 B, 72 lines) rather than accepting either session's summary. The same table reproduces **21 / 21 / 29 / 0** at `702e5ce` — the ledger's B13 split, rebuilt from primary data.

---

## 4. The merge position, unchanged, and now measured from two directions

`apply-migration.yml` on `main` is `workflow_dispatch` with no branch filter and no `github.ref` guard. Today its `environment:` line is commented out, so `SUPABASE_DB_URL` resolves empty and the job's first step exits 1. **At the RC that line is live** — `environment: ${{ inputs.target }}`, chosen by the dispatcher.

Against that, from my own console capture: `SUPABASE_DB_URL` exists **only** on the `production` environment; `production` permits **only `main`**; **required reviewers OFF, wait timer OFF, administrator bypass ON.**

**After a merge, a dispatch on `main` with `target=production` reaches the production database URL through an injectable job, and nothing pauses it.**

**F-36, which I think belongs in your report rather than ours:** the control that stands between a dispatch and production SQL is a **GitHub environment setting — not in the 138 files, not under review, not version-controlled, and changeable in the UI without a commit.**

A replacement RC branch now exists locally (unpushed, 0 remote refs, `main` and `staging` unmoved) with the construct shown removed, quoted at both endpoints, with a discriminating control. **It closes the construct. It does not touch F-36.**

**No pull request will be opened from that branch:** four workflows carry `pull_request: branches: [main, staging]` — a push fires none, a PR fires four.

---

## 5. Corrections I have recorded against myself since rev6

C-19, C-22, C-23, C-24, C-25, C-26, C-27 — seven, all the same shape: **a plausible completion written in place of a measurement.** Three of them you caught. The count-based bound I ordered in C-27 would have missed a record the developer found by asking the set question instead.

I mention them because you are weighing how much of our output to take on trust. **The honest answer is: verify the negatives and the quotations first — that is where every defect in this engagement has been.**

---

## 6. Attached

`HANDOVER_PACK_2026-08-30_rev15.tar.gz` — sha256 `3cde5c96a30a9826f212d1f045cd406bb2998094394929b2126b42ccc434cb8a`, 1,421,321 bytes, measured twice. 152 files; manifest covers 151; the one uncovered file enumerated as `['MANIFEST.sha256']` and nothing else; round-trip 151/151.

**Still open and closable only by you:** the 138-file review · the four §25.3 rows · the independent test-suite run · the 71-function re-measurement, where **the measurement is complete and only the closure is missing.**

Nothing merges, tags, deploys or signs until those return.
