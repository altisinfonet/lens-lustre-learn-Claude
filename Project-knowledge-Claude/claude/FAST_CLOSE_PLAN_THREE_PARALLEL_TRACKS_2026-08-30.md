# Fast-close plan — three parallel tracks, and the one ruling that shortens the road

Date: 2026-08-30
Owner instruction: *"now we have to move fast to close this chapter… Fast move and do multitask - do perfectly"*
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. Why this has been slow — the real cause, stated plainly

Not the number of defects. **The work has been running in one line, and the long pole has never been started.**

Three things have been serialised that never needed to be:

1. **The independent auditor's clock has never started.** §25.4 says only an independent human auditor can close a §25 row. That work could have been running for days. It has not, because the pack has not been sent.
2. **Evidence work has been treated as a merge precondition.** Most of it is not — see the ruling below.
3. **Two owner decisions have been waiting**, and no amount of further AI work substitutes for either.

Fixing all three at once is the whole speedup. It is available today.

---

## 2. THE RULING THAT SHORTENS THE ROAD

**B13 condition 2 excludes all edge-function deployment from this release.**

Therefore merging `staging` into `main` **does not redeploy any edge function.** It changes the contents of a branch. The deployed functions on production are byte-for-byte the same the minute after the merge as the minute before.

It follows that:

| Evidence item | What it measures | Changed by the merge? | Merge-blocking? |
|---|---|---|---|
| Drift census (19/21/31 etc.) | repo source vs **deployed** bundles | **No** — nothing redeploys | **No** |
| CORS census | headers in **deployed** bundles | **No** | **No** |
| C-14-L — no lane guard in 71 deployed bundles | **deployed** bundles | **No** — already true today | **No** — but live production issue |
| F-27 lexer defect + A8–A12 | the instrument behind the above | **No** | **No** |
| A5 credential-scrub run conditions | test hygiene | **No** | **No** |
| §25.3 rows 1.4 / 1.5 / 1.6b / 1.6c | infrastructure | **Auditor must rule** | **UNDETERMINED** |
| **Shell injection in the two workflows** | files that land **on `main`** | **YES — the merge arms it** | **YES** |
| 138-file review closure (§25.4) | the promotion's own scope | governance | **YES** |
| §5.3 probe, §11 signature, tag | governance | governance | **YES** |

**Merge-blocking set shrinks from 9 gates to 5**: G1 (injection fix), G3 (138-file review closed by the auditor), G7 (§5.3 probe), G8 (§11 signature), G9 (tag + merge) — plus whichever §25.3 rows the auditor rules merge-bearing.

Remaining work drops from **7.25 gates to 4.5** — roughly a 40% cut — **without lowering any standard and without bypassing anything.** The evidence work still gets finished; it simply stops standing in front of the merge, because it does not describe anything the merge changes.

**This ruling is OWNER-ATTESTED and requires the auditor's countersignature.** It rests entirely on B13 condition 2. If the auditor disputes that reading, the ruling falls and the 9-gate basis returns.

---

## 3. The three tracks — all start today, all run at once

### TRACK 1 — SAFETY (developer session) — the only true merge blocker

The injection fix. **2 files certain, 4 at most.**

- `apply-migration.yml`
- `verify-schema-dependencies.yml`
- `functions/_seo.ts`
- `cloudflare/seo-edge-injector/worker.js` — **only if** WO-9 B1 confirms it is in the 138 and carries the construct

Work: answer B1 and B2 first (they set the file count), produce the patches, then — **on the owner's pre-authorisation only** — cut the replacement RC branch off `staging` and apply them. Still no merge, no tag, no deploy.

Realistic duration: **one working session.** This is a quoting fix in two YAML files and an escape in one or two TS files. It has always been small. It has looked large because it sat behind everything else.

### TRACK 2 — AUDITOR (human, the long pole, **start it now**)

The auditor can begin **immediately** on material that already exists. Send today:

1. The rev6 pack (already built).
2. The three-line lineage question (WO-9A A13) — did they recompute with **their own** instrument or ours?
3. A request to **rule on the §2 ruling above** — does B13 condition 2 mean the deployed-state evidence is not merge-bearing?
4. A request to **rule which of §25.3 rows 1.4 / 1.5 / 1.6b / 1.6c bear on the merge** and which bear on production health only.
5. A request to begin §25.4 closure on the 138-file review with what is already evidenced, flagging what they still need.

Every hour this is not sent is an hour of the critical path burned. Nothing in Track 1 or Track 3 has to finish first.

### TRACK 3 — EVIDENCE (developer session, parallel, **non-blocking**)

WO-9A in full: A8 (apostrophe census), A9 (lexer repair + re-run all 71), A10 (planted-defect proof), A11 (instrument lineage), A12 (silent-field sweep); plus A5, A6, A7 and Groups B and D.

**This track no longer gates the merge.** It gates the *production-health* conclusions and the pack's integrity, both of which matter and both of which continue at full standard. It simply runs beside the merge instead of in front of it.

### TRACK 4 — C-14-L (separate, does not touch the release)

`assertStorageLane` is in **zero of 71 deployed bundles**. Production has no storage-lane guard **right now**. That is true today, was true last month, and is unaffected by the merge. It should be opened as its own item with its own timeline and never again held behind the promotion.

---

## 4. Timeline — days, not months

| Day | Track 1 (safety) | Track 2 (auditor) | Track 3 (evidence) |
|---|---|---|---|
| **0 — today** | B1, B2 answered; patches produced | pack + 5 questions sent | A8, A9, A5 running |
| **1** | replacement RC branch cut, patches applied | auditor rules on §2 and §25.3 scope | A10, A11, A12 |
| **2** | delta pack built — changed files only | auditor closes 138-file review on the delta | Groups B, D; rev7 pack |
| **3** | §5.3 probe run | §11 signature | production-health report |
| **4** | **tag, then merge** | — | C-14-L track opens |

Critical path is **Track 2**. Everything else fits inside it. If the auditor turns work around in two days, this closes in four.

---

## 5. What the owner must decide — two sentences, and only the owner can write them

Nothing else is waiting on anything but these.

**Decision 1 — pre-authorise the replacement RC.**
> I authorise building the minimal replacement RC on a branch off `staging`: the two workflow files, `functions/_seo.ts`, and `worker.js` if B1 is positive. Apply the patches on that branch. Do not merge, tag or deploy.

**Decision 2 — scope the merge gate.**
> I rule that evidence describing **deployed** state is not merge-blocking, because B13 condition 2 excludes edge-function deployment from this release, so the merge changes no deployed function. This is recorded as a deviation with reasons, subject to the independent auditor's countersignature. The evidence work continues on its own track and is not cancelled.

Both are **recorded deviations with stated reasons**, entered in the ledger. Neither is a bypass. The difference matters and is the whole point: a bypass hides a gate; a recorded deviation states the gate, states why it does not apply here, and signs for it.

---

## 6. Standing constraints — unchanged, all still in force

Do not expose secrets, tokens, cookies or credentials. Do not perform unsafe production writes. Do not execute financial transactions. Do not modify the frozen RC merely to manufacture a passing result. Do not run an unsafe N1/N2 configuration. Before any high-impact action, verify the actual workflow and branch being executed. Do not try to make the ledger look green — make it accurate. Do not overwrite previous conclusions; preserve the original and record the correction separately.

**Still prohibited until the gates above close:** merge, tag, deploy, migrate, production write.

**One thing this plan does not do:** it does not let the merge happen before the injection fix. That gate is not scope, it is safety — merging arms a shell injection in a job holding the production database URL. It is also the **cheapest** gate on the list: two files.
