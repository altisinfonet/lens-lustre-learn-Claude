# G7 — Staging DNS + Lane Indexing Policy

**Date:** 2026-08-23
**Gate:** G7 (staging hostname live, lane isolation verified at runtime)
**Status:** **BLOCKED** — one criterion outstanding, external dependency named below.

---

## 1. What passed

| Check | Result | Evidence |
|---|---|---|
| `staging.50mmretina.com` resolves to Cloudflare | PASS | Both authoritative NS + 3 recursive resolvers; SOA advanced `2412945288 → 2412947188`; known-absent control returned NXDOMAIN in the same run (§5.1 Probe Rule 1 satisfied) |
| Staging Pages project live, custom domain Active | PASS | 9 environment variables, Preview = None, deployment green |
| Bundle isolation guard on the staging build | PASS | 272 assets, expected ref present, production ref absent |
| Runtime lane isolation reached the artifact | PASS | Deployed `robots.txt` read `Sitemap: https://staging.50mmretina.com/sitemap.xml` — the staging origin, not production |
| `cdn-staging.50mmretina.com` | NXDOMAIN | Expected: R2 custom domain is G8's work |

## 2. The defect G7 surfaced

The staging lane went out **crawlable**. Its `robots.txt` carried no blanket
`Disallow: /` and advertised a sitemap listing 12 staging URLs — duplicate
content competing with production in search results, which is expensive
precisely because search engines keep what they have already indexed.

`scripts/generate-seo-assets.mjs` flagged this against itself at the time the
lane-isolation fix was written (lines 12–15, 2026-08-22): *"⚠ THIS DOES NOT
DECIDE WHETHER A LANE SHOULD BE INDEXED AT ALL … A staging lane almost
certainly wants `Disallow: /` … that is a separate decision, deliberately not
made here."* G7 is where that decision came due.

**Policy decided:** the production lane is the only indexable lane. Every other
lane emits a blanket `Disallow: /` and advertises no sitemap.

## 3. Two defects found in my own first implementation

Both were caught by re-reading the change against `scripts/lane-config.mjs`
before it was packaged, not by review of the change in isolation.

**D1 — the classification would have de-indexed production.**
The first version tested `siteOrigin === PRODUCTION_SITE_ORIGIN`, where that
constant is `https://www.50mmretina.com`. A lane built with
`VITE_SITE_ORIGIN=https://50mmretina.com` — the bare apex, the *same site* —
would have been classed non-production and shipped `Disallow: /` to the live
domain. The production CI job happens to set the www spelling, so the defect
would not have fired today; it would have waited for someone to "simplify" that
variable. Classification is now on the registrable host with a leading `www.`
stripped from both sides, so the apex and www both count as production.
Direction of doubt is deliberate: wrongly de-indexing production is expensive
and slow to undo, and a non-production lane deliberately named under the
production apex is not a thing anyone builds. Killed by mutant M3.

**D2 — the header claimed a property the code does not have.**
It said the policy was "fail-closed by construction". It is not.
`lane-config.mjs` still defaults `VITE_SITE_ORIGIN` to the production origin
when unset, so a lane that *forgets* the variable is classed production and
ships indexable. The comment now states this plainly and names the guard that
actually closes it — the isolation host rules R7–R10 — which only hold if
`ISOLATION_EXPECTED_HOST` / `ISOLATION_FORBIDDEN_HOSTS` are set on every Pages
project. See §5, item 1: they currently are not.

## 4. Evidence for the change

Branch `g7robots`, based on `origin/staging` at `d33c91efc10b7fb4e966df64c1bdd8597771fc0f`.

**New harness `scripts/test-seo-assets.mjs` — 15 cases, 14/14 mutants killed.**
Hermetic per Standing Rule 12: `VITE_SITE_ORIGIN` and `VITE_CDN_HOST` are
stripped from inherited env before every run, and every run uses a fixture cwd,
never the repo root, because the generator reads `dist/` and `public/`
relative to cwd. The harness refuses to run mutations over a red baseline.

