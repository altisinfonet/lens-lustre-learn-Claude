# S2 — native crash / OOM / ANR per app build (2026-10-29)

**Gap found (inventory):** Admin → Health "Crash rate per build" counted only
JavaScript errors per app start and said so ("Native crashes are not in this
number"). A native crash or an out-of-memory kill of the Android app never
reaches JavaScript.

**Fix (free tool = Android's own OS record, no SDK, no account):**
- `resources/android/java/com/fiftymmretina/app/ExitInfoPlugin.java` — reads
  `ApplicationExitInfo` (Android 11+): crash, native crash, low memory, ANR.
- `scripts/android-native-plugins.mjs` — copies it into the generated
  project, registers it in MainActivity before `super.onCreate`; refuses an
  unknown MainActivity.
- `src/lib/native/exitReasons.ts` + `src/lib/telemetry.ts` — on each app start,
  new bad exits become `app.exit.*` telemetry rows credited to the build that
  was running; background low-memory kills (normal Android) are ignored.
- `20261031_0100_s2_native_exits.sql` — admin_health_daily: starts = only
  `app.start`; new crashes / oom / anr; crashes_per_100_starts.
- `AdminAppHealth.tsx` — Crashes, OOM, ANR, Crashes per 100 starts columns.
- `android-build.yml` (second commit) — runs the script after `cap add
  android`; blocking check that the plugin class is in the release AAB dex.
  Carried to main only with the S9 version bump (a push to that file on main
  starts an app build).

## Fail first

### Unit tests on the code before the fix
```
   × S2 App health — crash rate per build includes native crashes and OOM (20261031_0100) > sums crashes, OOM and ANR per build over the window; crash rate = (crashes + OOM) per 100 starts 10ms
   × S2 App health — crash rate per build includes native crashes and OOM (20261031_0100) > a lane without 20261031_0100 (no native columns) is reported as such, not as zero crashes 1ms
   × S2 telemetry — an Android app start reports earlier native exits > queues app.start for this build and app.exit.* for the build that crashed, and sends at once 1181ms
   ✓ S2 telemetry — an Android app start reports earlier native exits > web: no exit reader is asked, only app.start is queued 6ms
 FAIL  src/lib/native/__tests__/exitReasons.test.ts [ src/lib/native/__tests__/exitReasons.test.ts ]
Error: Failed to resolve import "../../../../scripts/android-native-plugins.mjs" from "src/lib/native/__tests__/exitReasons.test.ts". Does the file exist?
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/lib/__tests__/telemetryNativeExits.test.ts > S2 telemetry — an Android app start reports earlier native exits > queues app.start for this build and app.exit.* for the build that crashed, and sends at once
AssertionError: expected "spy" to be called at least once
 FAIL  src/components/admin/__tests__/AdminAppHealthBuilds.test.ts > S2 App health — crash rate per build includes native crashes and OOM (20261031_0100) > sums crashes, OOM and ANR per build over the window; crash rate = (crashes + OOM) per 100 starts
AssertionError: expected undefined to be true // Object.is equality
 FAIL  src/components/admin/__tests__/AdminAppHealthBuilds.test.ts > S2 App health — crash rate per build includes native crashes and OOM (20261031_0100) > a lane without 20261031_0100 (no native columns) is reported as such, not as zero crashes
AssertionError: expected undefined to be false // Object.is equality
 Test Files  3 failed (3)
      Tests  3 failed | 1 passed (4)
```
Wiring test before the workflow change: 2 failed | 10 passed; after: 12 passed.

### SQL (local Postgres 16, fixture shaped like each lane: production role = app_role enum, staging role = text)
PROBE before 0100:
```
ERROR:  PROBE FAIL 20261031_0100:
  G1 admin_health_daily does not count native exits (0100 not applied)
  G2c starts = 6 (want 2: an exit is not a start)
  G2c crashes = null (want 2)
  G2c oom = null (want 1)
  G2c anr = null (want 1)
  G2c crashes_per_100_starts = null (want 150.00)
  G2c errors_per_100_starts = 16.67 (want 50.00)
```
Sequence on both fixtures: PROBE FAIL → apply PASS → re-apply refused
(PRE-002) → PROBE PASS → old S2 PROBE still PASS → rollback PASS → PROBE FAIL →
re-apply PASS.

### Java
`javac --release 11` against the real Android 11 API (robolectric android-all
11) with Capacitor 8.5.0 signatures: ExitInfoPlugin.class + patched
MainActivity.class compile. The real compile happens in android-build.yml.

## Not verified here
- A real crash on a real phone (needs the S9 app build; Owner phone test).
- WebView renderer-only crashes that Capacitor recovers without the app
  process dying are not in ApplicationExitInfo.
