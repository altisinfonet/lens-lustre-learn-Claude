# F-102 — the Wallet 401. One identifier, and a silence that hid it.

Found by the Auditor on 2026-09-05 while sweeping for damage after an unrelated
deploy: `get-payment-gateways-public` returned **401 to properly signed-in
members on both lanes** — six calls, six 401s, including one real member on
**production at 10:17**.

**Authorised scope:** Owner's ruling, **staging only**
(`ztzutckwdhetphwghuzj`). One identifier in one file, plus the log line.
Nothing else under `supabase/`. Production is untouched and stays untouched
until the Auditor brings him proof.

## The fault

```ts
const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
```

This function loads `supabase-js@2.49.1` through esm.sh, and `auth.getClaims`
does not exist there. So the line did not *return* an error — it **threw**, and
the `catch` below turned that into `Unauthorized`. The member was authenticated
perfectly well; the wallet could not ask.

`getUser()` is the method this version has. It verifies the JWT against the auth
server rather than reading it locally, and `user.id` is the same subject
`claims.sub` was reaching for. **The check is unchanged in meaning:** a caller
with no verifiable user is refused.

## Why nobody found it for days

```ts
} catch {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, … });
}
```

**Bare.** No logging of any kind — while the 500 handler forty lines below calls
`console.error`. A `TypeError` inside the auth block was indistinguishable, from
the outside *and from every log*, from a member presenting a bad token.

Measured in the log window: **seven 401s — 14:03, 14:57, 16:41, 17:08, 17:09,
17:14, 01:50 — and not one `function_logs` line among them.**

A failure mode that writes nothing to any log has no discoverer. The response is
deliberately unchanged (still a bare `Unauthorized`, still 401 — the caller must
not learn why); the difference is that *we* can see it.

## C-34 — proven in the running Deno runtime, not inferred from npm

The Auditor proved `getClaims` is undefined on 2.49.1 by installing the npm
package. This function loads it through **esm.sh**, and that link was inferred
rather than executed. The plant closes it.

| Step | Build | Result |
|---|---|---|
| **PLANT W1** (deployed `version 8`) | `getClaims` restored, **with** the new `console.error` | **401**, and the log line below |
| **FIX** (deployed `version 9`) | `getUser`, non-member Bearer | **401** at `02:41:30Z`, and **no `function_logs` line at all** |

PLANT W1, `2026-09-06T02:38:52.368Z`, `source: function_logs`:

```
get-payment-gateways-public: auth check threw TypeError: userClient.auth.getClaims is not a function
    at Object.handler (file:///var/tmp/sb-compile-edge-runtime/functions/get-payment-gateways-public/index.ts:45:74)
    at mapped (ext:runtime/http.js:246:44)
    at respond (ext:runtime/http.js:342:9)
    at handleHttp (ext:runtime/http.js:162:9)
    at eventLoopTick (ext:core/01_core.js:175:7)
```

That is the chain closed at the runtime: **esm.sh + Deno + 2.49.1 →
`getClaims is not a function`.**

And the two 401s are now **distinguishable**, which is the whole point of the
log line: a throw is loud, a legitimate refusal is silent.

## Still owed, and NOT claimed

**The signed-in 200 is not in this register.** This session has no member JWT —
an anonymous or anon-key caller is correctly refused by the fixed build too, so
the success path cannot be exercised from here. The Auditor calls it as a
signed-in member and pastes the 200 and the `payment_gateways` object. Until he
does, this is *"the throw is gone"*, not *"the wallet works"*.

Deployed: `version 9`, `2026-09-06T02:41:15Z`, `verify_jwt: false` preserved,
`_shared/secureHeaders.ts` byte-identical. **Staging only. Production untouched.**
