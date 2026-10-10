# F-40 accepted, A-3 complete, and the published table verified in this container

Date: 2026-08-30
Role: auditor. Everything in §2 was computed here, from the published file, not relayed.

---

## 1. F-40 — ACCEPTED. A real instrument defect, correctly conceded.

The disagreement was `deno.json`, and it is **byte-identical on both sides**. Four matching hash pairs; both repo blobs are the same git object `9e26dfeeb6e641a33dae4961196235bdb965b21b`; `od -c` shows `{ }`, deployed content `[123, 125]`.

**Why the instrument said DRIFT — from its own record:** `"reason": "path sets differ"`, `only_in_prod: ["…/deno.json"]`, `n_rc: 1`, `n_prod: 2`. **`classify()` compares path sets before it compares any content — it never hashed the file.**

**Why the closure never emitted it:** `deno.json` is passed as `--import-map`. It is an **input to resolution, never a resolution target**. No import names it, so nothing adds it to the closure. *Consumed, not emitted.* The Functions API agrees it is a declaration — `import_map: True`, `import_map_path` set alongside a separate `entrypoint_path`.

**F-40 recorded: the drift closure cannot see a file that is shipped but never imported.**

### Why the column change is legitimate and not tuning

Developer 1 pre-empted the objection correctly: *"I am changing it because a byte measurement showed my instrument wrong, not because it makes 21 meet 21 — the four sha256 pairs above were taken before any count was compared."*

**Accepted, and the record supports it independently:** the published TSV is **unchanged**, its hash still holds, and **both columns were always in it.** No datum moved. Only the declaration of which reading is like-for-like moved, and it moved on byte evidence that predates the comparison.

The import-map-excluded reading *"was an ad-hoc workaround that turns out to have been right for a reason I could not state until now."* That is the honest description.

### The bound is claimed as "two functions, one file each" — the join supports it, but the direct check is one query

My reasoning, offered as reasoning and **not** recorded as measurement: Developer 2's comparator hashes everything, Developer 1's shortcuts on path sets, so **any other F-40 false positive on an otherwise-matching function would have surfaced as a Pass-1 difference** — and Pass 1 showed exactly these two. Pass 2 being empty covers the header-only classification the same way.

**That is an argument, and rule 11 says an argument is not a retention.** **Ordered:** enumerate every function where `n_prod ≠ n_rc` in `classify()`'s own record, and for each state whether it was classified on path-set difference without hashing. One query, and it converts my inference into a measurement.

---

## 2. INDEPENDENT VERIFICATION — done here, in this container

I read `claude/DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv`, reconstructed it locally, and measured it.

```
bytes: 3623   lines: 72
sha256: 951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da
```

**Exact match to the published hash.** My reconstruction is byte-identical to Developer 1's file and to the copy Developer 2 verified. Three parties, one set of bytes.

**Bucket counts, computed by me from the raw column data — not taken from anyone's summary:**

| column | MATCH | HEADER-ONLY | DRIFT |
|---|---|---|---|
| `a42b209e_imap_excluded` | **21** | **22** | **28** |
| `a42b209e_strict` | **19** | **22** | **30** |
| `702e5ce_imap_excluded` | **21** | **21** | **29** |

Three things follow, and I state them as measured here:

1. **Developer 1's collapsed declaration is correct** — MATCH 21, DRIFT 50 (22 + 28), UNKNOWN 0.
2. **The strict/imap gap is exactly two rows** — `handle-email-suppression` and `handle-email-unsubscribe`, DRIFT under strict, MATCH under imap-excluded. Nothing else moves between readings. Consistent with Developer 2's Pass-1 result to the function.
3. **`702e5ce_imap_excluded` reproduces `21 / 21 / 29` — the ledger's B13 split, exactly.** §23.5.1's measured basis, reconstructed by me from primary per-function data for the first time in this engagement.

---

## 3. Developer 2's path flag is STALE — and their general point stands

Developer 2 reports the ordered path *"is still empty."* **It is not.** `claude/DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv` exists, `created_at 2026-08-30T16:45:12Z`, and I read it above. Their check preceded Developer 1's publication.

**Their general warning remains correct and should not be discarded with the stale instance:** a third session handed a path per rule 9 will fail exactly as they did if the path is wrong, **and will have no hash to fall back on.** The fix is in the rule itself.

**Rule 9 amended:** *a blind session is given an exact path **and the expected sha256 and byte count of the file at it**. Identity is settled by the digest; the path is only an address.* Developer 2 demonstrated why — they read a differently-named file and let the hash decide, which is the only reason the mismatch cost nothing.

