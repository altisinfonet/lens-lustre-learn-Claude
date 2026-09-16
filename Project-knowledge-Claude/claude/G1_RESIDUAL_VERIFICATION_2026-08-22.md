# G1 — RESIDUAL VERIFICATION (preview artifact exposure)

Run: 2026-08-22, ~09:31–09:34 UTC. **Nothing changed, deleted, deployed, created
or merged. No Access-policy modification attempted.**

## Methodology

Cloudflare Pages "Restrict previews with Cloudflare Access" is a **host-pattern
control over `*.<project>.pages.dev`**, not a per-deployment setting. So the
correct test is not a statistical sample of 1,558 independent objects — it is a
boundary test of one control: which host shapes are gated and which are not.
Sampling more hashes adds no information once the pattern is established.

Every URL below was fetched for the **first time** in this session (no cached
response can be involved) and without query strings.

Readout limitation, stated up front: the sandbox proxy blocks `curl` to
`*.pages.dev` (`HTTP:000`), so HTTP status codes cannot be read directly. The
available signal is `WebFetch`'s `ROBOTS_DISALLOWED`, which occurs when the
request is redirected to `cloudflareaccess.com`, whose robots.txt forbids
crawlers. It is an **indirect** signal.

## Results

| Host shape | URL sampled | Result |
|---|---|---|
| Branch alias | `staging-web-isolation-guard.…pages.dev/robots.txt` | blocked |
| Branch alias | `staging-schema-dump-tool.…pages.dev/sitemap.xml?cb=…` | blocked |
| **Production branch alias** | `main.…pages.dev/robots.txt` | **blocked** |
| Deployment hash (schema-dump-tool) | `fb769401.…pages.dev/robots.txt` | blocked |
| Deployment hash (schema-dump-tool) | `2d42c6fc.…pages.dev/robots.txt` | blocked |
| Deployment hash (schema-dump-tool) | `cf439034.…pages.dev/robots.txt` | blocked |
| Deployment hash (web-isolation-guard, was live) | `4e3ffca2.…pages.dev/robots.txt` | blocked |
| **Production deployment hash** | `19064989.…pages.dev/robots.txt` | **blocked** |
| **Hash that never existed (control)** | `00000000.…pages.dev/robots.txt` | **blocked** |
| **Bare project alias (control)** | `lens-lustre-learn-claude.pages.dev/robots.txt` | **SERVED** |
| **Bare project alias (control, 2nd path)** | `lens-lustre-learn-claude.pages.dev/manifest.json` | **SERVED** — `"name": "50mm Retina World"` |
| **Custom domain (control)** | `50mmretina.com/robots.txt` | **SERVED** |

### What the controls prove, and what they do not

- The `00000000` control shows the signal **cannot distinguish "gated" from
  "never existed"**. On its own, a blocked hash is not proof of gating.
- The discriminator is therefore the **before/after on identical host shapes**:
  the same branch-alias URLs served full application content in the pre-change
  baseline and are blocked now, while the bare project alias and the custom
  domain still serve on freshly-fetched paths.
- Gating is applied to **every subdomain**, including `main.` and a production
  deployment hash. Only the bare project alias and the custom domain remain
  public. That matches Cloudflare's documented behaviour: preview URLs are
  protected; production `pages.dev` and custom domains are managed separately.

## Findings

1. **Anonymous access is blocked** on every preview surface sampled — branch
   aliases and deployment-hash URLs alike.
2. **No publicly accessible preview was found.** Because the control is
   host-pattern based rather than per-deployment, coverage of all 1,558 is
   **structural, not sampled**: a deployment's age or branch does not change the
   host pattern it is served under.
3. **The 1,558 artifacts are NOT a staging-safety blocker.** They predate the
   staging project entirely, contain no reference to `ztzutckwdhetphwghuzj`, and
   cannot be added to — Preview branch is `None`, so no new preview will ever
   build, including from a future `staging` branch. They are a **production**
   access-control legacy, not a staging-isolation defect.

## Limitations carried forward (recorded, not acted on)

- **The Access allow-list remains unread.** Zero Trust is not onboarded, so the
  policy is behind a plan wall. The gate demonstrably blocks anonymous requests;
  **who it admits is unknown.** If the auto-created policy admits any email that
  can complete a one-time PIN, then ~1,500 production-backed builds are reachable
  by anyone willing to do so — better than fully public, but not closed. This is
  the single most important open item from G1 and it is a production security
  question, not a staging one.
- HTTP status codes could not be read directly from this session; the evidence is
  the redirect-to-Access signal plus before/after on identical URLs.
- `ISOLATION_FORBIDDEN_REFS` on Production variables and deployment `9c0c1201`
  are retained as instructed and are not revisited here.
