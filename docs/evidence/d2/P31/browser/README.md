# P31 · BROWSER PROOF — taken under OWNER RULING 2026-09-04-01

**"Staging proved" means an instrument ran and produced a reading. Green CI is not a proof.**
jsdom is not a browser (F-53), so the vitest evidence in `../fail-first-20260904.md` does not
discharge this. What follows was taken in real Chromium 141.0.7390.37 by D2 on 2026-09-04.

---

## 1 · FIRST — is the revoke actually applied to the staging DATABASE?

Asked directly, as `anon`, over HTTPS to the live staging PostgREST
(`https://ztzutckwdhetphwghuzj.supabase.co`). Not read from a document, not taken from D1:

```
search_certificates           HTTP 401  {"code":"42501", … "permission denied for function search_certificates"}
email_exists                  HTTP 401  {"code":"42501", … "permission denied for function email_exists"}
verify_certificate            HTTP 200  []
increment_managed_page_view   HTTP 204
```

**P31 and P30 are both applied on staging.** `verify_certificate` and
`increment_managed_page_view` remain granted, which is correct — neither is on §2.1.

The live refusal code is **42501**, which is exactly what `isSearchUnavailableError` was built to
classify. The classifier was written against a predicted code; this is that prediction checked
against the running database.

## 2 · The browser reading

Real Chromium, 390×900, running the **staging-lane production bundle** built from `staging` HEAD
by `npm run build` with the staging lane values from `web-build.yml` — not a dev server, not jsdom.

### A · Search by name — the revoked path

`docs/evidence/d2/P31/browser/A-by-name-42501-search-unavailable.png`

```
searchUnavailable    : true
noCertificatesFound  : false
rawErrorLeaked       : false
panel: "Search Unavailable — Searching by name or course is no longer available.
        You can still verify a certificate using its certificate ID."
served: search_certificates -> HTTP 401 {"code":"42501", …}
```

A member searching by name is told the search is closed. **They are NOT told their certificate
does not exist**, and the underlying error text never reaches the page.

### B · Verify by certificate ID — unknown certificate

`docs/evidence/d2/P31/browser/B-by-id-unknown-not-found.png`

```
noCertificatesFound  : true
searchUnavailable    : false
rawErrorLeaked       : false
panel: "No Certificates Found — The certificate ID you entered does not match any records."
served: verify_certificate -> HTTP 200 []
```

A genuine empty result still reads as an empty result. The two panels are also visually distinct
in the screenshots: "Search Unavailable" is the neutral bordered card with a `Ban` glyph;
"No Certificates Found" is the destructive red card with an `XCircle`. **The distinction the whole
unit exists to create is visible to the eye, not just to a matcher.**

## 3 · STATED PRECISELY — what is real here and what is short-cut

The RPC responses in §2 are **fulfilled locally by the test harness**, and the bodies are the
byte-for-byte responses the **live staging database returned minutes earlier** in §1.

**Why, measured rather than assumed:** this container's egress proxy carries GETs to
`supabase.co` but **RESETS POSTs** — every Supabase RPC is a POST:

```
12:56  REQUEST  POST search_certificates
13:17  FAILED   net::ERR_CONNECTION_RESET   (21 seconds)
```

`curl` traverses the proxy fine (§1 was taken that way); the browser cannot. And
`staging.50mmretina.com`, `www.50mmretina.com` and `cdn-staging.50mmretina.com` are **all blocked
outright** by this session's network policy (`CONNECT tunnel failed, 403`).

**So: the bundle, the browser, the React code path, the rendered DOM and the response payloads are
all real. Only the transport between them is short-cut.** What this does NOT prove is the deployed
`staging.50mmretina.com` origin serving that bundle — that requires a session with egress to it,
and D2 cannot take that reading from here. Recorded as a named missing proof rather than papered
over, exactly as the ruling requires.

## 4 · An unplanned reading, which is the deferred finding happening for real

While the browser could still reach the network, the POST reset after 21 s and the page rendered:

> **"No Certificates Found — No certificates match your search criteria."**

That is correct under the current design — a transport failure is not `42501`, so it falls to the
empty branch — and it is exactly the residual defect raised in PR #148 and deferred: **a network
failure still tells a member their certificate was not found.** Here it is, in a real browser,
not a hypothesis. Still not fixed, still D2's lane, still awaiting the Auditor's ruling.
