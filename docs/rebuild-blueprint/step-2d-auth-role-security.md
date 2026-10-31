# STEP 2D — AUTH, ROLE & SECURITY BLUEPRINT

**Strict mode.** All facts below were directly read from the listed files. Items not present in the inspected files are explicitly marked **NOT VERIFIED**.

**Inspected source files:**
- `src/hooks/core/useAuth.tsx` (274 LOC)
- `src/hooks/core/useIsAdmin.ts` (38 LOC)
- `src/hooks/core/useIsBanned.ts` (25 LOC)
- `src/hooks/core/useTrustedDevice.ts` (47 LOC)
- `src/hooks/core/useAuthPageSettings.ts` (79 LOC)
- `src/hooks/profile/useUserRoles.ts` (36 LOC)
- `src/hooks/profile/useUserDevices.ts` (75 LOC)
- `src/pages/Login.tsx` (450 LOC — first 411 read)
- `src/pages/Signup.tsx` (358 LOC)
- `src/pages/ForgotPassword.tsx` (108 LOC)
- `src/pages/ResetPassword.tsx` (368 LOC)
- `src/lib/passwordSecurity.ts` (220 LOC)
- `src/lib/oauthHelper.ts` (11 LOC)
- `src/lib/deviceFingerprint.ts` (89 LOC)
- `src/lib/activityLog.ts` (37 LOC)
- `src/lib/adminRoleAccess.ts` (97 LOC) — full inventory in Step 2C
- `src/components/SimpleCaptcha.tsx` (76 LOC)
- `src/components/auth/GoogleSignInButton.tsx` (58 LOC)
- `src/components/AutoRole.tsx` (first 50 LOC inspected)
- `src/components/OnboardingModal.tsx` (728 LOC — first 100 LOC read)

---

## 1. AuthProvider — `src/hooks/core/useAuth.tsx`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Global auth context: session, user, loading, signOut. |
| 2. Context shape | `{ session: Session \| null, user: User \| null, loading: boolean, signOut: () => Promise<void> }` |
| 3. Fallback context | When provider missing: returns `{ session: null, user: null, loading: true, signOut: noop }` |
| 4. Storage | `localStorage` (via `supabase/integrations/client.ts`); `persistSession: true`, `autoRefreshToken: true`. |
| 5. Init order | `onAuthStateChange` listener registered FIRST, then `getSession()` polled with up to 5 retries (250ms × attempt backoff). |
| 6. Network resilience | Detects `failed to fetch`, `networkerror`, `load failed`, plus transient JWT/session/refresh errors → retry with exponential backoff. |
| 7. Auth events handled | `INITIAL_SESSION`, `SIGNED_IN`, `USER_UPDATED`, `PASSWORD_RECOVERY` |
| 8. SIGNED_IN side effects | (a) Reset restriction flag. (b) If `user_metadata.full_name`/`name` present and no profile row, create or backfill `profiles.full_name`. (c) `linkReferral()` (100ms). (d) `logAuthEvent("login")` (0ms). (e) `logDeviceSignIn()` (50ms). |
| 9. PASSWORD_RECOVERY side effect | Sets `window.__passwordRecoveryActive = true` + `sessionStorage.password_recovery_active = "true"`. Logs `password_recovery` event. |
| 10. Restriction guard | On every session: queries `profiles.is_suspended, suspended_until, suspension_reason, is_banned`. Auto-lifts expired suspensions. If suspended/banned → stores message in sessionStorage + sets `accountRestricted` → triggers single `supabase.auth.signOut()`. |
| 11. Realtime guard | Channel `profile-guard-${userId}` listens on `profiles` UPDATE filtered to user's id. Only triggers logout if previously NOT restricted AND now restricted (prevents re-trigger loop). |
| 12. signOut() | Logs auth event, calls `resetDashboardBootstrap()`, `clearFeedCache()`, then `supabase.auth.signOut()`. |
| 13. Referral linking | On SIGNED_IN: reads `getStoredReferralCode()`, looks up `referral_codes` by code, inserts into `referrals(referrer_id, referred_id, referral_code_id)` if codeRow.user_id ≠ user.id. Always clears stored code afterwards. |
| 14. Tables read | `profiles`, `referral_codes`, `user_devices` (via logDeviceSignIn). |
| 15. Tables written | `profiles` (insert / update full_name), `referrals` (insert), `activity_logs` (via logAuthEvent), `user_devices` (via logDeviceSignIn upsert). |

