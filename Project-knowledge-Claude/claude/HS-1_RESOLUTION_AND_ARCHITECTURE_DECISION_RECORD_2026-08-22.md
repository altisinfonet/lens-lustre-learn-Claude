# HS-1 RESOLUTION & ARCHITECTURE DECISION RECORD

**2026-08-22, 18:15 UTC.** Governing plan: Rev 3.0 + Erratum E-1.
**No mutation performed. No remediation. Nothing is authorized by this document.**
`origin/main` unchanged at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`;
workspace clean at `9aea8a30916fee06a741c52ef34914e4a2788f96`.

---

## 0. THE FINDING HAS WIDENED — READ THIS FIRST

One bounded check was run before writing this record, because it decides whether
Option B is even possible. It concerned **Path A**, not Path B.

```
GET https://50mmretina.com/assets/index-CQNRLXfL.js   →  200  JavaScript
        (Path B's entry chunk — begins with Vite's __vite__mapDeps)
GET https://50mmretina.com/assets/index-DrppXY7Q.js   →  404
        (the local main-HEAD build using the CI workflow's own values)
```

**The apex serves the same uncontrolled build as `www`.**

Restated as the operative fact, and it is VERIFIED:

> **Neither production hostname serves a build reproducible from the controlled
> CI configuration. Both serve `index-CQNRLXfL.js`, which no documented
> environment reproduces.**

E-1's model — Path A controlled, Path B not — was **too generous**. Path A is
Cloudflare-*proxied*, which is not the same as Cloudflare-*served*. There is at
present **no verified controlled serving path in production at all**.

### Two hypotheses remain, and neither can be settled from outside

| | Hypothesis | Why it fits |
|---|---|---|
| **H-α** | Both hostnames resolve to the same third-party origin; the apex is orange-clouded in front of it. The Pages project serves neither hostname | Simplest explanation for one identical build on both. Cloudflare as pure CDN |
| **H-β** | The apex **is** the Pages project, but Pages' own environment variables differ from the CI workflow literals, so its build hashes differently | The Pages production variables are owner-attested and were never read. If its key differs from the workflow's, its build differs — exactly what is observed |

**Why this cannot be resolved by probing:** a proxied DNS record returns
Cloudflare's anycast addresses and *hides the origin*. The apex's true origin is
visible only in the Cloudflare dashboard. This is a structural limit, not a tool
limit — and it is the single most important unknown in this document.

`www` is not ambiguous: it is DNS-only to a non-Cloudflare address, so it is
certainly not Pages.

---

## 1. EVIDENCE ALREADY ESTABLISHED — not re-litigated

| # | Fact | Class |
|---|---|---|
| E1 | `www` → `185.158.133.1`, DNS-only, TTL 3600, no HTTPS/SVCB record, PTR `lovable-app-cd-1-4.p.l5e.io`. Not behind Cloudflare | **VERIFIED** |
| E2 | Apex and `cdn` are Cloudflare-proxied (anycast + ECH-bearing HTTPS records) | **VERIFIED** |
| E3 | Both hostnames serve entry chunk `index-CQNRLXfL.js` | **VERIFIED** |
| E4 | That chunk matches neither `index-DrppXY7Q.js` (CI legacy anon key) nor `index-BRwrdrEg.js` (new publishable key) | **VERIFIED** |
| E5 | Four vendor chunks + the Tailwind CSS bundle are content-hash identical to a local `main` HEAD build — confirmed independently by the owner's browser | **VERIFIED** |
| E6 | Staging Supabase has **zero** edge functions; production has 74 incl. `dashboard-init`. `www` shows a `dashboard-init` preflight → 200 | **VERIFIED** |
| E7 | `www`'s PostgREST calls return 0.8 kB of rows; the staging DB holds zero rows | **VERIFIED** |
| E8 | Production's CORS allow-list contains `https://www.50mmretina.com` | **VERIFIED** |
| E9 | `index.html` redirects apex → `www` before the app boots | **VERIFIED** |
| E10 | R2 bucket `50mm-staging` exists (2026-08-21); `50mm` is production | **VERIFIED** |
| E11 | Worker `seo-edge-injector` exists, modified 2026-07-11 | **VERIFIED** |
| E12 | Production `_headers` from a local build hashes `40b681e537…` — byte-identical to the recorded artifact, across both trees | **VERIFIED** |

**E6 + E7 ⇒ the serving path is connected to the production Supabase project.
That is the HS-1 condition, and it is unchanged.**

---

## 2. UNKNOWNS THAT GENUINELY REMAIN

Each names the *only* mechanism that can close it. None is closable from this
session; none is closable by more probing.

| U | Unknown | Only mechanism | Blocks |
|---|---|---|---|
| **U1** | What is the apex's true origin — Pages, or the third-party host? | Cloudflare dashboard → DNS → the apex record's **content** field, and Workers & Pages → the Pages project's **Custom domains** tab | **Everything.** Decides H-α vs H-β and whether a controlled path exists at all |
| **U2** | Does the Pages production project currently build and deploy successfully? | Cloudflare dashboard → the Pages project → Deployments: latest status, date, and its build log | Both options |
| **U3** | The Pages project's actual environment variable **values** | Same dashboard → Settings → Variables and Secrets | Whether a Pages build is reproducible and guard-verified |
| **U4** | What platform builds the artifact both hostnames serve, from which repository and branch | The deploying platform's own dashboard | Option A entirely |
| **U5** | That build's environment values — Supabase key, and any R2/CDN inputs | Same | Option A entirely |
| **U6** | Whether that platform permits a **custom build command** | Same | **Whether Option A is viable at all** — see §3.6 |
| **U7** | Which R2 bucket and CDN host the serving build uses | U5, or the browser Network panel filtered to image requests | G8 scope |

---

## 3. OPTION A — THE EXISTING PATH IS INTENTIONAL

### 3.1 What currently builds it
**NOT ESTABLISHED (U4).** VERIFIED that it builds *this repository's source*
(E5). Which repository it reads, and on what trigger, is not observable
externally. The `.lovable/` directory and its 2026-05-02 reports referencing the
now-404 predecessor repo `altisinfonet/lens-lustre-learn` are **leads only** and
were not used to reach any conclusion.

### 3.2 Build / deployment mechanism
**NOT ESTABLISHED (U4).** Push-triggered CI on a third-party platform is the
shape suggested by the evidence, but the trigger, branch and deploy step are
unread.

### 3.3 Source / repository relationship
**PARTLY VERIFIED.** The artifact is a Vite build of this codebase's dependency
tree, bundler config and a source state at or extremely near `main` HEAD (E5).
Whether the pipeline reads *this* repo or a mirror is U4.

### 3.4 Environment inputs
**NOT ESTABLISHED (U5).** VERIFIED only that they differ from every documented
production configuration (E4). At least one of the three Supabase variables
differs from the CI literals.

### 3.5 Supabase and R2/CDN configuration
Supabase: **VERIFIED production** (E6, E7). R2/CDN: **NOT ESTABLISHED (U7)**.

### 3.6 Can it be brought under Path A's isolation controls?
**This is the question that decides Option A, and it turns on U6.**

The isolation guard is a build step. It protects a lane only when it runs inside
that lane's build command and fails the deploy on a non-zero exit. So:

- **If the platform exposes a custom build command** → the guard can be added,
  the lane's `ISOLATION_*` variables set, and Option A becomes genuinely
  controllable. Cost: a second lane to configure, verify and maintain.
- **If it does not** → the guard can never run there. Option A then means
  **permanently accepting an unguarded production build**, and the isolation
  property this entire project exists to establish is unachievable for the path
  members actually use. Every gate from G1 to G6 would be protecting a path
  nobody loads.

**No amount of work here changes that. It is a property of the platform.**

### 3.7 How staging reproduces Path B
Requires a second instance of that platform, pointed at the staging branch and
the staging Supabase project — additional cost, additional configuration, and
one more environment that must itself be proven isolated. If the platform has no
per-branch environments, staging equivalence for this path is **not achievable**
and §15 could never validate what production actually serves.

### 3.8 How G10 promotion updates it safely
Today, promotion to `main` would trigger that pipeline **implicitly**, with no
approval gate, no isolation check and no deployment ID this project can record.
Option A requires inventing that control: a recorded deployment identifier, a
post-deploy artifact fingerprint, and a rollback mechanism on that platform.

### 3.9 Additional gates required under Option A
- **G11 — Path B build provenance.** Pipeline, repo, branch, trigger recorded and owner-attested.
- **G12 — Path B environment audit.** Every value enumerated and classified; any production credential outside the plan's controls recorded.
- **G13 — Path B isolation enforcement.** The guard runs in that build, or the gate is declared unachievable and the residual risk formally accepted in writing.
- **G14 — Path B staging equivalence**, or a recorded decision that §15 cannot cover the path members use.
- **§16 amendment** — an environment-impact row for the path, without which any change to it is unauthorized by §16's own rule.

---

## 4. OPTION B — THE EXISTING PATH IS UNINTENDED

**Option B is not "move `www` to the controlled path".** §0 shows the apex
serves the same uncontrolled build, so under H-α there is no controlled path
currently serving anything. Option B is therefore: **make the Cloudflare Pages
lane the real serving path, and cut both hostnames over to it.**

### 4.1 Safest migration — staged, each stage reversible

| Stage | Action | Reversible? |
|---|---|---|
| **B0** | Close U1, U2, U3 from the Cloudflare dashboard. **No change.** If H-β is true and the apex already is Pages, stages B2/B4 shrink to a variable correction | — |
| **B1** | Align the Pages project's environment variables with the CI literals, so its build is reproducible and guard-verified. Redeploy. **Verify on the `pages.dev` hostname** — behind Access, so owner-viewable — that it serves `index-DrppXY7Q.js` (or its then-current CI-reproducible equivalent) **before any DNS moves** | Yes — revert variables, redeploy |
| **B2** | Attach `www.50mmretina.com` as a Pages custom domain. Cloudflare replaces the DNS-only A record with its own proxied record. **This is the cutover** | Yes — see §4.5 |
| **B3** | Verify `www` now serves the CI-reproducible artifact, guard line present in the build log, §18 post-production checks pass | — |
| **B4** | Repoint the apex to Pages if U1 shows it is not already | Yes |
| **B5** | Detach the custom domain in the third-party platform **only after** B3 holds for an agreed soak period. Do not delete the deployment | Yes |

**B1 before B2 is not negotiable.** Cutting DNS to a Pages project whose build
state is unverified risks serving a stale or failed build — the exact 2026-08-15
failure mode, where `npm ci` broke, Pages silently stopped deploying, and www
served a stale bundle for hours while every check stayed green.

### 4.2 What happens to `www`
Its DNS-only A record is **replaced** by a Cloudflare-proxied record created by
Pages. It stays the same hostname and the same origin to the browser. It gains
`_headers`, `_redirects`, WAF, Access-capability, and — the point of all this —
a build that the isolation guard has passed.

### 4.3 The apex → www redirect
**KEEP IT. Do not change it in the same operation.**

It exists because of the **2026-08-05 incident**: apex and www are separate
browser origins with separate logins and caches, and members opening the bare
domain got a logged-out copy of the site. Removing or reversing it re-opens that
incident. If the direction is ever reconsidered, it is a **separate change with
its own Change ID**, never bundled into a serving-path migration.

### 4.4 DNS / Cloudflare changes required
- `www` — DNS-only A `185.158.133.1` → **Pages-managed proxied record**. Written by Cloudflare when the custom domain is attached; not hand-created.
- Apex — depends on U1. If already Pages, no change. If proxying elsewhere, repoint to Pages.
- `cdn` — **no change**. Out of scope for this migration.
- `seo-edge-injector` Worker — **do not touch**. Its routes are unread; changing them mid-migration adds an uncontrolled variable.

### 4.5 Disable, detach, or bypass the third-party deployment
**Bypass first, detach second, never delete.**

1. **Bypass** (stages B2/B4): DNS no longer points at it. It keeps building and serving its own platform URL, harmless and instantly available as a rollback target.
2. **Detach** (B5): remove the custom domain in that platform, after soak.
3. **Delete**: **not recommended, ever, in this change.** It is the rollback target. Deleting it converts a reversible change into an irreversible one.

### 4.6 Rollback procedure
**Rollback target, recorded now while it is still live:**

```
www.50mmretina.com.   3600 IN A 185.158.133.1     Proxy status: DNS only
```

To roll back: delete the Pages custom domain for `www`, recreate that exact
record, DNS-only. Propagation is bounded by TTL — **3600 s worst case**, which
is the honest number to plan around, and is itself an argument for lowering the
TTL to 300 before B2 and restoring it afterwards.

Rollback is valid **only while stage B5 has not been executed**. After detach,
rollback requires re-attaching the domain on the other platform first.

### 4.7 Downtime and user-impact risk

| Risk | Severity | Mitigation |
|---|---|---|
| Pages build broken or stale at cutover | **HIGH** | B1 verification on `pages.dev` before B2. Non-negotiable |
| Pages env differs from the current live build → different Supabase key or project | **HIGH** | B1 aligns and verifies first. **A change of Supabase project would log every member out and show a different dataset** |
| DNS propagation window | MEDIUM | Lower TTL to 300 before B2 |
| Member sessions lost | **LOW** | Same hostname ⇒ same browser origin ⇒ `localStorage` Supabase session survives, **provided the project ref is unchanged** |
| Headers/CSP change breaks a third-party embed | MEDIUM | `_headers` CSP is stricter than a default host's. Verify Razorpay, Google Translate, GTM, Facebook and Cloudflare Turnstile after B3 |
| Rollback needed after detach | MEDIUM | Do not detach until soak passes |
| SEO / canonical disruption | LOW | Same hostnames, same canonical policy |

### 4.8 Proposed production change

> **PROD-CHG-20260822-001 — Migrate production serving to the controlled
> Cloudflare Pages lane.**
> Stages B0–B5. Owner-authorized, owner-executed at every dashboard step.
> Prerequisites: U1, U2, U3 closed; B1 verified on `pages.dev`.
> Rollback: §4.6, valid until B5.
> Post-change verification: Rev 3.0 §18, run per hostname.
> **NOT AUTHORIZED. NOT EXECUTED.**

---

## 5. RECOMMENDATION

**Option B — but the recommendation is conditional, and the condition is U6.**

Reasoning:

1. **Option A cannot deliver the project's objective unless U6 is favourable.**
   If the third-party platform has no custom build command, the isolation guard
   can never run on the path members use. Every control built in G1–G6 would
   then protect a path nobody loads. That is not a compromise; it is a
   forfeiture.
2. **Option B consolidates onto a lane that is already built and already
   proven** — lane-aware CI, R1–R10 with 12/12 mutants held, per-lane generated
   `_headers` byte-identical to production's recorded artifact, and a migration
   gate that refuses cross-lane in both directions. That work exists and is
   VERIFIED; it is simply not currently in the serving path.
3. **Option B is reversible at every stage before B5**, and its rollback target
   is recorded above while still live.
4. **Two production build pipelines is the failure mode this project was
   started to eliminate.** Option A institutionalises it and roughly doubles
   the gate count (G11–G14) for a path that would still be less controlled than
   the one already built.

**If U6 turns out favourable** — the platform does allow a custom build command
— Option A becomes defensible for a team that wants that platform's workflow.
It would still cost G11–G14 and a second staging environment. It is not the
cheaper path; it only looks cheaper because it requires no cutover.

---

## 6. PROPOSED ERRATUM E-2 TO REV 3.0 — amendment, not a rewrite

Rev 3.0 stays authoritative. E-1 stands. **E-2 is proposed, not adopted**, and
covers the ten points required:

> **E-2 — Serving-path provenance is a first-class gate concern.**
>
> 1. **Path A** — `50mmretina.com`. Cloudflare-proxied. **Proxied is not
>    served**: its origin must be recorded, not assumed.
> 2. **Path B** — `www.50mmretina.com`. DNS-only to a third-party address.
>    Where members actually land, by the app's own redirect.
> 3. **Build provenance** — every production serving path records what builds
>    its artifact: pipeline, repository, branch, trigger. Unrecorded provenance
>    is a blocked gate, never an assumption.
> 4. **Deployment provenance** — each path records its deployment identifier
>    and the artifact digest actually served. A release names them per path.
> 5. **Environment provenance** — every variable reaching a shipped bundle is
>    enumerated per path. **A path whose build is not reproducible from
>    recorded configuration is uncontrolled by definition.**
> 6. **Backend provenance** — the Supabase project, R2 bucket and CDN host each
>    path reaches are recorded and verified per path.
> 7. **DNS / serving-path ownership** — every production hostname records its
>    record type, proxy status, origin, and who may change it. A proxied record
>    hides its origin from outside; the origin is read from the dashboard, and
>    is **OWNER-ATTESTED**, never inferred.
> 8. **Staging equivalence** — §15 validates the mechanism that actually serves
>    members. A staging lane mirroring a non-serving path does not satisfy §15,
>    and saying so is not pedantry: it is the difference between testing the
>    product and testing a spare copy of it.
> 9. **Promotion** — G10 names every production serving path a release reaches,
>    including paths updated implicitly by a third-party pipeline. A path that
>    updates without an approval gate is recorded as such in the RC.
> 10. **Post-G10 verification** — §18 runs **per path**. A release verified on
>     one path has not been verified.
>
> **Consequence for the current gate set:** G1–G6 are scoped to the Cloudflare
> Pages lane. Until U1 is closed, it is not established that this lane serves
> any production hostname. Their evidence stands; their *scope* is narrower
> than Rev 3.0 assumed.

---

## 7. GATE IMPACT — two-state only

| Gate | State | Exact blocking dependency |
|---|---|---|
| G0, G1, G2, G4, G5a | **GREEN — COMPLETE** | — (scope note: evidence is the repo and CI lane, unaffected by serving-path provenance) |
| G3 | **BLOCKED** | §5.3 needs a push and an Actions run. Git proxy refuses this session (403, re-tested 18:07 UTC). No browser route exists without credentials this session must never request |
| G5b | **BLOCKED** | Production Pages `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` absent; no authorized Pages mechanism in this session — Cloudflare tooling here covers D1, KV, R2, Workers and Hyperdrive only |
| G6 | **BLOCKED** | Pages variable unreadable by any authorized mechanism, **and** scope-blocked: its evidence covers a lane not established to serve production |
| G7 | **BLOCKED** | HS-1 live; and its design premise depends on U1 |
| G8 | **BLOCKED** | HS-1 live. Prerequisite bucket `50mm-staging` exists (E10) |
| G9 | **BLOCKED** | HS-1 live; staging Supabase has zero edge functions deployed |
| §15, RC, G10 | **BLOCKED** | HS-1 live |

**No gate is GREEN by inference. No gate is "mostly complete."**

---

## 8. CHANGE LEDGER

| Field | **CHG-20260822-012** |
|---|---|
| Change ID | CHG-20260822-012 |
| Paths affected | **None mutated.** Path A observed; Path B not re-probed |
| Branch | `staging`, read-only |
| Before / after SHA / tree | `9aea8a3` / `aa877b50` → **identical** |
| Files / configuration changed | **NONE** |
| Reason | Convert HS-1 into a controlled resolution plan; one bounded Path A check to establish whether Option B is possible |
| Environment impact | None. Two public HTTPS GETs against the apex |
| Verification performed | §0 — apex serves `index-CQNRLXfL.js` (200), does not serve `index-DrppXY7Q.js` (404) |
| Rollback reference | Not applicable |
| Evidence classification | **VERIFIED** for §0 and §1; **NOT ESTABLISHED** for every U in §2, each with its closing mechanism named |

---

## 9. OWNER DECISION REQUIRED

**Close U1, U2 and U3 first — one visit to the Cloudflare dashboard.** They are
prerequisites to *both* options, and U1 may collapse the problem: if the apex is
already the Pages project, this becomes a variable correction plus one DNS
cutover rather than a migration.

1. **DNS → the apex record.** Type, **content**, proxy status.
2. **Workers & Pages → the production Pages project → Custom domains.** Which
   hostnames, if any, are attached.
3. **Same project → Deployments.** Latest status and date; whether it is still
   deploying at all.
4. **Same project → Settings → Variables and Secrets.** The variable **names**;
   values only for the two Supabase ones, which are public and ship in every
   bundle.

**Then rule: Option A or Option B.**

Nothing is mutated until you choose. After you choose, that option is executed
completely, verified independently, the Change Ledger updated, and only then is
the gate sequence recalculated.
