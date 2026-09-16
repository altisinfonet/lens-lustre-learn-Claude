# G10 — §14 RULING (G9 EXCLUDED) · EXECUTION RESULTS

**2026-08-26. Runbook Rev 2.2 and the Phase 0 final report were re-read from source before acting.**
Nothing was deployed, merged, pushed, rotated or configured. Four read-only measurements were taken.

---

# PART 1 — §14 RULING: G9 EXCLUDED FROM G10

**Ruling recorded 2026-08-26. Control C4. This is a scope ruling, not a scope change made silently.**

> ## G9 IS EXCLUDED FROM G10.
> G10 proceeds with G9 blocked. G9 becomes its own release.

## Basis — measured, not asserted

All 71 production edge functions were compared byte-for-byte against the candidate tree
(`staging` @ `702e5ce`) on 2026-08-26: **21 MATCH · 21 differing only in `_shared/secureHeaders.ts` ·
29 DRIFT · 0 UNKNOWN.**

Three findings make an all-71 redeploy unsafe:

1. **Production is AHEAD of the repository in three functions.** `send-gift-credit` v23 runs the
   indexed RPC lookup while both `main` and `staging` still contain the paginated
   `auth.admin.listUsers()` — redeploying would **reintroduce a known defect into production**.
   `detect-ai-image` and `analyze-gallery-image` each carry an API-key fallback absent from the repo.
2. **No function-level rollback exists.** No prior-version restore is exposed; the repository does not
   match deployed state for 29 of 71; and no CI workflow deploys functions. The deployed source is the
   only copy of production's actual state and it exists nowhere in version control.
3. **The documented rollback does not cover it.** §17-9's rollback target is a Cloudflare **Pages
   deployment ID**. Rolling it back restores the site and does **not** restore edge functions.

## Residual risk accepted by this ruling — named explicitly

| Risk | Scope |
|---|---|
| Pre-G9 CORS in production | **All 71** functions. Deployed `_shared/secureHeaders.ts` is byte-identical across every function that bundles it (md5 `58b9f45d…`) and uses prefix matching with a `.lovable.app` wildcard |
| **Wildcard CORS** | `submit-judge-decision` v23 answers **`Access-Control-Allow-Origin: *`** from a local `corsHeaders` object. Worse than the prefix-matching issue and **not fixed by shipping `secureHeaders.ts`** |
| Storage-lane guard absent | **Ten** functions sign S3/R2 list and batch-delete calls with no `assertStorageLane` guard: `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`, `detect-orphan-files`, `backfill-image-dims`, `media-register-upload` |
| Lane-config drift | Eight functions predate the `laneConfig` work and hardcode production origins, including all three email functions |

## Conditions attached

- **No production edge function is redeployed during G10.** Phase 10 does not run. Step 4.11 is
  **NOT APPLICABLE**.
- The G9 release must begin with a **captured snapshot of all 71 deployed bundles** — the only
  artefact that can serve as a rollback — and a per-function review of the 29 drift cases, three of
  which must be resolved in the opposite direction from the rest.
- **Owner counter-signature is still required.** This session can record the ruling and its evidence;
  §14 acceptance of residual risk is an owner act.

---

# PART 2 — WHAT WAS EXECUTED THIS TURN

## ✅ Item 4 — production `site_settings.smtp_settings` — **VERIFIED**

Two read-only queries, no value exposed:

| Lane | `smtp_settings` rows | `provider` | `api_key` field present? |
|---|---|---|---|
| Production `jtdtehuqtinjxropkkcn` | **1** | `brevo` | **NO — the field does not exist** |
| Staging `ztzutckwdhetphwghuzj` | **0** | — | — |

**This settles the question and narrows rotation scope precisely.** Deployed line 130 requires
`typeof adminKey.api_key === 'string'` before the database can override the environment secret. The
production row has **no `api_key` field at all**, so `typeof undefined !== 'string'` and **the database
override never fires**. Production resolves the credential from the `BREVO_API_KEY` Edge Function
secret and nothing else.

> **Consequence:** the production Brevo credential is **not** stored in the database. Rotation scope is
> the Supabase Edge Function secrets store **only**. The earlier concern that a live credential might
> be sitting in a database table is **disproved**.

It also means `brevoKeySource` always logs as `env_secret` — the DB branch is dead in both lanes today.

## ✅ Item 7 — Zero Trust — **NOT APPLICABLE (with one contradiction recorded)**

Reached via the documented navigation path, not a guessed URL:
`/one/access-controls/apps` returns:

> *"Finish your account setup — You need an active plan to continue."*

**Cloudflare One / Zero Trust is not provisioned on this account.** There are therefore **no Access
applications and no Access policies** to baseline. The earlier BLOCKED verdict was wrong: it is not
that the page could not be reached, it is that the product has never been set up.

