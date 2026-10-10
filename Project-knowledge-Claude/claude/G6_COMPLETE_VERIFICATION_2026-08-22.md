# G6 — COMPLETE REMAINING VERIFICATION · G3 §5.3 BLOCKED

**Governing plan: Master Execution Plan Rev 3.0 only.** No Rev 3.1 is referenced.
**Run window:** 2026-08-22 17:19–17:24 UTC · Cowork session, `claude-opus-5`.
**Tree under test:** `9aea8a30916fee06a741c52ef34914e4a2788f96` (`staging`).
**Repository mutations this run: ZERO.** `git status` clean before and after;
HEAD unchanged; nothing pushed; `origin/main` untouched at
`32930e75b1d87d361f44e4b4f90dabf9deeda3e1`.

---

## 1. G3 §5.3 — NOT EXECUTED · UNVERIFIABLE-BY-DESIGN in this session

Re-tested at **17:22:22 UTC**, not carried forward from the earlier run:

```
$ git push --dry-run origin HEAD:refs/heads/scratch/secret-isolation-20260822
remote: access denied by the git proxy: altisinfonet/lens-lustre-learn-Claude
        is not in this session's authorized repository set, so the proxy will
        not inject a credential for it. To fix, add the repository to the
        session's sources.
fatal: … The requested URL returned error: 403
$ gh …            → gh not installed
```

§5.3 requires **creating a branch, pushing it, and observing a workflow run**.
Every one of those three is a write this session is refused. No local
substitute exists: the property under test is what GitHub Actions resolves for
`secrets.SUPABASE_DB_URL` on a branch outside both environments' deployment
policies. That is only observable from inside a real Actions run.

**Requested record fields, honestly returned:**

| Field | Value |
|---|---|
| Exact branch | **NOT CREATED** — push refused |
| Workflow / run ID | **NONE** |
| Timestamp | Refusal observed 2026-08-22 17:22:22 UTC |
| Literal `EMPTY` result | **NOT OBTAINED.** No claim is made in either direction |
| Evidence classification | **UNVERIFIABLE-BY-DESIGN (this session)** — executable by any push-capable session |
| Branch deletion confirmation | Not applicable; no branch was created |

The proxy names its own remedy: **add the repository to this session's sources.**
That is an owner action and it converts §5.3 from unexecutable to executable
here. It is listed as owner action 7.

**G3 remains AMBER.** The card — branch name, the exact `secret-probe.yml` with
no `environment:` key, the two permitted output strings, and the prohibition on
printing the value, its length, hash, prefix, suffix or any derived form —
stands unchanged in `G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md` §3.

---

## 2. G6 — REMAINING VERIFICATION COMPLETE

No change to the guard, the harness, the workflows or any lane configuration.
Both lanes were built **for real** in this session from the two build jobs' own
public environment values, read verbatim from `.github/workflows/web-build.yml`
at `9aea8a3` (lines 72–93 production, 136–153 staging). No secret participates
in a build lane. No deployment. No production data touched.

### 2.1 The two artifacts

| | Production lane | Staging lane |
|---|---|---|
| JS chunks | 244 | 244 |
| Assets scanned | 263 | 263 |
| `dist` digest over sorted set | `f0e2376d3b9e8556760f1c31fb37b15499f6fe106b1a53152c216e366ced73c8` | `2808e91b6f99b31060d020ea2e8f8d3d76f94240eff26f016c8942f8066eb003` |
| `_headers` sha256 | `40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0` | `3463341c5ce6fe68227a4d06adc67f91d112d9812be463a368483f4d524bf122` |
| ACAO emitted | `https://50mmretina.com` | `https://staging.50mmretina.com` |

The production `_headers` hash is **byte-identical to the recorded production
artifact** in Rev 3.0 Appendix B — an independent re-proof of G4 from a build
performed in this session, not a citation of a prior report.

**Cross-contamination census, whole-tree grep:**

```
files in the staging bundle containing jtdtehuqtinjxropkkcn : 0
files in the production bundle containing ztzutckwdhetphwghuzj: 0
```

### 2.2 The four required tests, plus their controls

