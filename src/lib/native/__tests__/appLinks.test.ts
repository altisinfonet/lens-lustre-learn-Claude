/**
 * App first (Owner 2026-11-12) — ratchet for the ONE app-link layer:
 * assetlinks.json ↔ Android manifest filter ↔ in-app route rule ↔ web button.
 * If any of the four drifts, links silently fall back to the browser again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_PACKAGE,
  PLAY_STORE_URL,
  androidAppIntentUrl,
  appLinkTarget,
  shouldOfferAppOnThisDevice,
} from "@/lib/native/appLinks";

const root = resolve(__dirname, "../../../..");
const PLAY_SIGNING = "7B:04:2F:D6:0B:65:D8:DC:BF:E8:02:D8:76:11:CB:9C:C3:95:FF:87:0F:C4:5E:D0:CF:13:66:95:37:65:19:74";
const UPLOAD = "35:2F:82:CF:6F:E1:77:5E:3D:9C:EF:8A:2E:63:45:9F:EB:0A:F0:47:01:1D:C6:29:A3:A0:73:C1:A8:1D:99:12";

describe("assetlinks.json (what Android checks)", () => {
  const json = JSON.parse(readFileSync(resolve(root, "public/.well-known/assetlinks.json"), "utf8"));
  it("claims the app with the Play app-signing key AND the upload key", () => {
    expect(json).toHaveLength(1);
    expect(json[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(json[0].target.namespace).toBe("android_app");
    expect(json[0].target.package_name).toBe(APP_PACKAGE);
    expect(json[0].target.sha256_cert_fingerprints).toEqual([PLAY_SIGNING, UPLOAD]);
  });
});

describe("Android manifest filter (android-build.yml)", () => {
  const yml = readFileSync(resolve(root, ".github/workflows/android-build.yml"), "utf8");
  it("adds ONE verified https filter for www only", () => {
    expect(yml).toContain('<intent-filter android:autoVerify="true">');
    expect(yml).toContain('<data android:scheme="https" />');
    expect(yml).toContain('<data android:host="www.50mmretina.com" />');
    // apex redirects; claiming it would make verification fail
    expect(yml).not.toContain('android:host="50mmretina.com"');
  });
  it("keeps the OAuth custom-scheme filter", () => {
    expect(yml).toContain('<data android:scheme="app.fiftymmretina" />');
  });
});

describe("appLinkTarget — link → in-app screen", () => {
  it("opens a post link on the same screen", () => {
    expect(appLinkTarget("https://www.50mmretina.com/post/abc?c=1")?.route).toBe("/post/abc?c=1");
  });
  it("home goes to the feed", () => {
    expect(appLinkTarget("https://www.50mmretina.com/")?.route).toBe("/feed");
  });
  it("accepts apex links handed over by other apps", () => {
    expect(appLinkTarget("https://50mmretina.com/journal")?.route).toBe("/journal");
  });
  it("ignores other hosts, http, the OAuth scheme and robot files", () => {
    expect(appLinkTarget("https://staging.50mmretina.com/feed")).toBeNull();
    expect(appLinkTarget("https://evil.example/www.50mmretina.com")).toBeNull();
    expect(appLinkTarget("http://www.50mmretina.com/feed")).toBeNull();
    expect(appLinkTarget("app.fiftymmretina://auth-callback#access_token=x")).toBeNull();
    expect(appLinkTarget("https://www.50mmretina.com/sitemap.xml")).toBeNull();
    expect(appLinkTarget("https://www.50mmretina.com/.well-known/assetlinks.json")).toBeNull();
    expect(appLinkTarget("not a url")).toBeNull();
  });
  it("e-mail confirm link: tokens taken out of the route, session set by the gate", () => {
    const t = appLinkTarget("https://www.50mmretina.com/#access_token=A&refresh_token=R&type=signup");
    expect(t?.tokens).toEqual({ access_token: "A", refresh_token: "R" });
    expect(t?.route).toBe("/feed");
    expect(t?.route).not.toContain("access_token");
  });
  it("reset link keeps only the recovery marker", () => {
    const t = appLinkTarget("https://www.50mmretina.com/reset-password#access_token=A&refresh_token=R&type=recovery");
    expect(t?.route).toBe("/reset-password#type=recovery");
  });
  it("scanner-safe reset link (query) passes through unchanged", () => {
    const t = appLinkTarget("https://www.50mmretina.com/reset-password?recovery_token=T&recovery_email=a%40b.c");
    expect(t?.route).toBe("/reset-password?recovery_token=T&recovery_email=a%40b.c");
    expect(t?.tokens).toBeNull();
  });
  it("expired link goes to login", () => {
    const t = appLinkTarget("https://www.50mmretina.com/#error=access_denied&error_description=expired");
    expect(t?.route).toBe("/login");
    expect(t?.authError).toBe(true);
  });
});

describe("Login via App (web)", () => {
  it("intent link opens the app on the screen, Play Store when not installed", () => {
    const u = androidAppIntentUrl("/login");
    expect(u.startsWith("intent://www.50mmretina.com/login#Intent;scheme=https;")).toBe(true);
    expect(u).toContain(`package=${APP_PACKAGE};`);
    expect(u).toContain(`S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`);
  });
  it("offered only in an Android browser, never in the app, iPhone or desktop", () => {
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
    expect(shouldOfferAppOnThisDevice(android, false)).toBe(true);
    expect(shouldOfferAppOnThisDevice(android, true)).toBe(false);
    expect(shouldOfferAppOnThisDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", false)).toBe(false);
    expect(shouldOfferAppOnThisDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", false)).toBe(false);
  });
});