---

## 2. Role Resolution Hooks

### 2A. `useIsAdmin.ts`

| Field | VERIFIED |
|---|---|
| Query key | `queryKeys.isAdmin(userId)` → `["is-admin", userId]` |
| Fetcher | `awaitDashboardBootstrap()` → check seeded cache → fallback `supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle()` |
| Returns | `{ isAdmin: boolean, loading: boolean }` |
| Stale time | 5 min |

### 2B. `useUserRoles.ts`

| Field | VERIFIED |
|---|---|
| Query key | `["user-roles", userId]` |
| Fetcher | `awaitDashboardBootstrap()` → check seeded cache → fallback `select role from user_roles where user_id = userId` |
| Returns | `{ roles: string[], loading, hasRole(role: string) => boolean }` |
| Stale time | 5 min |

### 2C. `useIsBanned.ts`

| Field | VERIFIED |
|---|---|
| Query key | `queryKeys.isBanned(userId)` → `["is-banned", userId]` |
| Fetcher | `select is_banned from profiles where id = userId` |
| Stale time | 30 sec |

### 2D. `AutoRole.tsx` (Global Role Cache)

| Field | VERIFIED |
|---|---|
| Purpose | Shared role cache across all `AutoRole` component instances. Prevents redundant queries. |
| TTL | 60s (`ROLE_CACHE_TTL_MS`) |
| Mechanism | In-memory `Map<userId, string[]>` + pending fetch deduplication + batched DB queries. |
| Public APIs | `invalidateRoleCache(userId?)` (used by `liveAdminSync.ts`) |
| NOT VERIFIED | Full batch logic past line 50. |

---

## 3. Login Page — `src/pages/Login.tsx`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Email+password login + Google/Apple OAuth + lockout protection + trusted device prompt. |
| 2. Layout | `h-screen` viewport-locked split: left half image (lg+), right half form. |
| 3. Two-step form | Step 1: email entry → "Proceed". Step 2: password entry + optional captcha. |
| 4. Validation | Zod: `email` valid email, max 255; `password` min 1, max 72. |
| 5. OAuth flow | `signInWithOAuth(provider)` → `lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin })`. Pre-clears local session via `signOut({ scope: 'local' })`. |
| 6. Captcha gate | Triggered after 3 failed attempts (`needsCaptcha = failedAttempts >= 3`). Renders `<SimpleCaptcha>`. |
| 7. Lockout | `getLockedOutSeconds()` checked before submit. If > 0, blocks with countdown timer (1s interval). |
| 8. Network retry | `withNetworkRetry(operation, 2)` wraps `signInWithPassword` — 800ms × attempt backoff. |
| 9. Failed attempt handling | `recordFailedAttempt()` → resets captcha, may set lockout. Network errors do NOT count as failed attempts. |
| 10. Trust device prompt | After successful sign-in: if `isDeviceTrusted(user.id)` → navigate `/feed`. Else show "Trust This Device?" prompt → `trustDevice(user.id)` if Yes → navigate `/feed`. |
| 11. Suspension message | On mount: reads `sessionStorage.suspension_message` → displays as error → removes from storage. |
| 12. Friendly error mapper | Maps raw Supabase errors to user-friendly strings (network / invalid credentials / email not confirmed / rate limit). |
| 13. Hooks | `useAuth`, `useNavigate`, `useTrustedDevice`, `useAuthPageSettings`, `useSiteLogo` |
| 14. Components | `GoogleSignInButton`, `SimpleCaptcha`, inline Apple SVG button, `Loader2`, `Eye`/`EyeOff` |
| 15. Settings used | `cfg.background_image`, `cfg.show_logo`, `cfg.heading`, `cfg.heading_accent`, `cfg.subtitle`, `cfg.show_apple` |

