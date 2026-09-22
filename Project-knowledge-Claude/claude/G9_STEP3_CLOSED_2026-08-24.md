# G9 · Step 3 CLOSED — CORS fix live on all 28 functions, independently verified

**Date:** 2026-08-24 · **Gate:** G9 · **Verification:** performed from a second session with
independent egress, not inherited from the deploying session's report.

---

## 1. Result

All 28 functions that bundle `_shared/secureHeaders.ts` now carry the `9f3d20a` policy.
**140 preflights — 28 functions × 5 origins — PASS=28, FAIL=0.**

| origin | required | observed |
|---|---|---|
| `https://staging.50mmretina.com` | echoed | echoed on 28/28 |
| `https://localhost` (Capacitor Android) | echoed | echoed on 28/28 |
| `https://attacker.example` | **no header** | absent on 28/28 |
| `https://50mmretina.com.evil.example` (suffix confusion) | **no header** | absent on 28/28 |
| `http://staging.50mmretina.com` (scheme downgrade) | **no header** | absent on 28/28 |

Before this deploy, every one of the first four cases received `*`.

## 2. Checks the deploying session did not run, run here

**Non-CORS callers are not broken.** A request with no `Origin` header must still receive `*` —
that path serves non-browser callers and `getSecureHeaders()` call sites that pass no request.
`dashboard-init`, `submit-judge-decision`, `s3-upload` → `*`. Correct.

**`verify_jwt` was not silently changed.** A redeploy that flipped this would either lock out
legitimate callers or expose an endpoint. Distinguished by response body — the gateway and the
function reject differently:

```
rank-feed, s3-upload, cast-photo-vote, create-payment-session,
s3-delete, s3-presign-upload, get-payment-gateways-public
        -> {"error":"Unauthorized"}                     function's own check = verify_jwt:false ✅
dashboard-init
        -> HTTP 200                                     reached the function  = verify_jwt:false ✅
complete-round, submit-deposit
        -> {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}        gateway rejection     = verify_jwt:true  ✅
```

All 8 `false` functions still `false`; the `true` ones still `true`.

**Production is untouched.** Probed read-only:

```
jtdtehuqtinjxropkkcn ... /dashboard-init   Origin: attacker.example -> access-control-allow-origin: *
```

Production still answers `*`, which is exactly what proves the deploy did not reach it. That
defect remains live in production and is G10's subject, not G9's.

## 3. Two findings worth keeping

**The Supabase CLI cannot deploy from behind an HTTP proxy.** `npx supabase functions deploy`
hung ~38s against `api.supabase.com` and died with `TransportError`, while the proxy logged no
denial for that host. The CLI's bundled Go binary ignores `HTTPS_PROXY`; `NODE_USE_ENV_PROXY=1`
engages undici but the call happens below Node. A plain `curl` with the same token, same host,
same proxy returned `200`. **The CLI was the only broken component.** The deploy went through the
Management API's multipart deploy endpoint instead — the same one the CLI wraps.

This raises the value of `.github/workflows/deploy-functions.yml`: a GitHub runner has direct
network and no proxy, so the CLI works there. It remains the right durable route.

**A cloud session clones the default branch.** The session sent to do the deploy read `main`,
found `startsWith` and `let origin = "*"`, and correctly refused to deploy what it believed was
a regression. It was right about the code it could see and wrong about the conclusion: the fix
lives on `staging`. Any future handoff must name the branch. Confirmed:

```
origin/main   : let origin = "*";  ALLOWED_ORIGINS.some(o => requestOrigin.startsWith(o))
staging 9f3d20a: isCorsRequest / three-case ACAO / ALLOWED_ORIGINS.includes(o)
```

That refusal was good judgement, not an obstacle — deploying `main`'s file over the 28 would
have reintroduced the prefix-match bypass.

## 4. G9 exit conditions

| condition | state |
|---|---|
| CORS policy correct in source | ✅ `9f3d20a` on `staging` |
| CORS policy live on all 28 functions | ✅ **28/28, 140 preflights, verified independently** |
| non-CORS callers preserved | ✅ |
| `verify_jwt` preserved on all 28 | ✅ |
| judge tag mirror fixed | ✅ runtime-proven on `submit-judge-decision` v4 |
| `_redirects` invalid rule removed | ✅ `no rules emitted` in a real staging build |
| regression green | ✅ tsc 0 · vitest 2311/0 · isolation 21/21 · SEO 15/15 · guard 385 assets/3 roots |
| lane isolation, stored data | ✅ repaired and re-measured |
| production untouched | ✅ measured this session |
| **Turnstile parity** | ⛔ **OWNER DECISION — open.** Not verified, not assumed, not deferred |
| **token `sbp_417b…` rotation** | ⛔ **OWNER ACTION — open.** Pasted into a session transcript |

**All technical exit conditions are met and demonstrated.** G9 closure is held only by the two
owner items above, which remain recorded as blockers rather than converted.

`origin/main` untouched at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`. **G10 not started.**
