# REV-17 — ready-to-paste ledger text for the promotion commit

**Drafted by the compiler. NOT committed. NOT signed.** Paste into `docs/PROMOTION_LEDGER.md`, edit any wording you disagree with, sign, and commit **once** — §24.1 step 7.

**No placeholders remain. Every figure below is measured.** Read it, change any wording you disagree with, sign §11, and commit **once**.

---

## Insert into §3.1 — RELEASE CANDIDATE IDENTITY

> ## 3.1.1 · RC SUPERSEDED — 2026-08-31
>
> **`RC-20260829-05` / `a42b209e4f70a6efed4f3dcdb654e0f994416594` is SUPERSEDED as the application candidate.**
> Its measurements remain true statements about `a42b209e` and are **not** withdrawn (§3.5 rule 11 does not fire — no premise was withdrawn; a new object was created).
>
> | Layer | Value |
> |---|---|
> | **Application / code RC** | **`5ca0d256a994fcab9e5beecfae8b8513d2799446`** |
> | Superseded RC | `a42b209e4f70a6efed4f3dcdb654e0f994416594` |
> | Delta, RC → new RC | **4 paths, all `M`** — `.github/workflows/apply-migration.yml`, `.github/workflows/verify-schema-dependencies.yml`, `functions/_seo.ts`, `docs/PROMOTION_LEDGER.md`. **0 added, 0 deleted.** `+1,340 / −172` |
> | Scope vs `main` | **138 files · 31 A · 107 M · 0 D · +10,234 / −1,299.** Symmetric difference against the reviewed 138 set: **EMPTY, per item** |
> | Reason | Closure of the `run:`-interpolation injection path in two workflows, and the JSON-LD escape in `functions/_seo.ts` |
> | Commits | `fb881eec164869f2a34968556702af5fc72dd467` (workflows) · `5ca0d256a994fcab9e5beecfae8b8513d2799446` (`_seo.ts`) |
>
> **Provenance, recorded because it bears on the weight of the evidence:** both commits were authored and pushed by the audit/compiler session on the owner's explicit ruling of 2026-08-31, against a specification **pre-registered and published at 08:19:50Z, before the patch was written** (`claude/PRE_REGISTERED_PATCH_SPEC_2026-08-31.md`, sha256 `691e0a4a56cf9d77a31c14d8598cfa032bed449790994d4d256fc54327e181e3`).
>
> **This is NOT Developer 1's `rc-replacement/option2-2026-08-30` at `9384ba9a…`.** That branch was never pushed — `git fetch origin 9384ba9a…` returns **`fatal: remote error: upload-pack: not our ref`**, the provider's own statement that the object does not exist here. **None of its measurements are inherited**, including the `+36 / −7` delta, which must not be quoted for this candidate (§3.5 rule 15).
>
> **The patch's author and its first checker were the same party**, which is weaker than this ledger's standard. Mitigated, not cured, by (a) the pre-registered specification and (b) **independent re-measurement by Developer 1 at `5ca0d256`**, six of seven steps reproduced with figures printed, the seventh completed by provider read.

---

## Replace the §11 G3 sub-row

> | | runbook §5.3 secret-isolation probe | throwaway branch + echo-only workflow, no `environment:` key | **Run `33378911297`, 2026-08-31, branch `scratch/g10-53-secret-isolation-20260831` at head `9c556b8ebe4f480b85b4b415a48cd95b1d846180`, parented on candidate `5ca0d256`. Workflow blob sha256 `4da0826127e32f950cdf79750dc3cb1a054c585ebb053f573bff679f65ca42a0`, byte-identical to the 2026-08-26 design. Step log line 12 read verbatim: `EMPTY`. `NON-EMPTY` absent from the log. Job `probe` succeeded in 4s; all three steps green. Branch deleted and cleanup proved: 0 `secret-isolation` refs, remote branch count restored to its pre-probe 119, `main` and `staging` unmoved, 0 tags** | ✅ **CLOSED** | **VERIFIED** |
>
> *Design closure, verified from source at `9478cf76`: the job has exactly one step, no `if:`, no `continue-on-error`, and no `environment:` key — that absence is the test. `EMPTY` exits 0; `NON-EMPTY` exits 1. A `success` conclusion is therefore reachable only via the EMPTY path. The prior run `32950030302` of 2026-08-26 passed but was **stale by construction** — different candidate, five days earlier — and was re-taken rather than inherited, per §5.3.6, §12.4 step 7 and §19.*

---

## Replace the §11 G6 row

