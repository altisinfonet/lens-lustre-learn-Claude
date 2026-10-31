/**
 * CSP must let Supabase Realtime connect.
 *
 * Found 2026-10-11 during the VID-1 cross-browser run: on staging AND on
 * www.50mmretina.com, Chrome and Edge report
 *   connect-src → wss://<project>.supabase.co/realtime/v1/websocket
 * as a CSP violation. connect-src listed https://*.supabase.co but not wss://,
 * so every Realtime channel (presence "online" dots, live notifications,
 * comments, counters, the P3 subscriptions) could not open its socket in a
 * browser. Proof (real Chrome, old vs new policy): docs/evidence/d2/CSP/realtime-wss/.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const csp = readFileSync("public/_headers", "utf8").split("\n").find((l) => l.includes("Content-Security-Policy:")) || "";
const connect = (csp.split(";").find((d) => d.trim().startsWith("connect-src ")) || "").trim();

describe("CSP connect-src allows the Supabase Realtime socket", () => {
  it("wss:// for both Supabase hosts the client may use", () => {
    expect(connect).toMatch(/(^|\s)wss:\/\/\*\.supabase\.co(\s|$)/);
    expect(connect).toMatch(/(^|\s)wss:\/\/\*\.supabase\.in(\s|$)/);
  });

  it("no blanket socket or scheme sources were added", () => {
    expect(connect).not.toMatch(/(^|\s)(wss:|ws:|ws:\/\/\S*|\*|https:)(\s|$)/);
  });
});
