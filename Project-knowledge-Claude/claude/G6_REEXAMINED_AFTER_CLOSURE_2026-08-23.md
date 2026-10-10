# G6 — RE-EXAMINED AFTER CLOSURE

**Question asked:** is G6 fully closed?
**Answer:** GREEN stands as recorded, but it is **narrower than it reads**, and
three facts discovered after closure have eroded the property it implies.
**Date:** 2026-08-23. No gate state is changed by this document; it records what
a later reader must not assume.

---

## 1. What G6 actually proved

Rev 3.0 §8.4's exit conditions, each satisfied and each still standing:

| Condition | Class |
|---|---|
| Pages production variable and CI literal name the same forbidden ref | Pages side **OWNER-ATTESTED** (§8.4 itself permits this); CI side VERIFIED |
| Production build carrying a staging ref fails R3 | VERIFIED — exit 1 on a real production-lane build |
| Staging build carrying a production ref fails R3 | VERIFIED — exit 1 on a real staging-lane build |
| Empty forbidden list fails R6 on both lanes | VERIFIED, plus the `ec1a3b9`/`44e3e92` history pair |
| Known-absent controls discriminate | VERIFIED — both bundles carrying a neither-lane ref PASS |

Those are real, executed, and controlled. Nothing below retracts them.

## 2. What G6 did NOT prove, and what a reader will assume it did

G6 proves **R1–R6 behave correctly, and the production Pages project holds the
right `ISOLATION_FORBIDDEN_REFS` value**. It does not prove *the bundle
Cloudflare actually deployed was scanned by that guard at that value.*

### 2.1 The instrument was substituted — within the plan, but downward

Both G6 records name the closing observation explicitly:

> "the next production Pages deploy **log line** reading
> `forbidden=[ztzutckwdhetphwghuzj]`, captured and recorded by the owner."

What closed it instead was a **dashboard variable reading** (three ways: zoomed
capture, Home/End no-scroll check, direct input read, length 20). §8.4 permits
owner attestation for the Pages side, so this is legitimate — but a configured
variable and an executed guard are different propositions. The deploy-log line
is the only one that shows the guard ran. **It has still never been captured**
(owner action 6, open since 2026-08-22).

### 2.2 CI and Pages may build different bundles — this hits G6 directly

Recorded in `HS-1_ARCHITECTURE_RESOLVED_H-GAMMA_2026-08-22.md` §5 and still open:

- Pages serves entry chunk `index-CQNRLXfL.js`.
- A local build of the same commit (`main @ 32930e7`), same Supabase URL, key
  matching on length (208) and full read prefix/suffix, produced
  `index-DrppXY7Q.js`.
- The four vendor chunks **and** the CSS bundle match.

So dependencies and bundler agree while app-source-plus-environment does not.

**Why this matters to G6 specifically.** G6's argument is: the CI literal and
the Pages variable name the same ref, therefore the deployed lane is guarded.
That inference requires CI and Pages to be scanning the same artifact. If they
are not, the two guards are checking different bundles and the agreement of
their *configuration* proves less than it appears to.

Three unread Pages settings were offered as candidate explanations. One has
since been closed:

| Candidate | Status |
|---|---|
| Pages build command | **CLOSED** during G5b — `npm run build && node scripts/verify-bundle-isolation.mjs`, run from the repository root |
| `NODE_VERSION` | **still unread** |
| `VITE_SUPABASE_PROJECT_ID` value | name confirmed, **value still unread** |

This remains a gap in the reproduction, not a demonstrated defect. It is not
evidence of a leak. It is evidence that one link in G6's chain is unobserved.

### 2.3 The deployed guard was only half-armed until today

Discovered during G7, 2026-08-23: **`ISOLATION_EXPECTED_HOST` and
`ISOLATION_FORBIDDEN_HOSTS` were unset on BOTH Cloudflare Pages projects.**