---

## 4. A-3 — COMPLETE. All ten conditions met.

| Condition | Result |
|---|---|
| 3a — patch hashes | **six distinct, three applied (`1a5f1c4f…`, `7422531b…`, `ba939941…`), and recorded in the commit message of `9384ba9` — the branch carries its own provenance.** More than was asked |
| 3b — trigger enumeration | **8 of 8 workflows; none fires on a push to this branch** |
| 3c — three paths | 3 paths, 0 added, 0 deleted, **+36 / −7** |
| 3c — 138 files | **verified by empty symmetric difference of the path sets plus per-item membership** — not by the count matching. Rule 5 satisfied |
| 3c — lines vs `main` | **+9,095 / −1,299 measured**, superseding the projection |
| 3c — commits vs `main` | **40 · 38 measured, reclassified INFERRED → VERIFIED** |
| 3d — construct removed | **quoted at `a42b209e` and on the branch for all three files, with a two-payload proof and a discriminating `stripHtml` control** |
| 3e — identity | base `a42b209e…594`, head `9384ba9…169f5`, `main` and `staging` unmoved, **0 tags, 0 remote refs** |

**G1 moves.** The defect is now shown removed, with a control that discriminates — not merely asserted.

### The unsolicited warning is the most valuable line in the return

> *"four carry `pull_request: [main, staging]`, so a PR would fire all four."*

Nobody asked for this. **It converts "no PR" from a procedural instruction of mine into a measured hazard**: opening a pull request from this branch would fire four workflows. **Standing: no pull request from `rc-replacement/option2-2026-08-30`, and this is now the reason, on the record.**

### One thing to explain, not supersede

The A-4 projection was `+9,096 / −1,300`; the measurement is `+9,095 / −1,299`. **Off by exactly one in each direction.** The measurement governs — but *"superseding the projection"* is a disposition, not an explanation. A one-line delta that appears on both sides usually has a mundane cause (a `\ No newline at end of file` marker, or `diff -ru` and `git diff` counting a boundary differently). **Name it. An unexplained off-by-one in a line count is exactly the size of defect this engagement has been finding all day.**

---

## 5. The transcription catch — and rule 12

While checking their own document against the branch, Developer 1 found line 124 transcribed as `.replace(/</g, "<")` — **the HTML escape had been eaten in transcription.** Corrected to `<` and verified character-for-character against `git show HEAD:functions/_seo.ts`.

**Consider what that document said before the catch: that the fix replaces `<` with `<`.** A reviewer reading the document rather than the branch would have seen a no-op and either raised a false alarm or approved a fix that appeared not to be one. **The work was right; the description of the work was wrong.**

That is now the fourth defect of this exact shape — the patch `+++` headers, the C-18 citation, the "98 of 138" prohibition, and this. **This engagement's defects cluster at the transcription boundary: the moment a measured thing is re-typed into prose.**

**Standing rule 12, proposed and adopted:** *quoted code, hashes and clause text are verified character-for-character against the source they claim to quote, at the time of writing. A quotation is a measurement and carries the same burden.*

Developer 1 performed exactly this check unprompted. The rule generalises what they did.

---

## 6. WO-8 B1

Delivered as `WO8_B1_ANSWER_AND_JOIN_DECLARATION_2026-08-30`. **I have not read it. It is RELAYED until I do**, and I will not summarise its contents from its title.

---

## 7. Completion

| Gate | Before | Now |
|---|---|---|
| G1 — RC free of known-armed defects | 0.5 | **0.75** — defect shown removed with a discriminating control, on a branch whose provenance is self-carrying. Not 1.0: the branch is not yet an adopted RC and the delta is unreviewed |
| G5 — 71-function re-measurement | 0.95 | **0.95** — *the measurement is now complete*: two instruments, agreement by membership, the one discrepancy resolved by bytes, and the ledger's own `21/21/29` reproduced here from primary data. **The remaining 0.05 is §25.4 closure by the independent human auditor, which no further measurement can supply** |
| **Credited** | 2.7 / 9 ≈ 30% | **2.95 / 9 ≈ 33%** |

Classification: OWNER-ATTESTED estimate, basis in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md` as corrected by C-25.

**Unchanged, and now the only merge-blocker not in hand:** after a merge, a `workflow_dispatch` on `main` with `target=production` reaches `SUPABASE_DB_URL` through the job — reviewers off, timer off, admin bypass on. The patches close the construct; **F-36 closes nothing, because it lives in the GitHub UI outside the 138 files.**

**And the 138-file review has still not begun on any side.** Six of the nine gates now wait on one person who has not started.
