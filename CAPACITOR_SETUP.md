# 50mm Retina World — Native App Setup (Capacitor)

This turns the existing React web app into installable **iOS + Android** apps with
**push notifications (FCM)**, **native camera**, and **native share** — reusing the
whole web codebase. Nothing here changes the web/PWA build; the native code only
runs inside the installed app.

What's already been done for you (in this repo / backend):
- `capacitor.config.ts` (root) — appId `com.fiftymmretina.app`, appName, `webDir: dist`.
- `src/lib/native/` — ready-to-use helpers: `push.ts`, `camera.ts`, `share.ts`, `platform.ts`.
- Backend: `push_tokens` table + `register_push_token` / `unregister_push_token` RPCs (live).
- Edge function `send-push` (FCM HTTP v1) — deployed, waiting only on the FCM secret.

Everything below runs on **your machine** (Capacitor native builds can't run in the cloud sandbox).
iOS requires a **Mac with Xcode**; Android requires **Android Studio**.

---

## 1. Install the Capacitor dependencies

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android \
            @capacitor/camera @capacitor/share @capacitor/splash-screen \
            @capacitor-firebase/messaging
```

(These are intentionally NOT in the committed `package.json` so the web build/lockfiles
stay untouched — installing them here updates your lockfile locally.)

## 2. Build the web app and add the native platforms

```bash
npm run build          # produces dist/ which Capacitor wraps
npx cap add ios
npx cap add android
npx cap sync
```

This creates `ios/` and `android/` native projects. Commit them if you want them in git.

## 3. Firebase (push notifications)

You're already logged into Firebase. In the **same** Firebase project:

1. **Project settings → General → Your apps**: register an **Android app** with package
   name `com.fiftymmretina.app` and an **iOS app** with bundle ID `com.fiftymmretina.app`
   (must match `capacitor.config.ts`).
2. Download the config files and place them exactly:
   - Android → `android/app/google-services.json`
   - iOS → `ios/App/App/GoogleService-Info.plist`
3. **iOS only** — Apple Push needs an APNs key:
   - Apple Developer → Certificates, Identifiers & Profiles → **Keys** → create an **APNs Auth Key** (.p8).
   - Firebase → Project settings → **Cloud Messaging → Apple app configuration** → upload that .p8 (with Key ID + Team ID).
   - In Xcode (`ios/App/App.xcworkspace`) → target **App** → **Signing & Capabilities** → add **Push Notifications** and **Background Modes → Remote notifications**.
4. Run `npx cap sync` again after adding the config files.

## 4. Backend secret (so the server can send)

In Supabase → Project → Edge Functions → **Secrets**, add:

- `FCM_SERVICE_ACCOUNT` = the full JSON from Firebase → Project settings → **Service accounts → Generate new private key**. Paste the whole file contents as the value.
- *(optional)* `PUSH_INTERNAL_SECRET` = any random string, if you want other functions/triggers to call `send-push` server-to-server without an admin login.

The `send-push` function is already deployed and will start working the moment `FCM_SERVICE_ACCOUNT` is set.

## 5. Wire the helpers into the app

Push registration — call once after the user is signed in (e.g. in your auth provider
or `App.tsx` after session is ready):

```ts
import { initPushNotifications } from '@/lib/native/push';
import { useNavigate } from 'react-router-dom';
// after login / on app mount when authenticated:
initPushNotifications((data) => {
  // optional: deep-link when a notification is tapped
  if (data?.url) navigate(String(data.url));
});
```

On logout, call `unregisterPushNotifications()` before `supabase.auth.signOut()`.

Camera — swap or add to your photo upload buttons:

```ts
import { pickPhoto, hasNativeCamera } from '@/lib/native/camera';
const file = await pickPhoto('prompt');   // returns a File
if (file) { /* hand to your existing uploadImage()/compressImage() */ }
```

Share — for posts, profiles, competitions:

```ts
import { shareContent } from '@/lib/native/share';
await shareContent({ title: post.title, text: 'Check this out', url: `https://50mmretina.com/post/${post.id}` });
```

The helpers no-op / fall back gracefully on web, so the same code is safe everywhere.

## 6. Run on a device / simulator

```bash
npm run build && npx cap sync
npx cap open ios       # opens Xcode → run on simulator or device
npx cap open android   # opens Android Studio → run
```

Every time you change web code: `npm run build && npx cap sync` (then Run again).

## 7. Send a test push

As an admin (with your admin JWT) POST to the function:

```
POST https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push
Authorization: Bearer <your-admin-access-token>
Content-Type: application/json

{ "user_id": "<a user who registered a device>", "title": "Hello", "body": "First push 🎉", "data": { "url": "/feed" } }
```

Or server-to-server with header `x-internal-secret: <PUSH_INTERNAL_SECRET>` instead of the Authorization header.
Response `{ success: true, sent: N }`. Invalid/expired tokens are pruned automatically.

---

## Store submission checklist

### Apple App Store
- [ ] **Apple Developer Program** membership ($99/year).
- [ ] Bundle ID `com.fiftymmretina.app` registered (Identifiers) with **Push Notifications** capability enabled.
- [ ] APNs Auth Key (.p8) uploaded to Firebase (step 3).
- [ ] App icon (1024×1024, no alpha) + launch screen.
- [ ] Screenshots for required device sizes (6.7", 6.5", 5.5", iPad if supported).
- [ ] **Privacy Policy URL** (you have `https://50mmretina.com/page/privacy-policy`).
- [ ] **App Privacy** "nutrition label" filled (what data you collect: email, photos, usage).
- [ ] Sign-in demo account for reviewers + review notes (mention Google login).
- [ ] Archive in Xcode → upload to **App Store Connect** → **TestFlight** → submit for review.

### Google Play
- [ ] **Play Console** account (one-time $25).
- [ ] App signing (let Google manage the signing key is fine).
- [ ] App icon (512×512), **feature graphic** (1024×500), phone + tablet screenshots.
- [ ] **Privacy Policy URL**.
- [ ] **Data safety** form (data collected/shared, encryption in transit).
- [ ] **Content rating** questionnaire.
- [ ] Target the current required **target API level** (Android Studio will warn if too low).
- [ ] Build a signed **.aab** (Android App Bundle) → upload to **Internal testing** first → then Production.

### Both
- [ ] Test push, camera, share, login (Google + email) on a **real device**, not just simulator.
- [ ] Confirm deep links / notification taps land on the right screen.
- [ ] Increment version/build number on each store upload.

---

## Notes
- Changing `appId` later means re-registering Firebase apps and store listings — pick it before first publish.
- The web app and PWA are unaffected by any of this; native code is gated behind `Capacitor.isNativePlatform()`.
- `push_tokens`, `register_push_token`, `unregister_push_token`, and `send-push` are already live in your Supabase project.