| ID | Test | Expected | Observed | Class |
|---|---|---|---|---|
| P-1 | Production lane vs its own clean bundle | PASS | `PASS: expected=jtdtehuqtinjxropkkcn present; forbidden=[ztzutckwdhetphwghuzj] absent; host=cdn.50mmretina.com present; forbidden-hosts=[cdn-staging…,staging…] absent; 263 assets scanned` · exit 0 | VERIFIED — known-present control |
| S-1 | Staging lane vs its own clean bundle | PASS | `PASS: expected=ztzutckwdhetphwghuzj present; forbidden=[jtdtehuqtinjxropkkcn] absent; host=cdn-staging.50mmretina.com present; forbidden-hosts=[cdn…,www…,https://50mmretina.com] absent; 263 assets scanned` · exit 0 | VERIFIED — known-present control |
| **N-PROD-1** | **Production bundle containing the staging ref** | **FAIL R3** | `FAIL [R3]: forbidden backend ref(s) present in bundle: ztzutckwdhetphwghuzj in index.html` · **exit 1** | **VERIFIED** |
| **N-STG-2** | **Staging bundle containing the production ref** | **FAIL R3** | `FAIL [R3]: forbidden backend ref(s) present in bundle: jtdtehuqtinjxropkkcn in index.html` · **exit 1** | **VERIFIED** |
| **N-PROD-2** | **Production lane, forbidden list empty** | **FAIL R6** | `FAIL [R6]: ISOLATION_FORBIDDEN_REFS is empty — a lane that forbids nothing is not isolated…` · **exit 1** | **VERIFIED** |
| **N-STG-4** | **Staging lane, forbidden list empty** | **FAIL R6** | same R6 text · **exit 1** | **VERIFIED** |
| N-PROD-3 | Production bundle + a ref belonging to **neither** lane | PASS | `PASS … 263 assets scanned` · exit 0 | VERIFIED — **known-absent control** |
| N-STG-3 | Staging bundle + a ref belonging to **neither** lane | PASS | `PASS … 263 assets scanned` · exit 0 | VERIFIED — **known-absent control** |
| N-PROD-4 | Production bundle + a staging **host** only | FAIL R8 | `FAIL [R8]: cdn-staging.50mmretina.com in index.html; staging.50mmretina.com in index.html` · exit 1 | VERIFIED |
| N-STG-1 | Staging lane guard vs the real production bundle | FAIL R3 | `FAIL [R3]` naming `_redirects`, `AdminSEO-BXdN_0Lh.js`, `JudgePanel-Duz2PlJV.js`, `Unsubscribe-PSRGhf8c.js`, `index-BzKbxo1m.js` | VERIFIED |

**Why the controls matter.** N-PROD-3 and N-STG-3 are the same bundles as
N-PROD-1 and N-STG-2, differing only in the ref inside one appended HTML
comment. Both controls PASS. The R3 refusals are therefore caused by the
foreign ref specifically — not by the act of editing `index.html`, not by the
comment, not by file size. Without them the refusals would measure the
instrument rather than the system (Rev 3.0 §5.1, Rule 1).

**R6 evidence preserved and extended.** The executed R6 proof remains in
history as the `ec1a3b9` / `44e3e92` pair on `staging`; N-PROD-2 and N-STG-4
now demonstrate it live on **both** lanes' real bundles, and harness cases
RED-7 / RED-8 pin it against regression.

**Harness re-run on this tree at 17:15 UTC:** 33 results, 0 failures,
**12 of 12 mutants held**.

### 2.3 CI literal — read directly from the tree

`.github/workflows/web-build.yml` @ `9aea8a3`, job `build-production`:

```
ISOLATION_FORBIDDEN_REFS:  ztzutckwdhetphwghuzj      ← the staging ref, as required
ISOLATION_EXPECTED_HOST:   cdn.50mmretina.com
ISOLATION_FORBIDDEN_HOSTS: cdn-staging.50mmretina.com,staging.50mmretina.com
```

Job `build-staging` carries the exact inverse. **Classification: VERIFIED.**

### 2.4 The Pages half — UNVERIFIABLE-BY-DESIGN, kept OWNER-ATTESTED

The production Cloudflare Pages variable `ISOLATION_FORBIDDEN_REFS` **cannot be
read here.** The Cloudflare tooling available to this session was enumerated
directly and covers **D1, KV, R2, Workers, Hyperdrive and documentation search
only — there is no Pages project, Pages settings, Pages variable or Pages
deployment tool.** Pages build logs are equally unreadable.

No indirect probe discriminates. The production site being up is equally
consistent with the variable holding the staging ref, holding something else,
or the guard never having run at that value. Under §5.1 that is signal
saturation, so **no claim is made in either direction, and it is not converted
to a PASS.**

**Classification: OWNER-ATTESTED / UNVERIFIABLE-BY-DESIGN.**

### 2.5 G6 verdict

**AMBER.** Every mechanically verifiable exit condition is now met by executed
refusals, in both directions, on real bundles, each with a discriminating
control. The single outstanding item is not a test anyone can run here.

