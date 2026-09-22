# BUILD 1102 / v1.2.11 — CUT FOR THE FIRST PUBLIC RELEASE

Date: 2026-08-16
Run: Android Build **#102** — https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31963136512
Commit: `d4318e7`
Status: **SUCCESS**, 7m 35s.

Artifacts: `app-debug-apk-SIDELOAD-THIS` (13.9 MB) · `app-release-aab` (8.47 MB)

Gates: typecheck 0 · **1,868 tests** · production build 0 ·
**124 screenshots, 0 layout problems, 0 non-fixture errors**

**versionCode landed exactly on 1102 as the owner asked.** It is `1000 + run
number`, so it required exactly one more run to fire. Only two paths trigger the
workflow — the workflow file and `ANDROID_BUILD_TRIGGER` — so all seven code
files were pushed first, touching neither, and a single edit to the workflow was
the one and only trigger. `ANDROID_BUILD_TRIGGER` was deliberately left alone;
the release notes live in the workflow header instead.

## 1. The privacy chooser is withheld

Checked against production, not read from a plan document:

```
select privacy, count(*) from posts   ->   public: 218, and nothing else
```

The database, the feed and eight of nine surfaces honour a post's privacy. **The
direct image URL does not** — authorized media delivery (B5) is unfinished and
that cell is RED. Harmless today only because nothing private exists; a public
release is precisely the event that would end that.

**Writing the test found a SECOND chooser** — on composer screen 2, the only one
an Android member ever reaches. Without it this build would have withheld the
control on the website while shipping it live to every phone.

`newPrivacy` stays wired end to end, defaulting to public. Restoring both is one
line plus deleting `PrivacyChooserWithheld.test.ts`, which names the condition
(Media-URL cell green) so it cannot be reverted by accident.

## 2. One uploader, from any page

Owner: *"as top menu icon is fix it should be from single uploader while
standing on any page."*

The composer now lives in the shell (`GlobalComposer`, mounted in `Layout`,
native app only). The Create button raises `?compose=1` on the **current** url;
nothing navigates. Measured at 412px in app mode:

| Start page | picker | page | composers mounted |
|---|---|---|---|
| The wall | fired | **unchanged** | 1 |
| The feed | fired | **unchanged** | 1 |

The page staying put is the structural difference — before, it moved to the
feed, and that navigation racing Android's picker was the bug.

The previous attempt (1.2.9) was measured to change nothing and is recorded as
such in the source. `useUserPostsQuery` now takes `enabled`, so a composer-only
mount fetches no wall.

## 3. Everything from 1.2.10 stands

The crop dialog's `pointer-events-auto`, verified on the live site.

## Still open, NOT claimed

- **Journal / Featured-artist PDF.** Cause unknown. It now reports its real
  reason instead of "failed"; that reason is needed from a device. Certificates,
  Wallet and Admin transactions ARE fixed.
- Pinch on a real device — unreproducible in Chromium, hardened only.
- 10 of 11 Android lifecycle rows, and the random sign-out, remain open from the
  main plan.

## Release advice given to the owner

Production is **1073 / v1.2.2**; this is **1102 / v1.2.11** — 29 builds of
change at once. Recommended a **staged rollout starting at 20%** rather than
100%, so a surprise reaches a fifth of members rather than all of them.
