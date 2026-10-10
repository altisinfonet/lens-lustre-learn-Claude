# G7 — IS IT CLOSED?

**Answer: NO. G7 = BLOCKED.** Nothing that fixes staging has been deployed.
**Date:** 2026-08-23. Live measurements taken this run, not carried forward.

---

## 1. Live state, measured now

Four fetches, same client, same minute, with production as the discriminating
control (§5.1 Probe Rule 1 — a probe with no known-different comparator measures
the instrument, not the system):

| URL | Result |
|---|---|
| `https://staging.50mmretina.com/robots.txt` | **200** — the OLD file: `User-agent: Googlebot`…, **no blanket `Disallow: /`**, and `Sitemap: https://staging.50mmretina.com/sitemap.xml` |
| `https://staging.50mmretina.com/sitemap.xml` | **403** |
| `https://staging.50mmretina.com/` | **403** |
| `https://www.50mmretina.com/sitemap.xml` | **200**, static XML, 12 `<loc>`, first `https://50mmretina.com/` |

Two findings follow.

### 1.1 The G7 fix is NOT live

Staging still serves the pre-G7 `robots.txt`. No blanket disallow, and it still
advertises a staging sitemap. PR #90 is open but unmerged, so the staging Pages
project has not rebuilt. **Everything G7 built is on a branch.**

### 1.2 Something is returning 403 on staging — cause NOT determined here

`/` and `/sitemap.xml` are 403 while `/robots.txt` is 200, from the same client
at the same moment. Production is 200 throughout, so this is specific to the
staging hostname and not an artefact of the fetcher.

Candidate causes, none confirmed:

- The WAF custom rule requested as Task C (`http.host eq "staging.50mmretina.com"
  and cf.client.bot`). **This does not fit cleanly**: my fetcher is not a
  Cloudflare-*verified* bot, so that expression should not match it. If Task C is
  what is blocking me, the rule as deployed is broader than the expression I
  specified.
- Cloudflare bot management / Bot Fight Mode, which commonly exempts
  `robots.txt` and would explain the asymmetry precisely.
- Something else on the staging Pages project.

**Do not record this as "the crawler stopgap is working."** It has not been shown
to block a verified crawler, and it has not been shown to be the rule at all.

### 1.3 What the 403 does and does not change about exposure

If verified crawlers are also being 403'd, the search-indexing window is
narrower than assumed. But `robots.txt` — the one file that IS reachable —
currently tells every agent it may crawl, and advertises a sitemap. A crawler
not caught by whatever is returning 403 would read that as permission.
Exposure is **reduced by an unidentified mechanism**, not closed by a controlled one.

---

## 2. What G7 has verified

| Item | Result | Evidence |
|---|---|---|
| `staging.50mmretina.com` resolves to Cloudflare | PASS | Both authoritative NS + 3 recursive resolvers; SOA advanced `2412945288 → 2412947188`; known-absent control NXDOMAIN in the same run |
| Staging Pages project live, custom domain Active | PASS | Production branch `staging`, Preview = None, deployment green |
| Bundle isolation guard on the staging build | PASS | 272 assets; expected ref present, production ref absent |
| Lane values reach the deployed artifact | PASS | Deployed `robots.txt` names the **staging** origin, not production — which is how the indexing defect was found |
| HS-1 `www` cutover (G7's precondition) | PASS | Single controlled serving path; seven verifications, no outage |
| Indexing policy implemented and tested | PASS | 15 cases, **15/15 mutants**; production `robots.txt`/`sitemap.xml` byte-identical to `2149c780…`/`11b27c08…` |
| CI asserts the policy per lane | PASS | Both jobs; each guard observed **failing** against the other lane's dist |
| Host rules R7–R10 variables added to both Pages projects | DONE, **unproven** | Take effect on each project's next deployment; never yet run in a shipped build |

## 3. Why G7 is BLOCKED — the exact remaining criteria

| # | Criterion | External dependency |
|---|---|---|
| 1 | **PR #90 merged into `staging`** | GitHub write. `gh api repos/…` returns 403 in this session; `add_repo` is not in the toolset |
| 2 | **Staging Pages redeploys** and its guard line is read | Follows the merge |
| 3 | **`https://staging.50mmretina.com/robots.txt` shows the blanket `Disallow: /`** and no `Sitemap:` line | Follows the redeploy. This is the closing observation — I will take it myself, outside the 15-minute WebFetch TTL of the read above, with production as the control |
| 4 | **The 403 explained** — which rule, and whether it blocks verified crawlers | Cloudflare dashboard: WAF → Custom rules, and Security → Events for `staging.50mmretina.com` |

Criteria 1–3 are one merge away. Criterion 4 is new as of this run.

## 4. WORTH WATCHING

| # | Watch | Why | Closes when |
|---|---|---|---|
| 1 | **The staging deploy on the G7 merge** | First shipped build *anywhere* to carry R7–R10. If it fails, suspect the two new host variables before the robots change. Staging's `ISOLATION_FORBIDDEN_HOSTS` lists `https://50mmretina.com` **scheme-qualified**: a bare apex would be a substring of `staging.50mmretina.com` and `cdn-staging.50mmretina.com` and would trip R9 against staging's own hostnames | Deploy green and its guard line read |
| 2 | **`/sitemap.xml` may not serve the static file even after the fix** | The 403 means something already intercepts that path. `_redirects` still emits `/sitemap.xml → <supabase>/functions/v1/sitemap` on **both** lanes. G1 concluded Cloudflare rejects that 200-proxy rule — the staging 403 is a reason to re-test that conclusion rather than reuse it. If the rule is live, G7's empty static sitemap never serves | Fetch after redeploy: empty `<urlset>` = static file won; 403 or a Supabase error = the redirect is live |
| 3 | **`cdn-staging.50mmretina.com` still NXDOMAIN** | R7 asserts the expected host is *present in the bundle*, never that it resolves. A staging deploy serves HTML from a live hostname while every asset 404s. Nothing in CI detects this. Live-looking-but-broken is worse than obviously broken | G8 creates the R2 custom domain — this is why G8 starts there, not with bucket-write isolation |
| 4 | **Production Pages has not redeployed since its host variables were added** | Production's R7–R10 stay inert until a `main` deployment. Nothing in G7 triggers one | Next production deploy; capture its guard line (also closes G6's long-open owner action 6) |
| 5 | **Cloudflare Access is still not available** | Zero Trust is not onboarded on the account and requires plan selection plus, typically, a payment method. The browser agent correctly refused to enrol. Whatever is 403-ing today is not Access | Owner completes Zero Trust onboarding, or the WAF rule is confirmed sufficient |
| 6 | **`build-production` must SKIP on PR #90** | Base is `staging`, so `build-production`'s `if` should not fire. If it ran, that is a trigger-condition defect, not a pass | CI conclusions reported |

## 5. WHAT IS NOT CLAIMED

- No production impact. `origin/main` unchanged at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`; production `robots.txt`/`sitemap.xml` byte-identical; production `/sitemap.xml` measured 200 with 12 `<loc>` this run.
- The 403 is **not** attributed to any specific rule.
- R7–R10 are configured, not demonstrated.
