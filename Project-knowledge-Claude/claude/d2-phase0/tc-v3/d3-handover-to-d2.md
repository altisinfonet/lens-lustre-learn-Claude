# D3 → D2 · two methods worth keeping · 2026-09-04

D3 is retired; its unit (TC-v3, OWNER-RULING-2026-09-03-02) is closed except for the Owner's Android
reading. Two things cost this session most of a day to find, and both will come back in Phase 5.

---

## 1 · Rendering the real app when the egress proxy blocks the browser

**The symptom.** `curl -x $HTTPS_PROXY https://staging.50mmretina.com/` returns **200**, while
Chromium against the same URL through the same proxy returns **`net::ERR_CONNECTION_RESET`** — every
time. Four configurations were tried (default egress; Playwright's `proxy: { server }`;
`--proxy-server` with `--proxy-bypass-list=<-loopback>`, `ignoreHTTPSErrors` and `NODE_EXTRA_CA_CERTS`;
and a fixed browser binary). All four reset. **The proxy serves `curl` and resets the browser.** Do
not spend a day on this: it is not a configuration you are missing.

**What works instead.** Build the app and serve it from **`127.0.0.1`, which is in `no_proxy`, so the
proxy is not in the path at all**:

```bash
VITE_SUPABASE_URL=https://testprojectref0000x.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=test-publishable-key-not-real \
VITE_SUPABASE_PROJECT_ID=testprojectref0000x \
npm run build                                  # the lane vars are REQUIRED: verify-html-tokens.mjs
                                               # fails the build on an unsubstituted VITE_ token
cd dist && python3 -m http.server 4173 --bind 127.0.0.1
node docs/evidence/d2/tc-v3/local-render-measure.mjs
```

Those three values are the repo's own hermetic test values from `vitest.config.ts` — **synthetic on
purpose, never a credential**, and because every request is intercepted nothing reaches a backend
anyway. Feed the card its data with `page.route('**/rest/v1/**')`: the RPC by URL match, and profiles
via **`profiles_public_data`** (not `profiles` — `src/lib/profilesPublic.ts` queries the view).

**Three traps that cost real time.**
- Playwright's browser revision. The repo pins **1.62.1**, which wants `chromium-1234`; this container
  ships **1194**. `npx playwright install` is not run here — pass `executablePath` instead.
- **framer-motion `whileInView` with `viewport={{once:true}}`.** The card's rows do not lay out until
  scrolled to. Measure without `scrollIntoView` first and you measure the pre-animation geometry.
- **jsdom has no `IntersectionObserver`.** The card constructs one on mount, so a component test of
  `Index.tsx` throws before rendering anything. A never-firing stub in `beforeAll` is enough.

**And the boundary.** A local render is **SUBSTITUTED** — it proves the *component*, never a lane's
data or a deployed build. Label every screenshot from it that way. An emulated 360×800 viewport with
an Android user-agent is **not** a device reading, and §3.1 obligation 3 is not closed by one.

---

## 2 · Staging could not exercise either half of this gate — and this is structural

Two independent checks in TC-v3 turned out **non-discriminating on staging**, for the same root cause:
staging's data is too benign to contain the defect.

| check | staging | production | consequence |
|---|---|---|---|
| §3.1 long-name width | longest eligible name **12** chars (`Sofia Duarte`) | **21** (`Partha Sarathi Moulik`); seven members at 17–21 | staging is shorter than `Amit Baran Sen` (14), the row §3.1 calls tightest. The ellipsis **cannot** trigger there |
| §3.4 displayed numbers descend | `recent_score == contributor_score` on all three rows (764/509/509) | recent 7,233/7,055/6,823 against lifetime 9,143/9,551/**11,546** | on staging the numbers descend **either way** — a green §3.4 would have been green on the broken card too |

That second row is **F-68**. The first is the same failure a day earlier. Both were caught by asking
*"could this check have failed?"* before running it — which is C-34 applied to an environment rather
than to a test.

**What to do about it in Phase 5.** Every measurement that depends on data *shape* rather than data
*presence* — feed bytes, LCP, bundle budget, a11y with real content, i18n string lengths — deserves
the same question first. Three ways out, in order of preference: run it against production read-only;
inject the adversarial case and label it SUBSTITUTED; or **seed staging so the shape exists**. The
1M-row seeder D1 landed in **#140** is the durable fix — a seeded name of 21+ characters and a
deliberately non-monotonic score pair would have made both of these checks discriminating without any
substitution at all. Worth raising with the Auditor before Phase 5's kickoff rather than rediscovering
it per unit.

---

## 3 · Left where you will find it

`docs/evidence/d2/tc-v3/` — `local-render-measure.mjs` (the harness above),
`run-substituted-gate.mjs` + `src/__tests__/topContributorsV3.substituted.test.tsx` (a §3.4 gate that
runs anywhere without a browser, shown failing on a mutated component), `after-measure.prepared.mjs`
(the staging-render script; it preflights egress and exits 2 rather than emitting empty geometry —
run it from CI, not from here), and the BEFORE/AFTER/C-34 records.

Three `src/__tests__/` files and the C-34 transcript are still courier-limited and patch-ready in the
Project under `claude/d2-phase0/tc-v3/`.

*D3 · Client & Delivery, retired 2026-09-04. No `src/**` change in this handover, no SQL, no
`supabase/**`, no `docs/gates/**`, no ledger.*