Host rules R7–R10 were introduced at G5a and verified in CI — G6's own §2.2
test N-PROD-4 shows R8 firing correctly, and §2.3 records the CI literal
carrying both variables. But CI is not what ships. The guard that ran inside the
Pages build command enforced **R1–R6 only**. A production bundle naming
`cdn-staging.50mmretina.com` or `staging.50mmretina.com` would have deployed.

This is G5a/G7 scope rather than a G6 exit condition, and G6's GREEN does not
depend on it. It matters here because reading "G6 GREEN — the deployed lane is
guarded" and picturing a fully-armed guard would have been wrong for the entire
period since G5a landed.

Both variables were added to both projects today. They take effect **on each
project's next deployment** and have **never yet run in a shipped build**.

### 2.4 The guard changed after G6 closed

G5b (merged at `d33c91e`) added **R11** and multi-root scanning of `functions/`.
The Pages build command now runs a guard whose newest rule G6 never exercised in
a deployment. G5b verified R11 locally and in CI; the deployed-build half
inherits the same gap as 2.1.

---

## 3. Verdict

**G6 = GREEN — COMPLETE**, unchanged, correctly earned against §8.4.

**Scope it should be read with:** G6 proves the ref-comparison rules work and
that the production Pages project is *configured* with the correct forbidden
ref. It does not prove the deployed artifact was scanned, does not cover host
rules R7–R10, and does not cover R11.

Reopening G6 would be wrong — its exit conditions were met and the substitution
it relied on is one §8.4 authorises. Treating it as proof that production ships
behind a fully-armed guard would also be wrong.

## 4. WORTH WATCHING

Ordered by how much each would change the picture if it went the wrong way.

| # | Watch | Why it matters | Closes when |
|---|---|---|---|
| 1 | **The next production Pages deploy log** — the guard's own PASS line | It is the single observation that converts "configured" to "executed", and it now also reports the host rules and the root count. Expect `expected=jtdtehuqtinjxropkkcn present; forbidden=[ztzutckwdhetphwghuzj] absent; host=cdn.50mmretina.com present; forbidden-hosts=[…] absent; … 2 root(s): dist, functions` | Owner captures the line. Long-open owner action 6 |
| 2 | **The staging Pages deploy on the G7 merge** | First shipped build anywhere to carry R7–R10. If it fails, suspect the two new host variables before the robots change. `ISOLATION_FORBIDDEN_HOSTS` on staging contains `https://50mmretina.com` scheme-qualified — bare apex would trip R9 against staging's own hostnames | That deploy goes green and its guard line is read |
| 3 | **The entry-chunk divergence** | If Pages and CI build different artifacts, every gate that reasons "CI verified it, therefore the deployed thing is verified" is weakened — not just G6 | `NODE_VERSION` and `VITE_SUPABASE_PROJECT_ID` are read from the Pages dashboard and a local build reproduces `index-CQNRLXfL.js`, or the difference is explained |
| 4 | **`cdn-staging.50mmretina.com` is still NXDOMAIN** | R7 asserts the expected host string is *present in the bundle*, never that it resolves. A staging deploy today serves HTML from the live `staging.50mmretina.com` and 404s every asset. Nothing in CI detects this — live-looking-but-broken is worse than obviously broken | G8 creates the R2 custom domain |
| 5 | **Production Pages has not redeployed since the variables were added** | Production's R7–R10 stay inert until something triggers a production deploy. Nothing in G7 does | Next `main` deployment, whenever that is |
| 6 | **`_redirects` still emits an invalid `/sitemap.xml` 200-proxy rule** on both lanes | G1 proved Cloudflare rejects it, so the static file wins and G7's empty staging sitemap is what serves. But it is invalid on production too, and a Cloudflare behaviour change would make it live | Removed or made valid |

---

## 5. WHAT THIS DOES NOT SAY

- No leak is claimed. Every executed cross-contamination test in G6 passed with
  discriminating controls, in both directions, and both bundles were clean at
  whole-tree grep (0 files each way).
- The Pages variable readings are not doubted; they were taken carefully and
  three ways.
- Nothing here blocks G7, G8 or G9.