**The one observation that would move G6 to GREEN:** the next production Pages
deploy log line reading `forbidden=[ztzutckwdhetphwghuzj]`, captured and
recorded by the owner. Owner action 6.

---

## 3. CHANGE LEDGER

| Field | **CHG-20260822-003** |
|---|---|
| Change ID | CHG-20260822-003 |
| Branch | `staging` — **read only, not modified** |
| Before SHA / tree | `9aea8a30916fee06a741c52ef34914e4a2788f96` / `aa877b50d3ca329aa0c169a150700fd9887a7d9a` |
| After SHA / tree | `9aea8a30916fee06a741c52ef34914e4a2788f96` / `aa877b50d3ca329aa0c169a150700fd9887a7d9a` — **identical** |
| Files changed | **NONE.** `git status` returned 0 lines before and after. Two ephemeral `dist` builds and four `/tmp` copies, all deleted at 17:24 UTC |
| Reason | Rev 3.0 §8.4 — complete G6's remaining verification without redesigning the guard |
| Environment impact | Rev 3.0 §16: read-only against "GitHub Actions workflow files". **No production surface. No deployment. No production data. No Cloudflare, Supabase or R2 mutation** |
| Verification evidence | §2.2 of this record — ten executed tests with raw guard output and exit codes; §2.1 digests |
| Rollback reference | **Not applicable — nothing to roll back.** Had a mutation occurred, the target would be tree `aa877b50d3ca329aa0c169a150700fd9887a7d9a` |
| Classification | VERIFICATION-ONLY |

| Field | **CHG-20260822-004** |
|---|---|
| Change ID | CHG-20260822-004 |
| Branch | None — `scratch/secret-isolation-20260822` was **not created** |
| Before / after SHA | Unchanged; no ref written |
| Files changed | NONE |
| Reason | Rev 3.0 §5.3 secret-isolation negative test, requested for execution |
| Environment impact | None |
| Verification evidence | Push refusal transcript, §1, timestamped 17:22:22 UTC |
| Rollback reference | Not applicable |
| Classification | CAPABILITY-BOUNDARY — closes when owner action 7 or 5 is taken |

---

## 4. OWNER CRITICAL PATH

| # | Action | Unlocks | Status |
|---|---|---|---|
| 1 | DNS: `staging.50mmretina.com` | **G7**, and downstream G8, G9, the whole §15 matrix | NXDOMAIN |
| 2 | DNS: `cdn-staging.50mmretina.com` | **G7 / G8** — no servable staging CDN without it | NXDOMAIN |
| 3 | Production Pages `SUPABASE_PROJECT_REF` | **G5b** (with 4) | Absent |
| 4 | Production Pages `SUPABASE_ANON_KEY` | **G5b** — until both exist, removing the `functions/_seo.ts` defaults breaks production edge SEO | Absent |
| 5 | Branch protection on `main` | **G10** — hard stop HS-12 | Never configured |
| 6 | Capture the next production Pages deploy log line `forbidden=[ztzutckwdhetphwghuzj]` | **G6 AMBER → GREEN** — the only remaining item | Not readable by any session |
| 7 | Add `altisinfonet/lens-lustre-learn-Claude` to this session's authorized sources, **or** authorize a push-capable session | **G3 AMBER → GREEN** via §5.3 | 403 at 17:22:22 UTC |
| 8 | Delete `scratch/lane-check-g3`, close PR #88 | Nothing — housekeeping | Present |

**Items 1 and 2 are the critical path.** Nothing downstream of G7 can begin
until both resolve, and G6, G5b and G3 closing does not shorten that path.

---

## 5. GATE STATUS

| Gate | Status | Classification of the deciding evidence |
|---|---|---|
| G0 | GREEN | VERIFIED — capability limits established by test |
| G1 | GREEN | OWNER-ATTESTED + independently probed at host level |
| G2 | GREEN | VERIFIED |
| G3 | **AMBER** | §5.3 UNVERIFIABLE-BY-DESIGN here; environments and secret deletion OWNER-ATTESTED |
| G4 | GREEN | VERIFIED — `_headers` re-proven byte-identical this run |
| G5a | GREEN | VERIFIED — 12/12 mutants, both lanes clean at 263 assets |
| G5b | OPEN | Prerequisite unsatisfied — not attempted |
| **G6** | **AMBER** | Guard side VERIFIED both directions with controls; Pages side OWNER-ATTESTED |
| G7 | OPEN | Hard-blocked on DNS — not attempted |
| G8 | OPEN | Depends on G7 — not attempted |
| G9 | OPEN | Depends on G7 — not attempted |
| G10 | BLOCKED | HS-12 live — not attempted |
