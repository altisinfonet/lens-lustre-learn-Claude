# Google OAuth branding — screen-by-screen check

**Goal:** find out why the Google sign-in screen shows the Supabase project ID
(`jtdtehuqtinjxropkkcn.supabase.co`) instead of **50mm Retina World**, even though
your Branding page says "Your branding has been verified and is being shown to users."

**Time:** about 5 minutes. **Cost:** nothing. This is read-only — you are not
changing any setting in Part A, B or C.

---

## Before you start — the one thing that makes this easy

A Google OAuth **Client ID** looks like this:

```
123456789012-a1b2c3d4e5f6g7h8.apps.googleusercontent.com
^^^^^^^^^^^^
this number IS the Google Cloud project number
```

So you do **not** need to compare long strings. You only need to compare the
**number before the first dash** against the project number of the Google Cloud
project where your branding is verified.

**Do not paste the Client Secret anywhere — not into this chat, not into a
document. It is not needed for this check.** The Client ID prefix is enough,
and even that you can just report to me as "match" or "mismatch".

---

## PART A — find which Client ID Supabase is actually using

**A1.** Go to <https://supabase.com/dashboard> and sign in.

**A2.** Open your project. Confirm you are in the right one: the project
reference shown in the URL (or under Project Settings → General) must be
`jtdtehuqtinjxropkkcn`. If it is not, you are in the wrong project — switch.

**A3.** In the left sidebar click **Authentication**.

**A4.** Click **Sign In / Providers**.
*(On older dashboard versions this menu item is just called **Providers**. If you
see neither, look for **Configuration → Providers**.)*

**A5.** Find **Google** in the provider list and click it to expand.

**A6.** Look at the **Client IDs** field. Write down **only the digits before the
first dash**.

> Example: if it reads `481920374651-k9m2...apps.googleusercontent.com`,
> write down `481920374651`.

Call this **Number A**.

**A7.** While you are here, note whether the Google provider toggle is **Enabled**.
Also note whether the **Callback URL (for OAuth)** shown on this screen reads
exactly:
```
https://jtdtehuqtinjxropkkcn.supabase.co/auth/v1/callback
```

---

## PART B — find the project number of your *verified* branding project

**B1.** Go to <https://console.cloud.google.com>.

**B2.** Look at the **project picker** in the top blue bar. It must be the same
project where you saw the "Branding" page with the green tick. If you are not
sure, click the picker, and choose the project you were in when you took that
screenshot. **This step is the whole point of the exercise — getting it wrong
makes the rest meaningless.**

**B3.** Get the project number. Either way works:

- **Easiest:** on the Cloud Console home / Dashboard, find the **Project info**
  card. It lists **Project name**, **Project ID** and **Project number**. Take
  the **Project number** (all digits).
- **Or:** navigation menu → **Google Auth Platform** → **Clients**. Every client
  listed there begins with the same digit prefix. Take that prefix.
  *(On older consoles this is **APIs & Services → Credentials**.)*

Call this **Number B**.

---

## PART C — compare

| Result | What it means | What it costs to fix |
|---|---|---|
| **Number A = Number B** | Supabase is using a client from your verified project. Your app name and logo are wired correctly. The `supabase.co` text you are seeing is the **redirect domain**, which branding verification never changes. | Supabase **Custom Domain** add-on, ~$10/month on top of Pro. Confirm the current price on your own billing page. |
| **Number A ≠ Number B** | Supabase is pointed at an OAuth client in a **different** Google Cloud project — one that has no branding. That is why Google falls back to showing the raw URL. | **Free.** Follow Part D. |

Tell me which one you got. You can just say "match" or "mismatch" — I do not need
the numbers themselves.

---

## PART D — only if you got MISMATCH

You will create (or reuse) an OAuth client **inside the verified project**, then
point Supabase at it.

**D1.** In Cloud Console, confirm the project picker still shows the **verified**
project.

**D2.** Navigation menu → **Google Auth Platform** → **Clients**.
*(Older console: **APIs & Services → Credentials**.)*

**D3.** If a **Web application** client already exists there, open it and skip to
D5. Otherwise click **Create client** → Application type: **Web application**.

**D4.** Name it something you will recognise later, e.g. `50mm Retina World — Web`.

**D5.** Under **Authorised JavaScript origins**, add:
```
https://50mmretina.com
```
Add `https://www.50mmretina.com` too **only if** your site actually serves on the
`www` host.

**D6.** Under **Authorised redirect URIs**, add this exactly — one character wrong
and every Google login fails:
```
https://jtdtehuqtinjxropkkcn.supabase.co/auth/v1/callback
```

**D7.** Click **Save**. Copy the **Client ID** and **Client Secret**.

**D8.** Back in Supabase → **Authentication → Sign In / Providers → Google**,
replace both fields and click **Save**.

**D9.** Test in a **new incognito/private window**. Google caches your previous
consent, so a normal window will often show the old screen and make you think
nothing changed.

---

## PART E — worth checking while you are in there

These are common reasons branding looks "verified" but does not display.

**E1. Publishing status.** Google Auth Platform → **Audience**. **Publishing
status** must be **In production**. If it says **Testing**, only the accounts on
your test-user list see the branded screen; everyone else gets the fallback.

**E2. Branding fields.** Google Auth Platform → **Branding**. Confirm:
- App name: `50mm Retina World`
- App logo: present (yours is)
- **Application home page**: `https://50mmretina.com`
- **Privacy policy link** and **Terms of service link**: both filled in and
  publicly reachable
- **Authorised domains** includes `50mmretina.com`

**E3. Scopes.** Google Auth Platform → **Data access**. For sign-in you should
only need `openid`, `email` (`userinfo.email`) and `profile` (`userinfo.profile`).
These are non-sensitive, so adding them does **not** trigger a new verification
review. If a **sensitive** or **restricted** scope has crept in, your app can be
pushed back into review and the branding stops showing.

---

## What happens next (my side)

- **If mismatch:** Part D fixes it and there is no code change at all. Nothing to
  rebuild, no new AAB.
- **If match:** removing `jtdtehuqtinjxropkkcn.supabase.co` needs the Supabase
  Custom Domain add-on. That changes `VITE_SUPABASE_URL` in `.env`, which means a
  fresh web deploy **and a new Android AAB** — your `capacitor.config.ts` has no
  `server.url`, so the app ships its own bundle and will keep using the old URL
  until it is rebuilt. I will write that runbook in the correct order, because the
  new callback must be added to Google **before** the custom domain is activated,
  or logins break during the switchover.

---

## A note on what I can and cannot do

I have no access to your Google Cloud Console or Supabase dashboard, and I am not
going to ask you for credentials or tokens to get it. Every step above is
something only you can perform. What I can do is prepare the code, the `.env`
change, the release ordering and the verification steps once you tell me the
result of Part C.
