# 50mm Retina World — App Store Submission Pack

Everything needed to fill the App Store Connect + Google Play Console listings, plus
the exact build → upload steps. Icon/splash source art is in `resources/` (see §5).

Bundle ID (both platforms): **com.fiftymmretina.app**
Privacy Policy URL: **https://50mmretina.com/page/privacy-policy**
Support URL: **https://50mmretina.com/help-support**
Category: **Photography** (secondary: Education)

---

## 1. Names & short text
- **App name:** 50mm Retina World
- **Subtitle (iOS, ≤30 chars):** Compete · Learn · Create
- **Short description (Play, ≤80 chars):** Photo competitions, courses, and a creative community for photographers.
- **Promotional text (iOS, ≤170 chars):** Enter photography competitions, get judged by pros, take courses, earn certificates, and share your work with a community built for photographers.

## 2. Full description (paste into both stores)
50mm Retina World is a home for photographers to compete, learn, and grow.

• Competitions — Enter your best shots, get scored by real judges across multiple rounds, and win placements, certificates, and wallet rewards.
• Learn — Follow structured photography courses and lessons, and read the Journal for craft, technique, and inspiration.
• Community — Share posts and stories, follow other photographers, react and comment, and build your portfolio profile.
• Recognition — Earn verified badges and downloadable certificates for your achievements.
• Rewards — Track your wallet, referrals, and gift credits.

Whether you're just starting out or refining a professional eye, 50mm Retina World gives you the stage, the feedback, and the community to get better.

## 3. Keywords
- **iOS keywords (≤100 chars):** photography,photo contest,competition,camera,portfolio,courses,community,judging,gallery
- **Play tags:** Photography, Education, Social

## 4. Data safety / App Privacy answers
Data the app collects (all **used for app functionality**, **linked to the user**, **encrypted in transit**, **not sold**):
- Contact info: email address, name
- User content: photos, posts, comments, stories, profile info
- Identifiers: user ID, device push token (for notifications)
- Usage & diagnostics: app interactions, basic analytics
- Optional/profile: city, workplace, education, social links (user-provided, user-controlled visibility)

Account deletion: supported in-app (Admin/user delete removes all personal data and frees the email) — declare a working account-deletion path (Google & Apple both require this).
Sensitive financial data (bank details, wallet) is stored server-side, owner-access-only (verified RLS), and used only for payouts.

## 5. Icons & splash (auto-generated)
Source art is in `resources/`: `icon.png` (1024²), `splash.png` / `splash-dark.png` (2732²), and `android/icon-foreground.png` + `icon-background.png` (adaptive).

Generate every platform size:
```bash
npm i -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#0f172a' --splashBackgroundColor '#0f172a'
npx cap sync
```
This writes all iOS/Android icon and splash sizes into the native projects.

Also needed (manual, per store):
- **Play feature graphic:** 1024×500 (create from `og-image.png` + logo — not auto-generated).
- **Screenshots:** capture from a running device/simulator (see §7). iOS needs 6.7" + 6.5"; Play needs ≥2 phone shots.

## 6. Content rating
User-generated content + social features → answer the questionnaires honestly:
- Apple: likely **12+** (user-generated content, social networking).
- Google: complete the content-rating questionnaire; UGC + social usually lands **Teen**. Declare the in-app report/moderation tools (you have comment/post reports + keyword blocklist).

## 7. Build → upload (the actual "today" steps, run on a Mac / Android Studio)
```bash
# one-time
npm install
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android \
            @capacitor/camera @capacitor/share @capacitor/splash-screen @capacitor-firebase/messaging @capacitor/assets
npx cap add ios && npx cap add android

# icons/splash + Firebase files (see CAPACITOR_SETUP.md §3 for google-services.json / GoogleService-Info.plist)
npx capacitor-assets generate --iconBackgroundColor '#0f172a' --splashBackgroundColor '#0f172a'

# build web + sync native
npm run build && npx cap sync

# iOS  → opens Xcode: set Team, bump version/build, Product ▸ Archive ▸ Distribute ▸ App Store Connect
npx cap open ios
# Android → opens Android Studio: Build ▸ Generate Signed Bundle (.aab) ▸ upload to Play Console (Internal testing first)
npx cap open android
```
Set `FCM_SERVICE_ACCOUNT` in Supabase (push) before testing notifications — see CAPACITOR_SETUP.md §4.

## 8. Pre-submit smoke test (real device)
- [ ] Google + email login work
- [ ] Camera capture → upload a photo works
- [ ] Share sheet opens
- [ ] Push notification received (after FCM secret set)
- [ ] Account deletion path works
- [ ] No crash on cold start; splash → feed