---

## 4. Signup Page — `src/pages/Signup.tsx`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Email+password signup + Google/Apple OAuth + captcha + referral capture. |
| 2. Two-step form | Step 1: full name + email → Step 2: password + captcha. |
| 3. Validation | Zod: `fullName` 2-37 chars, `email` valid email max 255, `password` min 8 max 72. |
| 4. Captcha | `SimpleCaptcha` ALWAYS required on step 2 (mandatory, not gated by attempts). |
| 5. Password strength meter | 5-segment bar based on score (length≥8, length≥12, uppercase, digit, special). |
| 6. Signup call | `supabase.auth.signUp({ email, password, options: { data: { full_name: normalized }, emailRedirectTo: window.location.origin } })` |
| 7. Newsletter side-effect | On success: upserts into `newsletter_subscribers` with `source: "registration"`, conflict on `email`. |
| 8. Referral capture | `useCaptureReferral()` hook on mount. |
| 9. Auto-redirect | If `user` already authenticated: `navigate("/dashboard")`. |
| 10. Success view | "Check Your Email" panel with verification reminder. |
| 11. Hooks | `useAuth`, `useNavigate`, `useCaptureReferral`, `useAuthPageSettings`, `useSiteLogo` |
| 12. Tables written | `newsletter_subscribers` (upsert), plus `auth.users` via `signUp`. |

---

## 5. ForgotPassword Page — `src/pages/ForgotPassword.tsx`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Send password reset email. |
| 2. Validation | Zod: `email` trim valid email max 255. |
| 3. Call | `supabase.auth.resetPasswordForEmail(email, { redirectTo: ${window.location.origin}/reset-password })` |
| 4. Success view | "Check Your Email" with masked confirmation. |
| 5. No captcha or rate limit (page-level). |

---

## 6. ResetPassword Page — `src/pages/ResetPassword.tsx`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Set new password from recovery link. |
| 2. Recovery detection (3 paths) | (a) Global `window.__passwordRecoveryActive` flag from AuthProvider. (b) `onAuthStateChange("PASSWORD_RECOVERY")`. (c) URL hash/query: `type=recovery` or `access_token`/`refresh_token` present. |
| 3. Custom token path | If `?recovery_token=...&recovery_email=...` present: shows "Continue Reset" button → `supabase.auth.verifyOtp({ email, token, type: "recovery" })` → `getUser()` → activates recovery state. |
| 4. Password strength | `validatePasswordStrength(password)` from `passwordSecurity.ts`. |
| 5. Reuse check | `isPasswordReused(userId, password)` — blocks reuse of last password. |
| 6. Update call | `supabase.auth.updateUser({ password })` |
| 7. Post-success | `recordPasswordUsage(userId, password)` → success view with "Sign Out From All Devices" button → `supabase.auth.signOut({ scope: "global" })` → `/login`. |
| 8. Cleanup | Clears `sessionStorage.password_recovery_active` + `window.__passwordRecoveryActive` on success. |
| 9. Invalid link state | If not in recovery and no pending token: shows "Invalid Reset Link" with link to `/forgot-password`. |

---

## 7. Password Security — `src/lib/passwordSecurity.ts`

### 7A. Strength Validation

| Rule | Behavior |
|---|---|
| Min 8 chars | required |
| ≥ 12 chars | bonus score |
| ≥ 1 uppercase | required |
| ≥ 1 lowercase | required (no score) |
| ≥ 1 digit | required |
| ≥ 1 special char | required |
| Common password blocklist | ~40 entries; matches reduce score by 2 |
| Score range | 0-5 |

### 7B. Password Reuse Prevention

