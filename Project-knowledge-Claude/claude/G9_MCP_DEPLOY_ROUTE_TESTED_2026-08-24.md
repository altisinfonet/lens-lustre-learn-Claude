# G9 · The MCP deploy route was tested and rejected on evidence

**Date:** 2026-08-24 · **Gate:** G9 · **Outcome:** route CLOSED by measurement, not by caution.

---

## Why this test happened

Both assistant sessions are behind an egress policy that refuses `api.supabase.com`, so
`supabase functions deploy` cannot run. The Supabase MCP server reaches the API server-side and
is unaffected, but `deploy_edge_function` takes each function's **source as tool arguments** —
the model retypes it. The objection to that route has been "a silent transcription slip ships a
broken function." An objection is worth more when it is tested, so it was.

The test asked one question: **can a transcription be proven faithful after the fact?** If yes,
the route is safe and all 26 functions can go today.

## Test 1 — is the server-side bundle hash deterministic?

`deploy_edge_function` returns `ezbr_sha256`, a server-computed hash of the built bundle. If it
depends only on the source, then deploying the same function twice and getting the same hash
proves both transcriptions were identical — and two independent transcriptions agreeing is
effectively proof both were correct.

Deployed the retired `g8-storage-lane-probe` twice with **byte-identical input**:

```
v13   ezbr_sha256 = 66c5bc75ac7dda3bdf04067179609a83ceb240415d15daa425db0d9b2a575e2b
v14   ezbr_sha256 = aaf4c12f1061d00a0123ef3acb0cf365cdede3c4e055146c048264c059655895
```

**Different.** The hash carries build- or version-dependent entropy. It cannot verify source
fidelity, and the differing hash seen earlier on `get-payment-gateways-public` therefore
proves nothing either way. **The proposed verification does not exist.**

## Test 2 — is the channel reliable at this payload size?

Of two attempts to send an ~11 KB function through `deploy_edge_function`, one arrived intact
and one was rejected as malformed:

```
InputValidationError: ... could not be parsed as JSON (first 200 of 11830 bytes)
```

That failure was **loud**, which is the good case. It is direct evidence that payloads of this
size are not reliably transmitted. `complete-round` is 79 KB — seven times larger.

## Conclusion

Two independent measurements, one showing the channel corrupts payloads of this size and one
showing corruption cannot be detected afterwards. **The remaining 25 functions will not be
deployed this way.** This is no longer a judgement call.

## Side effects of the test, and their verification

**`get-payment-gateways-public` → v5.** It was already correct at v4; the redeploy was the
control, not a fix. Verified after:

| branch | result |
|---|---|
| preflight, staging origin | echoed ✅ |
| preflight, `https://localhost` (Android) | echoed ✅ |
| preflight, `attacker.example` | **absent** ✅ |
| preflight, suffix look-alike | **absent** ✅ |
| POST, no `Authorization` | `401 {"error":"Unauthorized"}` ✅ |
| POST, malformed bearer | `401` ✅ |
| POST, non-Bearer scheme | `401` ✅ |
| `OPTIONS` | `200 ok` ✅ |
| POST, **valid session** | **NOT VERIFIED** — no staging session available this session |

`get_edge_function` was then called and the deployed source returned matching the repo. The one
unverified branch is recorded as unverified, not assumed.

**`g8-storage-lane-probe` → v14**, now a two-line `410` responder. This was an outstanding
cleanup item; it is done, though the slug still exists rather than being deleted.

## What is still true

26 of 28 functions that bundle `_shared/secureHeaders.ts` still answer **`*`** to any origin.
Measured now, after the push: `dashboard-init` → `access-control-allow-origin: *` for
`attacker.example`; `get-payment-gateways-public` → absent. The fix is committed and pushed at
`9f3d20a`; it is live on 2 functions.

**The only remaining route is the egress policy**, which is environment configuration in Claude
Code on the web, not anything in the repo or a container:

```
allow:  api.supabase.com
allow:  ztzutckwdhetphwghuzj.supabase.co
NOT:    jtdtehuqtinjxropkkcn.supabase.co   (production — must stay blocked)
```

It takes effect for a **new** session. After that, `supabase functions deploy` is one command,
and `.github/workflows/deploy-functions.yml` remains the durable route.

**G9: BLOCKED.** Not GREEN, not deferred. `origin/main` untouched at `32930e75…`. G10 not started.
