# REVIEW — UPDATED MASTER CONTROL ADDENDUM (G1–G10 RELEASE CONTROL)

Reviewed 2026-08-22 against this session's measured evidence.
Verdict: **strong, and not yet safe to run as written.** One self-contradiction
would hard-stop G10 on itself. Eleven other items ranked below.

---

## 🔴 BLOCKER — §I step 10 contradicts how this repository merges

> §I.10 — *"Verify main SHA/tree equals the approved staging RC SHA/tree."*

**SHA equality is impossible here.** This repo squash-merges. Measured this
session: PR #87's branch tip `a7004b205e2760140dc5aa8ee6cf0b7fb4425c64` has a
tree **byte-identical** to `main`'s (`a0c3f34d724867f0a10fc768f6987e21fd4ddbfa`),
yet the tip is **not an ancestor of `main`** — squash produced a new commit.

So G10 step 10 fails on a perfectly correct promotion, and §J's first hard-stop
("staging tree differs from approved RC tree") fires on a false premise.

**Fix — pick one and state it:**
- **Tree equality only.** `main^{tree} == <rc-tag>^{tree}`. Survives squash,
  rebase and merge-commit alike. This is what the earlier design specified and
  what PR #87 was actually verified with.
- Or mandate `--ff-only` and **forbid squash/rebase merges on `main`** — which
  requires branch-protection settings that **do not exist yet** (see 🟠 2).

Whichever is chosen, §I.9's "approved PR/fast-forward mechanism" needs to name it
precisely; "PR/fast-forward" currently permits three merge strategies with three
different outcomes.

---

## 🟠 HIGH

### 1 · No distinction between VERIFIED and OWNER-ATTESTED

G0's state ladder has no state for *"a person says so and no session can check."*
Yet several controls in this plan are **structurally unverifiable** by the session
executing them — GitHub branch protection, GitHub Environments, repository-secret
deletion, Cloudflare Pages settings, R2 token scope. In this session all of those
returned HTTP 403 or had no API at all.

Today a screenshot and a machine-checked digest occupy the same cell in the
ledger. That is the single biggest structural weakness in the document.

**Add:** every control names a **verifier** and a verification class —
`INDEPENDENTLY-VERIFIED` / `OWNER-ATTESTED` / `UNVERIFIABLE-BY-DESIGN`. An RC may
contain attested items; it may not contain attested items that were never
declared as such.

### 2 · `main` has no branch protection, and the plan assumes it does

G2 step 3 was never completed — no tool in any session can set it, and it is not
in §M's sequence or §X's owner actions. §I.9 depends on it. **Add it to the owner
list explicitly**, or G10's promotion mechanism has no enforcement behind it.

### 3 · §J "production credential accessible to staging" has no instrument

The condition is right; the proof is unnamed. The only real instrument found this
session: **delete the repository-level secret, then run a throwaway workflow on a
non-lane branch and observe the reference resolves empty.**

And it must be **re-run at G10**, not inherited from G3 — a repository secret can
be re-added at any moment in between. Evidence of a negative is only valid at the
instant it is taken.

### 4 · Every readiness probe needs a discriminating control

§F says gating behaviour must be "recorded so a gated URL is never mistaken for a
missing deployment." The real lesson from G1 was sharper and is not captured:
after Cloudflare Access was enabled, **a gated deployment and a deployment that
never existed returned an identical response.** Proved by probing
`00000000.<project>.pages.dev` — a hash that never existed — and getting the same
result as a real one.

**Add as a rule:** a probe is evidence only when accompanied by a **known-present
and a known-absent control** that the instrument can distinguish. Otherwise the
probe measures the instrument, not the system.

### 5 · Nothing addresses staleness of the verification tooling itself

A plan this strict about evidence says nothing about the instruments caching.
This session's fetch tool caches 15 minutes per URL; that nearly produced a false
RED in G1, and carries a false-GREEN risk wherever "still 404" is the expected
answer.