| Field | VERIFIED |
|---|---|
| Storage | `localStorage[pw_history_${userId}]` |
| Hashing | SHA-256 with `_50mm_retina_salt` via SubtleCrypto |
| History size | `MAX_HISTORY = 1` (only last password stored) |
| APIs | `isPasswordReused(userId, password)`, `recordPasswordUsage(userId, password)` |
| **Note** | Client-side only — for comparison, NOT auth security. |

### 7C. Lockout Mechanism

| Failures | Lockout |
|---|---|
| 3 | 30 seconds + captcha required |
| 5 | 2 minutes |
| 7 | 5 minutes |
| 10+ | 15 minutes |
| Reset window | If last attempt > 1 hour ago, counter resets. |
| Storage | `localStorage.login_lockout` |
| APIs | `getLockedOutSeconds()`, `getFailedAttempts()`, `recordFailedAttempt()`, `resetLockout()` |

---

## 8. OAuth Helper — `src/lib/oauthHelper.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Wrapper over `lovable.auth.signInWithOAuth(provider, { redirect_uri })`. |
| Providers | `"google"` and `"apple"` |
| Redirect URI | `window.location.origin` |
| **Note** | Uses `@/integrations/lovable/index` — not direct Supabase OAuth. |

---

## 9. Trusted Device — `src/hooks/core/useTrustedDevice.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Per-device "remember me" via localStorage. |
| Device ID | `localStorage["50mmretina_device_id"]` = `crypto.randomUUID()` (created on first call) |
| Trust map | `localStorage["50mmretina_trusted_devices"]` = `{ [userId]: deviceId[] }` |
| APIs | `isDeviceTrusted(userId)`, `trustDevice(userId)`, `removeTrust(userId)` |
| **Note** | Pure client-side. No server-side validation — only controls Login UX (skips trust prompt). |

---

## 10. Device Fingerprinting — `src/lib/deviceFingerprint.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Stable device ID for session tracking + UA-derived browser/OS/type. |
| Storage | `localStorage["device_fingerprint_id"]` |
| Fingerprint inputs | `navigator.userAgent`, `navigator.language`, `screen.width × height`, `Intl.timezone`, canvas fingerprint (last 20 chars of toDataURL). |
| Hash | Simple character-bitwise hash → base36 + timestamp. |
| Browser detection | Edge, Opera, Chrome, Safari, Firefox |
| OS detection | Windows 10/11, Windows, macOS, Android, iOS, Linux, Chrome OS |
| Device type | tablet (`iPad|tablet`), mobile (`Mobile|Android.*Mobile|iPhone`), desktop (default) |

---

## 11. User Devices — `src/hooks/profile/useUserDevices.ts`

| Field | VERIFIED |
|---|---|
| Table | `user_devices` (cast `as any`) |
| Query key | `["user-devices", userId]` |
| Fields | `id, device_id, browser, os, device_type, last_active_at, created_at, ip_address, is_current` |
| `useUserDevices(userId)` | Lists devices, marks current via `getDeviceInfo().deviceId`. |
| `useRemoveDevice()` | Mutation: deletes by id, invalidates `["user-devices"]`. |
| `logDeviceSignIn(userId)` | Upsert on `(user_id, device_id)` conflict — fired from AuthProvider on SIGNED_IN. |

---

## 12. Captcha — `src/components/SimpleCaptcha.tsx`

| Field | VERIFIED |
|---|---|
| Purpose | Math-based CAPTCHA fallback (no third-party). |
| Challenge | `(1-20) [+|-] (1-20)`, parsed answer compared against input. |
| States | `idle`, `correct`, `wrong`. Calls `onVerified(boolean)` to parent. |
| Refresh | Manual button regenerates challenge + clears input. |
| **Note** | Per memory: `mem://auth/methods` — Math CAPTCHA fallback. |

---

## 13. Activity Logging — `src/lib/activityLog.ts`