Cases: production by default / explicit www / trailing slash / **bare apex**;
staging blanket-disallow; staging robots names its own lane only; pages.dev
preview lane; `www.staging.…` (www-strip is not greedy); suffix look-alike
`50mmretina.com.example.net`. Refusals: missing `dist/`; missing template;
empty `VITE_SITE_ORIGIN`; non-https origin; unsubstituted placeholder;
sitemap naming a foreign origin.

Mutants M1–M14 cover: branch deleted, condition inverted, classification
reverted to strict equality (D1), either www-strip dropped, `Disallow`→`Allow`,
blanket narrowed to one agent, `Sitemap:` re-added, sitemap repopulated, early
exit removed, and each of the three refusal checks removed.

**Production is byte-identical.** Built with the production lane's own CI
environment:

```
robots.txt  sha256 2149c780953795d41c083c143642d60befb0a0d8093ddde1f6412fcd761d9d4f
sitemap.xml sha256 11b27c08065afe6c4d7fb481f12b40a34311d1c43f31b338296481b89e8c24f8
```

Both match the pre-change hashes recorded before the edit.

**Staging build, real `npm run build`, staging CI environment:**

```
# NON-PRODUCTION LANE — NOT FOR INDEXING.
# Lane origin: https://staging.50mmretina.com
User-agent: *
Disallow: /
```
sitemap.xml: empty `<urlset>`, 0 `<loc>`.

**Full local gate:** isolation guard self-test 16/16 mutants; SEO harness 15
cases / 14 mutants; `tsc --noEmit` 0 errors; `vitest run` **2292 passed, 1
skipped, 165 files** — unchanged from baseline; isolation guard PASS on both
lanes with host rules R7–R10 **active** (271 assets, 2 roots).

**CI:** a `SEO indexing policy (self-test)` step plus a lane assertion added to
**both** jobs. `build-production` fails if a blanket `Disallow: /` ever appears
or the production sitemap line is missing; `build-staging` fails if the blanket
disallow is absent, a `Sitemap:` line is advertised, or the sitemap lists URLs.
Both assertions were executed verbatim against real builds and passed.

## 5. Outstanding — why G7 is BLOCKED, not GREEN

1. **`ISOLATION_EXPECTED_HOST` and `ISOLATION_FORBIDDEN_HOSTS` are unset on both
   Pages projects.** Host rules R7–R10 pass in GitHub CI and are inert in the
   builds that actually ship. This is also the guard D2 depends on.
   *External dependency:* dashboard access to both Pages projects.
2. **Staging is publicly reachable and crawlable right now.** The fix is on a
   branch; nothing is deployed. Cloudflare Access on `staging.50mmretina.com` is
   the immediate mitigation and is independently worth having — staging should
   not be public regardless of what `robots.txt` says.
   *External dependency:* Cloudflare Zero Trust dashboard.
3. **Push, merge and redeploy.** *External dependency:* GitHub write access.
   `gh api repos/…` returns 403 in this session and `add_repo` is not in the
   toolset, so the push must run from the code session.

## 6. Carried forward, not fixed here

- `_redirects` still emits `/sitemap.xml → <supabase>/functions/v1/sitemap` on
  both lanes. G1 proved Cloudflare rejects that 200-proxy rule, so the static
  file wins and the new empty staging sitemap is what serves — but the rule is
  invalid on production too and should be removed or made valid.
- `lane-config.mjs` still defaults `VITE_SITE_ORIGIN` to production (D2). Not
  changed here: it is a shared module with its own test surface, and the same
  omission has a louder failure mode (production URLs baked into every asset)
  that R7–R10 exist to catch.
- The stale CI comment claiming both staging hosts are NXDOMAIN was corrected
  in the same change; `staging.50mmretina.com` is Active,
  `cdn-staging.50mmretina.com` is not.

## 7. Result

**G7 / BLOCKED** — DNS, Pages project, guard and runtime lane isolation all
verified PASS; indexing policy implemented, tested and CI-enforced locally.
Blocked on three external-access items in §5. Next gate: **G8** (R2 custom
domain `cdn-staging.50mmretina.com`; prove staging cannot write to production
bucket `50mm`).