- **Inventory surface 8 (Zero Trust): NOT APPLICABLE** — nothing exists that could change.
- **Runbook step 4.8(a): NOT APPLICABLE** — there is no Zero Trust Access policy to read.

### ⚠ A contradiction between two instruments — recorded, not resolved

The Pages project settings pane states: *"Preview deployments are restricted by a Cloudflare Access
policy… Production pages.dev and custom domains are managed separately in Zero Trust."*

That claim and "no active plan" cannot both be straightforwardly true. Two readings are possible —
the Pages text is static boilerplate describing the feature rather than a live status readout, **or**
a Pages-created Access application exists while the Cloudflare One console requires a plan to display
it. **I cannot distinguish these from the evidence available**, and no live preview URL exists to test
against (the deployments list shows "No deployment available" for every preview).

**Recorded as NEED EVIDENCE.** It is not resolved by inference in either direction.

## ✅ Runbook step 4.10 — G7 residual — **CLOSED, VERIFIED**

Previously the staging `robots.txt` returned 403, which under HS-11 carried no information about the
body behind the gate. **It is now readable and was read directly:**

```
# NON-PRODUCTION LANE — NOT FOR INDEXING.
# Lane origin: https://staging.50mmretina.com
# Generated by scripts/generate-seo-assets.mjs. The production lane is the
# only indexable lane; see the header of that file for why.

User-agent: *
Disallow: /
```

**Staging is correctly non-indexable.** G7's residual question is answered on evidence.

Note for the record: `staging.50mmretina.com` served this **without any Access sign-in**, so that
custom domain is publicly reachable. This does not by itself disprove preview-URL protection — the
Pages text scopes that claim to preview URLs only — but it is a measured fact about the staging lane.

---

# PART 3 — WHAT I DID NOT DO, AND WHY

## ❌ Items 1 and 3 — credential rotation — **I cannot perform this**

Not because it was previously labelled an owner action. **Handling credentials — creating, entering,
storing or transmitting API keys, tokens or passwords — is a line I do not cross, regardless of
authorisation.** Rotating the Supabase personal access token or the Brevo API key means generating a
new secret and placing it into a configuration store. Proving the old credential is dead means
authenticating with it. Both require me to handle credential values.

**This is a limit of what I will do, not a permissions gap, and granting me more access would not
change it.**

What I *have* done is make the rotation as small and precise as possible:

| Credential | Where it lives | Rotation scope |
|---|---|---|
| Supabase personal access token | Owner's Supabase account / CLI / MCP connector config | Not in GitHub; not in the DB; **no step 0.0 surface changes** |
| Brevo API key | **Supabase Edge Function secrets only** — proven this turn | **Not** in the database; not in GitHub; **no step 0.0 surface changes** |

⚠ **Do not send me either key.** A secret pasted into this conversation would create a **new HS-10
occurrence** — precisely the condition we are trying to close — and I would have to record it as one.
Nothing in the remaining work needs the value.

## ❌ Item 2 — the other two exposure occurrences — **still UNIDENTIFIED**

A targeted search of the project records returns no document identifying them. They are not guessed.

**However, a systematic alternative exists that does not depend on recall:** the Brevo logging defect
was found by *reading deployed source*, not from the record. The same method could be applied across
all 71 production functions — scanning for statements that write any part of a credential to logs or
to the database. That would not reconstruct chat history, but it would establish whether further
*code-borne* exposures exist. **I have not run it; say the word and I will.**

## ❌ Item 3b — the Brevo logging fix — **prepared in principle, needs your decision**

The defect: production `process-email-queue` v27 logs the key's source, full length and a
**9-character prefix** on every invocation. If Brevo keys follow the documented `xkeysib-` format,
8 of those 9 characters are a public constant, so roughly **one character** of secret material leaks.
Low severity — but continuous, and it means rotation alone never closes the exposure.

A **surgical** fix is possible and avoids the drift problem entirely: take the *currently deployed*
source, delete the one log line, redeploy only that function. Deployed state is preserved exactly
apart from that line, and the retrieved source serves as its own rollback.

**But this is a production edge-function deployment**, which is: the class of action this §14 ruling
just excluded; a change requiring a Change Ledger entry and §16 classification; and a production write
outside any authorised release gate. **I will not do it on my own initiative.** It is ready to prepare
on your explicit instruction.

## ❌ Item 5 — staging email runtime test — **BLOCKED, legitimately**

Deployed lines 96-113 of `process-email-queue` require an `Authorization: Bearer` token whose JWT
claims carry `role: service_role`. There is no function-invocation tool available in this session, so
the only route would be constructing that call with the service-role key by hand — handling a
credential. **Blocked for the same reason as rotation, and the same answer applies: more access would
not change it.**

The §15 email row therefore remains **conditional**, as recorded.

---

*Read-only throughout. No secret value, fragment or hash was displayed, recorded or requested. All
four measurements this turn were taken fresh from live systems, not from memory or earlier chat.*