> | **G6** | Production-lane cross-reference negative test; forbidden-ref guard fires in both directions | Six executed negative tests, 2026-08-22 — `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md` | **N-PROD-1 FAIL [R3] exit 1** (production bundle carrying a staging ref) · **N-PROD-3 PASS exit 0** (ref belonging to neither lane — the discriminating control) · N-PROD-2 FAIL [R6] · N-PROD-4 FAIL [R8] · N-STG-1 FAIL [R3] · P-1 PASS · 12/12 mutants held. **Production Cloudflare Pages variable `ISOLATION_FORBIDDEN_REFS` NOT READABLE from any session to date** | ⚠ **AMBER** | **VERIFIED** (guard, both directions) + **OWNER-ATTESTED** (Pages variable) |
>
> *Corrected at REV-17. The prior row read "not separately evidenced in the record available to this compiler — NOT ESTABLISHED — BLOCKED". **That was stale, not empty**: the evidence existed in the project and not in this ledger. **Prior wording preserved, per the owner's standing rule.** To reach GREEN, one observation is still required and only the owner can take it: the next production Pages deploy log line reading `forbidden=[ztzutckwdhetphwghuzj]`, captured and recorded.*

---

## New §25.8 — CLOSURE

> ## 25.8 · §25 CLOSED BY OWNER ACCEPTANCE — 2026-08-31
>
> **All eight §25.3 rows are closed under §25.7.3's second limb — *"recorded as a named residual risk the owner has accepted in writing"* — the D-12 / B13 pattern.** Signed acceptances: `claude/S25_ACCEPTANCES_DRAFT_FOR_OWNER_2026-08-31.md`, Row 5 re-drafted after the replacement candidate landed.
>
> **These eight rows are closed by acceptance, not by verification. No row was verified by a second party. This is the weaker of the two routes §25.7.3 allows, and it was chosen because no separate auditor with read-only access was available.**
>
> **Every row's class is OWNER-ATTESTED. None is VERIFIED. A future reader must be able to tell an accepted risk from a verified one at a glance.**
>
> | Row | What is being carried |
> |---|---|
> | 1 | Production `ad_creative_comments` has **7 policies where staging has 9**. Both missing are RESTRICTIVE: a banned user can comment on ads, and ad comments are readable regardless of the parent creative's visibility. **Fixed by D-10, post-merge — not by this promotion** |
> | 2 | Staging's 9-policy state, measured; the control that makes row 1 legible |
> | 3 | `submit-judge-decision` v23 serves `Access-Control-Allow-Origin: *` to any origin, probed as served. No `allow-credentials` on any probe, which bounds it. **50 of 71 deployed bundles differ from the candidate.** §23.5.1 condition 2 excludes all function deployment from this release |
> | 4 | R2 token `73a7920647481fd93553f9c1f68bf5a3` — one bucket scope (`50mm-staging`), **TTL Forever, no IP filtering**. Lane separation holds; no token spans both buckets |
> | 5 | Both environments carry `SUPABASE_DB_URL`. **The injection path that made this dangerous was closed at `5ca0d256`.** What remains: a live credential reachable by legitimate dispatch with no required reviewer and no wait timer, and a patch whose author and first checker were the same party |
> | 6a | **Both R2 buckets report Public Access: Enabled**; production holds a `national-ids/` prefix under that setting |
> | 6b | `isolation-probe/` returns 0 objects in both buckets. **After-only — no before-baseline exists for run `33079091310` and none can be created retroactively.** The permanent absence of that baseline is part of what is accepted |
> | 6c | **First measurement ever taken, and expressly NOT a pass.** Zero reusable Access policies; one legacy policy covering `*.lens-lustre-learn-claude.pages.dev` only, MFA Off. **No Cloudflare Access application covers `staging.50mmretina.com`.** Trap for re-checkers: the Applications page shows a plan paywall that reads as "nothing configured" — the **Legacy tab** must be opened |
>
> **§26 blocker 1 (§25 PARTIAL) is CLOSED.**

---

## Append to §14 — CORRECTION REGISTER

> | **C-30** | The compiler published **F-49**, asserting that the runbook §5.3 secret-isolation probe *"does not exist"*, as a blocker-class finding | 2026-08-31 | **Found by the compiler, within the hour, before it reached a decision.** The probe exists, fully specified, in this project — `claude/WS4_PACK_SOURCE/05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md` (revision 6), `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md`, `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md`. **The git repository was searched exhaustively; the project was not searched at all**, and an absence claim was published from inside the wrong boundary | **F-49 WITHDRAWN IN FULL. Original wording preserved.** What survives is narrower: the ledger cites a runbook not present in the repository — a **traceability gap**, §28.3, not a blocker. **New standing rule 17** |
> | **C-31** | `TRANCHE_4…§4` stated *"Remote branches: `main`, `staging`, `altisinfonet-patch-35` — and nothing else."* | 2026-08-31 | **Found by the compiler while correcting C-30.** The instrument was `git branch -r` — the local clone's fetched refs, not the remote. `git ls-remote --heads origin` returns **119 branches** | **Corrected. No conclusion changes and one strengthens**: `rc-replacement/option2-2026-08-30` is confirmed absent from `origin`, and `9384ba9a` is rejected by the remote as **"not our ref"** — the provider's own statement, stronger than the original inference |

