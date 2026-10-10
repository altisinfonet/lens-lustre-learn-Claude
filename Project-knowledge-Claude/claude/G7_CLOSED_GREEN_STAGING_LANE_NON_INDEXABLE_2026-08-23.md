# G7 — CLOSED GREEN · staging lane live, non-indexable

**Verdict: G7 = GREEN — COMPLETE.**
**Date:** 2026-08-23. **Merged:** `origin/staging` `06b9162`, tree
`ad873f04b809e9782e1ecf4b6bb2edafc02e6be7`, identical to PR #90 head
`c2722d5^{tree}`. **`origin/main` unchanged** at `32930e75…` throughout.

---

## 1. Exit conditions

| # | Condition | Evidence | Class |
|---|---|---|---|
| 1 | `staging.50mmretina.com` resolves to Cloudflare | Both authoritative NS + 3 recursive resolvers; SOA advanced `2412945288 → 2412947188`; known-absent control NXDOMAIN in the same run. Re-confirmed with a working resolver after `dig` was found returning empty for hosts that plainly resolve | VERIFIED |
| 2 | Staging Pages project live, custom domain Active | Production branch `staging`, Preview = None; deployment `0ac877f2-f3c5-4d7e-b21e-6183022fb098` at `06b9162`, Success, 1m, aliased to the custom domain | VERIFIED (owner-read dashboard) |
| 3 | Isolation guard passes **in the shipped build** | `ISOLATION-GUARD PASS: expected=ztzutckwdhetphwghuzj present; forbidden=[jtdtehuqtinjxropkkcn] absent; host=cdn-staging.50mmretina.com present; forbidden-hosts=[cdn.50mmretina.com,www.50mmretina.com,https://50mmretina.com] absent; 272 assets scanned across 2 root(s): dist, functions` @ `2026-08-23T09:13:16Z` | VERIFIED |
| 4 | **R7–R10 armed in a deployed build** — first time ever | Same line reads `host=… present`, NOT `host rules inactive`. The previous staging deploy read `host rules inactive (no ISOLATION_EXPECTED_HOST)`. The scheme-qualified `https://50mmretina.com` entry was accepted, not rejected by R9 | VERIFIED — controlled by the prior deploy's contrasting line |
| 5 | Lane values reach the deployed artifact | Deployed `robots.txt` names the staging origin, never production — the observation that exposed the indexing defect in the first place | VERIFIED |
| 6 | Staging is non-indexable | Origin: `…pages.dev/robots.txt` → `ROBOTS_DISALLOWED`, i.e. a compliant fetcher refused because the file forbids it. Control: production `…pages.dev/robots.txt` fetched normally by the same client in the same minute, proving the refusal is caused by staging's file, not by pages.dev. Custom domain after purge, read directly in a browser: `# NON-PRODUCTION LANE — NOT FOR INDEXING.` / `User-agent: *` / `Disallow: /`, no `Sitemap:` line; `sitemap.xml` an empty self-closed `<urlset>` | VERIFIED — two independent instruments |
| 7 | Production untouched | `robots.txt`/`sitemap.xml` byte-identical to `2149c780…` / `11b27c08…` from a build in this session; production `/sitemap.xml` served 200 with 12 `<loc>`; production `robots.txt` fetched verbatim correct | VERIFIED |
| 8 | CI enforces the policy per lane | Both jobs; each guard observed FAILING against the other lane's dist. On `c2722d5` all four green; `build-staging` ran, `build-production` skipped — correct for a `staging` base | VERIFIED |
| 9 | Harness | 15 cases, **15/15** mutants, cases-that-killed-nothing named every run and an undeclared one fails the run | VERIFIED |

## 2. The one dissenting instrument — classified, not hidden

`staging.50mmretina.com` served **my** fetcher the pre-G7 `robots.txt` after the
deploy, after the purge, and after the WAF exclusion — while a browser saw the
new file immediately. It also 403s me on every other path.

**Classified as an instrument limitation, on evidence:**

- Two independent changes (deploy + targeted purge; then the WAF rule edit)
  both reached the browser at once and **neither** reached my fetcher. A fault
  in the system would not ignore both.
- `GET /` returned **403, not `ROBOTS_DISALLOWED`** — so the robots.txt my
  fetcher receives is genuinely the old one, and it is not my request cache
  (the read was taken well past the per-URL TTL, twice).
- The same fetcher reads **production** `robots.txt` byte-perfect, so nothing
  zone-wide rewrites robots.txt for this client class.
- Cloudflare's own bot features were confirmed all off: Block AI bots off, all
  three AI bot policies Allow, AI Labyrinth off, every AI Crawl Control
  per-crawler block toggle off, Managed robots.txt off. The custom WAF rule is
  the only thing acting on staging.

**What is therefore NOT claimed:** I have not personally observed what a real
search crawler receives. Indexing is nonetheless prevented by two independent
mechanisms — the deployed blanket `Disallow: /`, and the WAF rule that blocks
verified bots on every path, so a crawler cannot fetch a page to index whatever
robots.txt it reads.

## 3. Defects found and fixed inside G7

1. **Staging shipped crawlable** with a sitemap of 12 staging URLs. Fixed: the
   production lane is now the only indexable lane.
2. **My own first fix would have de-indexed production.** Equality against
   `PRODUCTION_SITE_ORIGIN` would have classed `VITE_SITE_ORIGIN=https://50mmretina.com`
   — the apex, the same site — as non-production. Now registrable-host equality
   after stripping `www.` from both sides. Mutant M3.
3. **A false claim in a code comment** ("fail-closed by construction"). It is
   not: `lane-config.mjs` still defaults `VITE_SITE_ORIGIN` to production. Stated
   plainly in the header, with the guard that closes it named.
4. **GREEN-6 was disarmed in transit** — a bare hostname autolinked into a
   markdown link, making the clause vacuous. Found by measuring the needle.
   Corrected by building the literal through concatenation; **M15 proves the
   clause live** (survives against the broken needle, dies against the fixed one).
5. **Cases that kill no mutant are now named on every run**, and an undeclared
   one fails the run — the general fix for the class of defect in 4.
6. **HS-2, found here, fixed on PR #91:** host rules R7–R10 were opt-in, so an
   unset `ISOLATION_EXPECTED_HOST` skipped all four and still printed PASS.
   Measured: same bundle, forbidden host present in four files — set → `FAIL [R8]`
   exit 1; unset → `PASS` exit 0. R12 refuses unless the opt-out is stated.

## 4. Open, carried to G8 and beyond

| Item | Owner | Note |
|---|---|---|
| **`cdn-staging.50mmretina.com` NXDOMAIN** | **G8, first task** | Confirmed with known-present and known-absent controls. Staging serves HTML from a live hostname and 404s every asset. R7 asserts the host string is *in the bundle*, never that it resolves — nothing in CI detects this |
| PR #91 (R12) | code session | CI running |
| The spoofable WAF carve-out | owner | `http.user_agent contains "Claude-SearchBot"` is a client-supplied string and did not work anyway. **Recommend reverting it** |
| Production Pages has not redeployed | owner | Its R7–R10 stay inert until a `main` deploy. That deploy's guard line also closes G6's owner action 6, open since 22 August |
| `_redirects` invalid `/sitemap.xml` 200-proxy | both lanes | Cloudflare rejects it, so the static file wins; still invalid |
| Cloudflare Access unavailable | owner | Zero Trust not onboarded; needs plan selection |