| Field | VERIFIED |
|---|---|
| Categories | `auth`, `navigation`, `content`, `social`, `competition`, `course`, `admin` |
| Table written | `activity_logs` (cast `as any`) |
| Fields | `user_id, action_type, action_category, description, metadata, page_path, user_agent` |
| `logActivity(userId, payload)` | Generic logger. |
| `logAuthEvent(userId, event)` | Convenience for auth events (login, logout, profile_updated, password_recovery). |
| Behavior | Fire-and-forget — silently swallows errors. |

---

## 14. Auth Page Settings — `src/hooks/core/useAuthPageSettings.ts`

| Field | VERIFIED |
|---|---|
| Source | React Query cache only — reads `["site-setting", "auth_page_settings"]`, `["site-setting", "login_background"]`, `["site-setting", "signup_background"]`. |
| Default config (login) | "Welcome / Back / Sign in to continue your journey." + show_google + show_apple, logo size 48. |
| Default config (signup) | "Join the / Community / Create your account...". |
| Per-page settings | heading, heading_accent, subtitle, background_image, show_logo, logo_size, show_google, show_apple. |
| **Note** | No fetcher — relies on `liveAdminSync` to populate cache; otherwise defaults are used. |

---

## 15. Onboarding Modal — `src/components/OnboardingModal.tsx`

| Field | VERIFIED (top 100 LOC) |
|---|---|
| Purpose | Mandatory 7-step (now 6) post-signup profile completion. Per memory `mem://features/onboarding`. |
| Steps (StepKey) | `interests` (required), `name`, `bio`, `contact`, `address`, `social` |
| Step gating | `neededSteps = ALL_STEPS.filter(s => !isStepComplete(s.key, profile))`. If all complete, fall back to first 2 steps. |
| User types | student, normal (Enthusiast), photographer |
| Interests | 15 options (Wildlife, Street, Portrait, Aerial, Documentary, Landscape, Architecture, Macro, Sports, Fashion, Underwater, Astrophotography, Food, Travel, Abstract). |
| Form fields | full_name, date_of_birth, bio, portfolio_url, phone, whatsapp, country, state, city, postal_code, address_line1, facebook_url, instagram_url, website_url, photography_interests, user_type. |
| Admin follow | Captures admin user id and "follow admin" toggle (NOT VERIFIED past line 100). |
| **Note** | Onboarding eligibility/trigger logic in `Layout.tsx` — out of scope for this step. |

---

## 16. RBAC System (cross-reference Step 2C)

See **Step 2C §3 — RBAC System** for the full `adminRoleAccess.ts` mapping (5 sub-roles, `canAccessTab`, `filterTabGroups`, 43-tab access matrix).

| Role | Source |
|---|---|
| `admin` (super_admin) | Top of `user_roles` table; gives "all" tabs access. |
| `moderator` | Comments, reports, support, users, applications. |
| `finance` | Wallet, gifts, transactions, orders, referrals, analytics. |
| `content_editor` | Banners, journal, courses, certificates, SEO, ads, pages. |
| `judge` | Competitions, judging, vote audit, judging tags. |

Per memory `mem://security/data-access`: roles MUST live in separate `user_roles` table — never on `profiles`. The `has_role(_user_id, _role)` SECURITY DEFINER function is the canonical RLS guard (NOT VERIFIED at SQL level in this pass, will be Step 2H).

---

## 17. Maps

### A. Auth State Flow

```
mount
  → AuthProvider effect runs
    → onAuthStateChange listener registered
    → initSession() polled (max 5 retries with backoff)
      → setSession + setUser + setLoading(false)
      → setupRealtimeGuard(userId)
      → checkRestricted(user)
          → query profiles.is_suspended/is_banned
          → if expired suspension: auto-clear in DB
          → if active: store sessionStorage message + setAccountRestricted(true)

SIGNED_IN event:
  → setupRealtimeGuard
  → backfill profiles.full_name from user_metadata (200ms delay)
  → linkReferral (100ms delay)
  → logAuthEvent("login") (0ms)
  → logDeviceSignIn (50ms)

PASSWORD_RECOVERY event:
  → set window.__passwordRecoveryActive = true
  → set sessionStorage.password_recovery_active
  → logAuthEvent("password_recovery")

accountRestricted = true && session:
  → supabase.auth.signOut()
  → user lands on Login → reads suspension_message from sessionStorage
```

