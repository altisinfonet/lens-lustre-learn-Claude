# G9 · Step 3 — deploy route decided, lane leak found and closed

**Date:** 2026-08-24 · **Gate:** G9 · **Status:** step 3 BLOCKED on one owner action; everything around it executed and measured.

---

## 1. What is actually still wrong

The three G9 fixes are committed (`9f3d20a`) and pushed. They are **not live on 26 of the 28 functions** that bundle `_shared/secureHeaders.ts`, because a shared module is bundled at deploy time. Measured on staging after the push:

| function | state | preflight from `https://attacker.example` |
|---|---|---|
| `get-payment-gateways-public` | redeployed v4 | `(absent)` — correct |
| `dashboard-init` | not redeployed | `access-control-allow-origin: *` |

That `*` is the original defect, still live, on 26 functions. This is the one thing standing between G9 and closure.

## 2. Why neither session can deploy

Both assistant sessions sit behind an egress allowlist that does not include `api.supabase.com`:

```
{"code":"FunctionsApiStatusError","message":"unexpected list functions status 403:
 request blocked: no rule or allowlist entry allows host \"api.supabase.com\""}
```

The code session's `npx supabase functions deploy` now *runs* — the Bash permission rule was not the blocker after all — and fails at the network layer. Its CORS probe fails one host earlier, at `CONNECT` to `ztzutckwdhetphwghuzj.supabase.co`, so the three `(absent)` lines it printed prove nothing and are not recorded as a CORS result.

This session's egress **does** reach `api.supabase.com` and `*.supabase.co` (that is how the two live probes above were taken), but has no access token: the only one ever issued, beginning `sbp_a506b906`, was pasted into a chat transcript and is burned.

## 3. The route rejected, and why

The Supabase MCP server reaches the API server-side and is unaffected by the allowlist. Its `deploy_edge_function` takes each function's **source as tool arguments** — 262 KB across 26 functions, `complete-round` alone 79 KB, retyped by a language model straight into live endpoints. A single silent transcription slip ships a broken endpoint. That is a worse failure than a delayed deploy, so it was not done.

## 4. The route taken

`.github/workflows/deploy-functions.yml` — a deliberate sibling of `apply-migration.yml`, same doctrine: manual dispatch only, branch gate, confirm input, credential in GitHub's secret store where nothing in the file can print it. The work moves to where the network already is, instead of the credential moving to where the network isn't.

Two things it does that `apply-migration.yml` does not need:

- **The function set is derived, not typed.** A hand-kept list goes stale the first time someone adds the import, and the failure is silent — the new function keeps the old bundled headers and answers `*` while the audit says the fix shipped. The step refuses to run if the derived set is implausibly small.
- **It proves the deploy.** "Deploy succeeded" only means bytes were accepted. The final step preflights from the lane origin (must be echoed) and from three origins that must be refused — unrelated, suffix-confusion look-alike, `http://` downgrade — and fails the run if any receives a CORS grant. Verified as a real discriminator before commit: it passes on `get-payment-gateways-public` and catches the `*` on `dashboard-init`.

There is deliberately **no "credential points at the target" gate**, unlike `apply-migration.yml`. A connection string carries its database; an access token does not. The ref is chosen by the workflow from `target` and passed as `--project-ref`, so a mis-filed token cannot redirect a deploy — only fail to authorize one.

### OWNER ACTION — the only manual step (~2 minutes)

1. Supabase → Account → Access Tokens → generate `github-actions-deploy`. **On the same page, revoke the token beginning `sbp_a506b906`.**
2. GitHub → Settings → Environments → `staging` → add environment secret `SUPABASE_ACCESS_TOKEN`. Repeat for `production`.
3. Actions → *Deploy edge functions* → Run workflow, branch `staging`, target `staging`, scope `cors-set`, confirm `staging`.

The token never passes through a chat. This also closes the outstanding rotation item.

## 5. Corrections to two claims carried forward

**`SITE_ORIGIN` / `CDN_HOST` are NOT missing on staging.** `laneConfig` throws when they are unset, so a live 200 from a consumer is proof. Measured:

```
sitemap            HTTP 200   40× https://staging.50mmretina.com, 2× https://cdn-staging.50mmretina.com
seo-route-metadata HTTP 200
```

**The `npx supabase` Bash permission was not the blocker.** It was recorded as one since G7. It is now measured as an egress block instead. Recorded so no future session re-litigates the permission rule.

## 6. Lane leak found while verifying — found, fixed, re-measured

The staging sitemap emitted one **production** CDN URL. A full scan of every text column in the staging `public` schema found exactly three rows, all from my own seeding:

| table | column | origin of the value |
|---|---|---|
| `courses` | `cover_image_url` | seeded |
| `office_staff` | `photo_url` | seeded |
| `featured_artists` | `body` | seeded, URL embedded in article HTML |

Not a code defect — `laneConfig` resolved correctly throughout — but a stored cross-lane dependency: staging fetching from production infrastructure. Rewritten to the placeholder source the rest of the seed already uses (and `cdn-staging` for the embedded one), so staging stays visually complete rather than trading a hidden dependency for three broken images.

Re-measured after the fix — **zero** production CDN references remain:

```
40 https://staging.50mmretina.com
15 https://picsum.photos
 2 https://images.unsplash.com
 2 https://cdn-staging.50mmretina.com
```

## 7. Capability boundary recorded once

`cdn.50mmretina.com` and `cdn-staging.50mmretina.com` are **not** reachable from this session (`curl: (56) CONNECT tunnel failed, response 403`). Whether the three objects above exist in staging R2 could not be measured and is not asserted either way.

## 8. G9 status

**BLOCKED**, unchanged, on one owner action. Not GREEN, not deferred, not assumed.

| exit condition | state |
|---|---|
| CORS policy correct in source | ✅ committed `9f3d20a`, pushed |
| CORS policy live on all 28 functions | ❌ live on 2 of 28 |
| judge tag mirror fixed | ✅ committed; runtime-proven on `submit-judge-decision` v4 |
| `_redirects` invalid rule removed | ✅ committed; `no rules emitted` in a real staging build |
| regression green | ✅ tsc 0 · vitest 2311/0 · isolation 21/21 · SEO 15/15 · guard 385 assets/3 roots |
| lane isolation, stored data | ✅ repaired and re-measured (§6) |
| deploy route exists | ✅ workflow authored, dry-run verified |
| Turnstile parity | ⛔ OWNER DECISION — unchanged |
| token `sbp_a506b906` rotated | ⛔ OWNER ACTION — folded into §4 step 1 |

`origin/main` untouched at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`. **G10 not started.**
