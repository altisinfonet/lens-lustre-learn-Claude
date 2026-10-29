/**
 * S7b-1 · the photo-saving service worker runs inside the Android app.
 *
 * src/main.tsx unregistered every worker when `hostname === "localhost"`, to
 * keep it out of a developer's machine. The installed Android app's origin is
 * https://localhost (Capacitor), so the app NEVER saved a photo for offline or
 * a weak network. Capacitor 8.5 serves worker scripts through the bridge on
 * Android (`android.resolveServiceWorkerRequests`, default true).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { imageWorkerDecision, imageWorkerUrl } from "@/lib/offline/imageWorkerRegistration";

const base = { hostname: "www.50mmretina.com", inIframe: false, prod: true, nativeAndroid: false, nativeIOS: false };

describe("where the photo-saving worker runs", () => {
  it("the live and staging sites (production build)", () => {
    expect(imageWorkerDecision(base)).toBe("register");
    expect(imageWorkerDecision({ ...base, hostname: "staging.50mmretina.com" })).toBe("register");
  });

  it("the installed Android app, whose origin is https://localhost", () => {
    expect(imageWorkerDecision({ ...base, hostname: "localhost", nativeAndroid: true })).toBe("register");
  });

  it("NOT a developer's localhost, an iframe, or a preview host", () => {
    expect(imageWorkerDecision({ ...base, hostname: "localhost" })).toBe("unregister");
    expect(imageWorkerDecision({ ...base, inIframe: true })).toBe("unregister");
    expect(imageWorkerDecision({ ...base, hostname: "id-preview--x.lovable.app" })).toBe("unregister");
  });

  it("NOT the iOS app (WKWebView does not run workers on the app scheme)", () => {
    expect(imageWorkerDecision({ ...base, hostname: "localhost", nativeIOS: true })).toBe("unregister");
  });

  it("nothing in a development build", () => {
    expect(imageWorkerDecision({ ...base, prod: false })).toBe("skip");
  });

  it("the worker URL carries this lane's CDN host, nothing else", () => {
    expect(imageWorkerUrl("cdn-staging.50mmretina.com")).toBe("/sw-image-cache.js?cdn=cdn-staging.50mmretina.com");
    expect(imageWorkerUrl("")).toBe("/sw-image-cache.js");
    expect(imageWorkerUrl(undefined)).toBe("/sw-image-cache.js");
  });

  it("main.tsx uses this one rule", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).toContain("imageWorkerDecision(");
    expect(main).toContain("register(imageWorkerUrl(CDN_HOST))");
    expect(main).not.toMatch(/window\.location\.hostname === "localhost"/);
  });
});