### B. Login Flow

```
User → /login
  → AuthProvider already initialized
  → useAuthPageSettings reads site_settings cache
  → render form (step 1: email)

submit step 1:
  → validate email → setEmail + setStep(2)

submit step 2 (email login):
  → check getLockedOutSeconds()
  → validate Zod
  → check captcha if needsCaptcha
  → signOut({ scope: "local" }) (clear stale session)
  → withNetworkRetry(signInWithPassword, 2)
    → success: resetLockout(), setFailedAttempts(0)
    → error (non-network): recordFailedAttempt() → may set lockout
  → AuthProvider catches SIGNED_IN
  → useEffect detects user
    → if isDeviceTrusted: navigate /feed
    → else: showTrustPrompt
        → user picks → trustDevice or skip → navigate /feed

OAuth flow:
  → handleOAuth("google" | "apple")
  → signOut({ scope: "local" })
  → signInWithOAuth(provider) → lovable.auth.signInWithOAuth → redirects
```

### C. Forgot/Reset Password Flow

```
/forgot-password
  → submit email
  → resetPasswordForEmail(email, { redirectTo: /reset-password })
  → success view

email link → /reset-password (with hash or query token)
  → useEffect detects:
    (a) global recovery flag, OR
    (b) PASSWORD_RECOVERY event, OR
    (c) URL has type=recovery / access_token, OR
    (d) custom recovery_token + recovery_email → button to verifyOtp

isRecovery = true:
  → render password form
  → validatePasswordStrength
  → isPasswordReused check
  → updateUser({ password })
  → recordPasswordUsage
  → success view → "Sign Out From All Devices" → signOut({ scope: "global" }) → /login
```

### D. Hook → UI Map

| Hook | Used By |
|---|---|
| `useAuth` | Most pages, `Layout.tsx`, `AdminPanel`, `AdminLayout`, all auth pages |
| `useUserRoles` | `AdminPanel`, sidebar, role-gated buttons |
| `useIsAdmin` | Admin-only UI sections, badge resolution |
| `useIsBanned` | NOT VERIFIED at consumer level in this pass |
| `useTrustedDevice` | `Login.tsx` |
| `useAuthPageSettings` | `Login.tsx`, `Signup.tsx` |
| `useUserDevices` / `useRemoveDevice` | Profile/devices section (NOT VERIFIED here) |
| `useCaptureReferral` | `Signup.tsx` |

### E. Storage Map (Auth-Related)

| Storage Key | Purpose |
|---|---|
| `localStorage["50mmretina_device_id"]` | Trusted-device per-browser UUID |
| `localStorage["50mmretina_trusted_devices"]` | `{ userId: deviceId[] }` |
| `localStorage["device_fingerprint_id"]` | Hashed device fingerprint |
| `localStorage["pw_history_${userId}"]` | SHA-256 hashed password history (size 1) |
| `localStorage["login_lockout"]` | `{ failedAttempts, lockedUntil, lastAttempt }` |
| `localStorage[supabase auth keys]` | Session, refresh token (managed by Supabase SDK) |
| `sessionStorage["suspension_message"]` | Forced sign-out reason (read by `Login.tsx`) |
| `sessionStorage["password_recovery_active"]` | Recovery state flag |
| `window.__passwordRecoveryActive` | In-memory recovery flag (mirror of sessionStorage) |

### F. Table Dependency Map