## Append to §3.5 — STANDING RULES

> **16. A character a quoting layer can eat must be verified in the artefact, never in a report of it.** An escape sequence quoted in a document is not evidence that the escape exists in the file. Byte inspection — `od -c`, `xxd`, a hash — is the only instrument that settles it. *Earned three times in one day on a single line of `functions/_seo.ts`: the original patch document ate the escape, the compiler's relay carried the error, and the verification report ate it again. **The repository was correct throughout; every failure was in a description of it.***
>
> **17. An absence is only as wide as the space searched, and the claim must name that space.** *"X does not exist"* is never a finding. *"X does not appear in \<enumerated space\>, searched by \<instrument\>"* is. Before publishing any absence, enumerate every store the thing could be in and state which were searched and which were not. *Earned twice in two hours — C-30 and C-31.*

---

## New §21 entry — REPOSITORY EVENTS

> | 2026-08-31 | **Two commits to `staging`** — `fb881eec` (two workflows), `5ca0d256` (`functions/_seo.ts`) | Audit/compiler session, on the owner's explicit ruling | Authorised. Uploaded byte-for-byte rather than retyped; pushed bytes hash-match the tested files. No pull request opened. No force-push, no rebase. CI fired automatically and **that run satisfied §24.1 step 6a** |
> | 2026-08-31 | **`SUPABASE_DB_URL` created on the `staging` GitHub Environment**, ~07:35Z, verified present 07:40:40Z | **The owner**, in his own browser. The compiler entered no value and the guard refused every keystroke into that dialog | Satisfies §24.1 step 4, which had been **FAILING**. It also **created** the exposure that §25.3 row 5 named, which the patch above then closed |
> | 2026-08-31 | Probe branch `scratch/g10-53-secret-isolation-20260831` created (`9c556b8e`), run `33378911297` — **`EMPTY`**, branch deleted, cleanup proved from the remote | **The owner**, in his own browser; verified from the remote and the provider by the compiler | runbook §5.3, **re-taken at `5ca0d256`** rather than inherited. One file added, `+43`, byte-identical to what was issued. **No `environment:` bound, so NO deployment record was created.** Residue: the run record and its logs persist and cannot be removed |
> | 2026-08-31 | **A commit directly to `staging` was stopped before it happened** | Caught by the compiler from the owner's screenshot of the commit dialog, which was set to *"Commit directly to the `staging` branch"* | Had it landed it would have moved the RC **and** inverted the probe's meaning — on a lane branch the secret is *supposed* to resolve. `staging` measured unmoved at `5ca0d256` throughout |

---

## §11 SIGNATURE BLOCK

> ## 11.1 · OWNER APPROVAL — §11
>
> **I approve the promotion of `5ca0d256a994fcab9e5beecfae8b8513d2799446` to `main`.**
>
> I have read §11 and I record what I am approving:
>
> - **§25 is closed by my written acceptance, not by verification.** Eight named residual risks, every one OWNER-ATTESTED. No second party verified any of them.
> - **G6 is AMBER, not GREEN.** The guard is proven in both directions; the production Cloudflare Pages variable has never been read and remains owner-attested.
> - **G9 is excluded from this release** under §23.5.1 condition 2. `submit-judge-decision` keeps answering `Access-Control-Allow-Origin: *` in production after this merge, and 50 of 71 deployed bundles differ from the candidate. **Merging does not deploy any edge function.**
> - **D-10 / AF-17 is not done by merging.** Until I dispatch `20260828082136` against production, a banned user can comment on ads and ad comments ignore the parent creative's visibility.
> - **F-47 is knowingly left in place** — `web-build.yml`'s `lane-guard` carries the same construct that was patched elsewhere. It is LATENT under the configured triggers, and it lands on `main` with this merge.
> - **The security patch in this candidate was authored and first checked by the same party**, then independently re-measured by a developer who did not write it.
>
> **Anyone reading "11 green" on this candidate is reading something that does not exist.**
>
> Approved by: `______________________`  ·  Date (UTC): `______________`  ·  Candidate: `5ca0d256a994fcab9e5beecfae8b8513d2799446`

---

## ⚠ THE TAG — read this before you cut it

**The commit you make from this document MOVES THE HEAD.** Do not tag `5ca0d256`.

```
git fetch origin
git rev-parse origin/staging     # <- THIS is the tag target
```

Tagging `5ca0d256` would tag a tree that predates your own signature. **Sign → commit → freeze → `rev-parse` → tag → merge.** The tag must exist before the merge (§17-10).
