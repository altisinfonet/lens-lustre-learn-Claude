# The independent test-suite re-run — bound to the current candidate head

Date: **2026-08-31T05:12:15Z → 05:15:18Z** · Full transcript: `TESTSUITE_RERUN_FULL_TRANSCRIPT.txt`
(**587,432 bytes**, 3,043 lines, sha256 `07aab9fe7087de792da8d9df6ab22963d3e730c809cb25674b5b295db029854a`).
**Nothing here closes a §25 row (§25.4).**

---

## 1. Checkout identity — the run is bound to a sha, not to a description

```
$ git rev-parse HEAD
9384ba9aeef585f615148b208f13d68fdbe169f5
$ git symbolic-ref --short HEAD
rc-replacement/option2-2026-08-30
$ git status --porcelain
(empty — clean)
$ git diff --name-only a42b209e HEAD
.github/workflows/apply-migration.yml
.github/workflows/verify-schema-dependencies.yml
functions/_seo.ts
$ git log -1 --format='%H %cI %s'
9384ba9aeef585f615148b208f13d68fdbe169f5 2026-08-30T16:37:51+00:00 fix(rc): Option 2 — …
```

**Bound to `9384ba9`, the replacement RC head — not to `a42b209e`.** The order was to bind to the
current candidate; the replacement RC is the candidate the owner authorised, and its three-file delta
includes `functions/_seo.ts`, which the suite can reach.

> **Stated so it cannot be misread: `9384ba9` is NOT ADOPTED.** It is not pushed, not merged, not
> tagged, and §11 is unsigned. The frozen RC remains `a42b209e`. **If the replacement RC is not
> adopted, this run does not stand for `a42b209e`** — the two differ by `functions/_seo.ts`, and a
> run bound to one is not evidence about the other. The prior run against `a42b209e` is
> `03_WO3/A5_CREDENTIAL_SCRUB_FULL_TRANSCRIPT.txt`.

## 2. Toolchain and lockfile

```
node v22.22.2   npm 10.9.7
sha256  package.json         (recorded in the transcript, §2)
sha256  package-lock.json    (recorded in the transcript, §2)
```

## 3. Credential-scrub proof — printed from inside the scrubbed environment

The suite ran under `env -i` with only `PATH`, `HOME`, `CI` set. **Every provider variable was
enumerated from inside that environment and printed empty**, and then the *entire* environment was
dumped — because listing the ones you thought of is not proof, and dumping all of them is:

```
   total environment variables visible to the suite: 6
   ENV: PWD=/home/claude/repo/src
   ENV: HOME=/root
   ENV: SHLVL=1
   ENV: PATH=…
   ENV: CI=1
   ENV: _=/usr/bin/env
```

**Six variables. Not one of them is a credential.** No `SUPABASE_*`, no `R2_*`, no
`CLOUDFLARE_API_TOKEN`, no `GITHUB_TOKEN`, no `AI_API_KEY`, no `ANDROID_*`. **The suite could not
have reached a live provider even if a test tried.**

## 4. Dependency install

```
$ rm -rf node_modules && npm ci
added 1012 packages in 41s
npm ci exit: 0
```

**`npm ci` from the committed lockfile** — not `npm install`, so the tree is the lockfile's, not
whatever resolved today.

## 5. Result

```
 Test Files  178 passed | 1 skipped (179)
      Tests  2475 passed | 1 skipped (2476)
   Start at  05:12:15
   Duration  183.13s
vitest exit code: 0
```

| | |
|---|---|
| **Test files** | **178 passed · 1 skipped · 0 failed** (179) |
| **Tests** | **2,475 passed · 1 skipped · 0 failed** (2,476) |
| **Exit code** | **0** |

> **On "0 failed", measured rather than asserted.** A naive `grep -cE '✗\|FAIL\|✘'` over the
> transcript returns **25** — every one of them is the literal string `FAIL` **inside a test name**,
> not a result line. `grep -cE '^ *FAIL \|^❯'` — the shapes vitest actually uses to report a failing
> file — returns **0**. The summary line and the exit code agree. **The 25 is a grep artifact and is
> reported here so nobody rediscovers it and thinks it was hidden.**

## 6. The one skipped test, named — and what it costs

```
↓ src/test/judging-invariants.test.ts > Phase R3 — judging data invariants
    > judging_invariants_check returns all 'ok'
```

**It requires a live service-role client.** Under the standing rule it is **BLOCKED, not skipped, and
was not run with real credentials** — running it would have required exactly the credential the scrub
in §3 removed.

> **This is the L-2 claim in the A15 claims document, now demonstrated on this run:**
> **wherever "2,475 passing tests" is cited, one judging invariant is unverified.** The number is
> real and the caveat travels with it.

**Count reconciliation:** 2,475 passed + 1 blocked = 2,476 collected. 178 files + 1 = 179.

## 7. What this run does and does not establish

**Does:** the suite at `9384ba9` passes with no provider credentials present, from a clean
`node_modules` built by `npm ci` off the committed lockfile, with a full per-test transcript and a
zero exit code.

**Does not:**
- It does not test `a42b209e`. It tests `9384ba9`.
- It does not exercise the judging invariant (§6).
- It does not test the two patched **workflows** — YAML in `.github/workflows/` is not covered by
  vitest. Their evidence is the A-3 §3d side-by-side and the trigger enumeration, not this run.
- It does not test **deployed** edge functions. §23.5.1 condition 2 excludes all function deployment
  from this release, and nothing here touches production.