| Table | Read | Write |
|---|---|---|
| `auth.users` | (managed by Supabase) | `signUp`, `signInWithPassword`, `updateUser`, `verifyOtp` |
| `profiles` | `useAuth.checkRestricted`, `useIsBanned`, profile guard realtime | `useAuth` (full_name backfill on SIGNED_IN), suspension auto-lift |
| `user_roles` | `useUserRoles`, `useIsAdmin`, `getAdminIds` | NOT VERIFIED at auth-page level |
| `user_devices` | `useUserDevices` | `logDeviceSignIn` upsert, `useRemoveDevice` delete |
| `referral_codes` | `useAuth.linkReferral` | — |
| `referrals` | — | `useAuth.linkReferral` insert |
| `newsletter_subscribers` | — | `Signup.tsx` upsert (source: registration) |
| `activity_logs` | — | `logActivity` / `logAuthEvent` |
| `site_settings` | `useAuthPageSettings` (via cache only) | (admin SettingsModule) |

### G. Realtime Channels (Auth-Related)

| Channel | Owner | Trigger | Effect |
|---|---|---|---|
| `profile-guard-${userId}` | `AuthProvider` | UPDATE on `profiles` filtered by id | If suspension/ban transitions OFF → ON: stores message + forces signOut |

---

## 18. Security Observations (VERIFIED)

| Source | Observation |
|---|---|
| `useAuth.tsx` | Session restoration retries 5× with backoff; failure-tolerant boot. |
| `useAuth.tsx` | Realtime profile guard correctly compares `wasRestricted` vs `isNowRestricted` to avoid loop. |
| `useAuth.tsx` | Auto-lift expired suspensions in DB — moves complexity to client (could be server-side trigger). |
| `useAuth.tsx` | Referral linking uses `.maybeSingle()` and try/catch — silent on failure. |
| `Login.tsx` | OAuth and email login both pre-call `signOut({ scope: 'local' })` to avoid stale local sessions. |
| `Login.tsx` | Failed attempts persisted in localStorage — clearable by user (security trade-off). |
| `Signup.tsx` | Captcha is mandatory (not gated by attempts). |
| `Signup.tsx` | Auto-redirect to `/dashboard` if user already authenticated — no onboarding check at this level. |
| `ResetPassword.tsx` | Three independent recovery detection paths — robust to varying email link formats. |
| `ResetPassword.tsx` | Custom `recovery_token` path uses `verifyOtp` only on explicit button click — protects against email-scanner auto-clicks. |
| `passwordSecurity.ts` | `MAX_HISTORY = 1` — only blocks immediate reuse (matches memory `mem://auth/account-integrity` "single password history"). |
| `passwordSecurity.ts` | Password hash is client-side ONLY — not security, just comparison. |
| `passwordSecurity.ts` | Lockout state is localStorage — clearing browser data circumvents lockout. |
| `useTrustedDevice.ts` | "Trusted device" is purely UX — doesn't bypass server auth. |
| `oauthHelper.ts` | Uses `@/integrations/lovable/index` instead of `supabase.auth.signInWithOAuth` directly — Lovable SDK abstraction. |
| `useUserDevices.ts` | All `user_devices` operations cast `as any` — table not in TypeScript types. |
| `activityLog.ts` | All inserts cast `as any` — table not strongly typed. |
| `useAuthPageSettings.ts` | No fetcher — assumes `liveAdminSync` populates cache; first-load may show defaults. |

---

## 19. Items NOT VERIFIED in this Step

- Onboarding modal full step bodies, `isStepComplete()` logic, profile save mutations (only first 100 LOC inspected).
- Layout.tsx onboarding trigger logic (where `OnboardingModal` is mounted).
- `ProtectedRoute` / `RequireAuth` patterns — **not present in codebase** (route protection is in-component via `useAuth` checks + `AdminPanel` redirect).
- `AutoRole.tsx` full batch fetch logic past line 50.
- `useIsBanned` consumers.
- Server-side RLS policies (Step 2H).
- `has_role(_user_id, _role)` SQL function definition (Step 2H).
- Custom email template token format (`recovery_token` / `recovery_email`).
- `lovable.auth.signInWithOAuth` SDK internals.
- `useReferral` / `useCaptureReferral` hook bodies.
- `dashboardInitGate.ts` and `dashboardInit.ts` seeding internals (deferred to Step 2I).
- `ActiveDevices.tsx` UI.
- `EditProfile.tsx` security/email change flows.