**Add:** every probe records its timestamp and its instrument's cache TTL. **A
probe taken less than one TTL after the mutation it is testing is void.**

### 6 · Standing rule missing — harness hermeticity

Rule 9 covers RED baselines and mutant retargeting. G3 produced a third, distinct
failure: **a harness that inherits ambient environment silently asserts the wrong
rule.** The lane job sets `VITE_SUPABASE_URL` and `ISOLATION_FORBIDDEN_REFS` at
job level; they leaked into the harness and turned `RED-3` into an R2 assertion
and `RED-8` into an R5 assertion. Two cases quietly testing something else, in a
harness whose entire job is to notice that.

**Add as standing rule 12:** *a harness testing for the absence of a variable must
strip that variable from the inherited environment. A harness is evidence only if
it is hermetic.*

---

## 🟡 MEDIUM

### 7 · §B Change Ledger is unspecified

§C's RC record is fully itemised; §B is one sentence. Since §D requires every
difference to link to a Change ID, the ledger needs a schema or two sessions will
invent two formats. Minimum fields: **Change ID · date · gate · actor · objects
touched · classification (§D taxonomy) · originating finding · evidence link ·
environment impact (§L) · superseded-by.**

### 8 · §N will be wrong within hours of being written

It already is: it records G4 as AMBER pending the ACAO decision and staging
variable wiring — both closed at `a9f5b80`, verified by rebuilding both lanes and
hashing the artefacts. A status snapshot inside an authoritative document
guarantees the document and reality disagree.

**Fix:** §N should point at the dated ledger, not restate it.

### 9 · The Android lane is undefined at the moment it matters

§A requires every production-intended change to be verified on staging.
`android-build.yml` builds from `main` and bundles `dist` — so promoting a web RC
silently changes what the next Android build ships. §C lists "Android
artifact/versionCode **where applicable**" and never defines applicable.

**Decide and state:** does a web RC require a matching Android build, or is the
Android track explicitly decoupled with its own RC? Both are defensible; silence
is not.

### 10 · §H "no staging action may mutate production" — half-instrumented

§G's G8 correctly demands proof that staging cannot write the production bucket.
There is no equivalent for the **database**. Name it: staging holds only the
staging URL and staging keys, production's service-role key is absent from
staging secrets, and staging's own `site_settings` contains no production
credential.

### 11 · G9's definition misses a discovered hard prerequisite

§G's G9 says "deploy Edge Functions only to staging ref; synthetic data only." It
omits what this session found: `supabase/functions/_shared/secureHeaders.ts:7-8`
is a CORS allow-list containing only the two production origins. Staging's origin
is absent, so **the moment staging edge functions deploy, every preflight from
`staging.50mmretina.com` is refused and the staging app does not function.**
Same for ~17 email templates hardcoding the production origin.

G9 should name both as prerequisites, not discoveries.

### 12 · §M implies G6 is untouched work

G6 is already partly done: `ISOLATION_FORBIDDEN_REFS=ztzutckwdhetphwghuzj` was set
on the production Pages project, and `web-build.yml`'s production lane no longer
passes `""`. G6 now reduces to **proving the Pages variable and the CI literal
agree** — which is a different, smaller task than the sequence implies.

---

## WHAT THE ADDENDUM GETS RIGHT

Worth stating, because these are not common:

- **§D's UNINTENDED-difference hard stop.** Most release processes review a PR;
  this reviews the *delta as a manifest* and treats an unclassified difference as
  a stop. That would have caught the ACAO change in G4 automatically.
- **§L's environment-impact field** (CHANGED / READ ONLY / UNTOUCHED) — small
  addition, large effect: it makes "I only read" a recorded claim rather than an
  assumption.
- **§E's "never execute a production migration solely because its file exists on
  main"** — precisely the 618-migration trap this project already has.
- **§K making rollback itself a ledger event.** Rollbacks are where history
  usually gets erased.
- **§J's completeness.** Eleven hard stops, each independently checkable.
