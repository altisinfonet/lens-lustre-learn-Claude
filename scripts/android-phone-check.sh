#!/usr/bin/env bash
# Phone check (android-build.yml job "phone-check"): the NEW app on a virtual
# Android phone before the Owner uploads it to Play. Usage: android-phone-check.sh <apk>
# Fails (exit 1) when:
#   - Android does not VERIFY www.50mmretina.com for the app (links would open the browser),
#   - a https://www.50mmretina.com link does not open inside the app,
#   - the app's Login / Join screen shows "Get the App" (that button is web-only).
set -uo pipefail
APK="$1"
PKG="com.fiftymmretina.app"
HOST="www.50mmretina.com"
mkdir -p shots
fail=0
shot() { adb exec-out screencap -p > "shots/$1.png"; }
focus() { adb shell dumpsys window | grep -m1 -E "mCurrentFocus|mFocusedApp" || true; }

adb install -r "$APK" || { echo "::error::install failed"; exit 1; }

# 1. App opens.
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 25
shot 01-app-start

# 2. Android verifies the domain (reads live https://www.50mmretina.com/.well-known/assetlinks.json).
adb shell pm verify-app-links --re-verify "$PKG"
state=""
for _ in $(seq 1 24); do
  state=$(adb shell pm get-app-links "$PKG" | tr -d '\r')
  echo "$state" | grep -q "$HOST: verified" && break
  sleep 5
done
echo "$state" | tee shots/app-links.txt
if echo "$state" | grep -q "$HOST: verified"; then
  echo "PASS: $HOST verified for $PKG"
else
  echo "::error::$HOST is NOT verified for the app — mail / WhatsApp links would open the browser."
  fail=1
fi

# 3. A link opens INSIDE the app, and the app has no "Get the App" button.
for path in login signup; do
  adb shell am force-stop "$PKG"
  adb logcat -c || true
  adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://$HOST/$path" | tee "shots/open-$path.txt"
  sleep 20
  f=$(focus); echo "$f" | tee -a "shots/open-$path.txt"
  shot "02-link-$path"
  if echo "$f" | grep -q "$PKG"; then
    echo "PASS: https://$HOST/$path opened in the app"
  else
    # 1.2.48 run 43401528844, attempt 1: the app started on /signup and was gone 20 s later
    # (passed on the re-run). WHY the app left is kept, never guessed: the phone's crash
    # buffer + the app's own lines + the system's reason for ending the process.
    adb logcat -d -b crash > "shots/logcat-crash-$path.txt" 2>&1 || true
    adb logcat -d -b main,system | grep -iE "fiftymm|AndroidRuntime|ActivityManager|ActivityTaskManager|lowmemory|chromium|Capacitor" | tail -400 > "shots/logcat-$path.txt" 2>&1 || true
    adb shell dumpsys activity exit-info "$PKG" | head -80 > "shots/exit-info-$path.txt" 2>&1 || true
    echo "::error::https://$HOST/$path did NOT open in the app ($f) — logcat + exit reason saved in the phone-check artifact"
    fail=1
  fi
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 && adb pull /sdcard/ui.xml "shots/ui-$path.xml" > /dev/null 2>&1
  if grep -qi "Get the App" "shots/ui-$path.xml" 2>/dev/null; then
    echo "::error::the app's /$path screen shows \"Get the App\" — that button is for the website only."
    fail=1
  else
    echo "PASS: no \"Get the App\" in the app's /$path screen"
  fi
done

exit $fail
