/**
 * ALARMS FOR THE SESSION-LOSS RECORDER.
 *
 * Owner, 2026-08-15: *"dont know sometimes logged off home screen opening
 * automatically"* · *"during commenting logging off"* · *"point 2 and 3
 * happening not all the time but randomly"*.
 *
 * Two hypotheses were tested against production and both were wrong, and the
 * investigation then stopped because **nothing records why a session ends**.
 * This recorder is the missing evidence, so these tests hold it to the one
 * standard that matters: when a session ends, can the log tell a deliberate
 * sign-out from a mystery, and does it name the suspect?
 *
 * A recorder is a strange thing to test, because when it is wrong it does not
 * crash — it quietly writes "involuntary" for a member who pressed Log out, or
 * "member_action" for a bug. Either would send the investigation the wrong way
 * for a week. So every test below is about the DISTINCTION, not the plumbing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimSessionLoss,
  collectFacts,
  declareSignOut,
  installVisibilityObserver,
  isTokenRefreshUrl,
  noteRequest,
  resetForNewSession,
  storedSessionPresent,
  TESTING_ONLY_reset,
} from "@/lib/sessionLossRecorder";

const REFRESH = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token";
const REST = "https://x.supabase.co/rest/v1/posts?select=*";

beforeEach(() => {
  TESTING_ONLY_reset();
});

describe("the one distinction that matters: asked for, or not", () => {
  it("a declared sign-out is NOT reported as a mystery", () => {
    declareSignOut("member_action", "useAuth.signOut");
    const f = claimSessionLoss();
    expect(f?.cause).toBe("member_action");
    expect(f?.declaredBy).toBe("useAuth.signOut");
  });

  it("an UNdeclared sign-out is involuntary — this is the owner's bug", () => {
    const f = claimSessionLoss();
    expect(f?.cause).toBe("involuntary");
    expect(f?.declaredBy).toBeNull();
  });

  it("a STALE declaration does not launder a later mystery", () => {
    // The danger: a member logs out at 09:00, signs back in, and is randomly
    // signed out at 11:00. If the declaration never expired, the real bug would
    // be filed as "member_action" and nobody would ever look at it.
    vi.useFakeTimers();
    try {
      const base = Date.now();
      vi.setSystemTime(base);
      vi.spyOn(performance, "now").mockReturnValue(0);
      declareSignOut("member_action", "useAuth.signOut");
      vi.spyOn(performance, "now").mockReturnValue(30_000); // 30s later
      expect(claimSessionLoss()?.cause).toBe("involuntary");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("each deliberate path is distinguishable, not lumped together", () => {
    // "signed out by an upload failure" and "member pressed Log out" need
    // completely different fixes.
    for (const [cause, by] of [
      ["account_deleted", "useAuth.checkRestricted"],
      ["delete_account", "DeleteAccountSection"],
      ["sign_out_everywhere", "ActiveDevices"],
      ["upload_auth_failure", "s3Upload"],
    ] as const) {
      TESTING_ONLY_reset();
      declareSignOut(cause, by);
      const f = claimSessionLoss();
      expect(f?.cause).toBe(cause);
      expect(f?.declaredBy).toBe(by);
    }
  });
});

describe("the suspects it must name", () => {
  it("counts CONSECUTIVE refresh failures, and forgives a single one", () => {
    // One failure on a train is noise. Four in a row is a session about to end.
    noteRequest(REFRESH, 500);
    noteRequest(REFRESH, 500);
    expect(collectFacts().refreshFailuresInARow).toBe(2);
    noteRequest(REFRESH, 200);
    expect(collectFacts().refreshFailuresInARow).toBe(0);
  });

  it("separates OUR OWN 25-second abort from the server saying no", () => {
    // This is the distinction the whole recorder exists for: a refresh the
    // server refused and a refresh we cancelled are different bugs.
    noteRequest(REFRESH, "timeout");
    const f = collectFacts();
    expect(f.lastRefreshStatus).toBe("timeout");
    expect(f.lastRefreshOk).toBe(false);
    expect(f.lastRequestWasTimeout).toBe(true);
    expect(f.timeoutsSeen).toBe(1);
  });

  it("separates a dead network from a server response", () => {
    noteRequest(REFRESH, "network");
    expect(collectFacts().lastRefreshStatus).toBe("network");
    expect(collectFacts().lastRequestWasTimeout).toBe(false);
  });

  it("does not mistake an ordinary request for a token refresh", () => {
    noteRequest(REST, 500);
    const f = collectFacts();
    expect(f.lastRefreshStatus).toBeNull();   // no refresh has happened at all
    expect(f.lastRequestStatus).toBe(500);    // but the request was still seen
  });

  it("recognises the refresh endpoint, and only it", () => {
    expect(isTokenRefreshUrl(REFRESH)).toBe(true);
    expect(isTokenRefreshUrl("https://x.supabase.co/auth/v1/token")).toBe(true);
    expect(isTokenRefreshUrl("https://x.supabase.co/auth/v1/user")).toBe(false);
    expect(isTokenRefreshUrl(REST)).toBe(false);
  });

  it("reports whether the stored session survived — and says so honestly when it cannot look", () => {
    const fake = {
      length: 1,
      key: () => "sb-jtdtehuqtinjxropkkcn-auth-token",
    } as unknown as Storage;
    expect(storedSessionPresent(fake)).toBe(true);

    const empty = { length: 0, key: () => null } as unknown as Storage;
    expect(storedSessionPresent(empty)).toBe(false);

    // "I could not look" must never be reported as "it was gone" — that would
    // manufacture the exact finding this recorder is hunting.
    const broken = {
      get length(): number { throw new Error("SecurityError"); },
      key: () => null,
    } as unknown as Storage;
    expect(storedSessionPresent(broken)).toBeNull();
  });

  it("notices backgrounding, because a hidden WebView can be reclaimed", () => {
    const listeners: Array<() => void> = [];
    let visibility = "visible";
    const doc = {
      get visibilityState() { return visibility; },
      addEventListener: (_e: string, fn: () => void) => listeners.push(fn),
    } as unknown as Document;

    installVisibilityObserver(doc);
    visibility = "hidden";
    listeners.forEach((fn) => fn());
    visibility = "visible";
    listeners.forEach((fn) => fn());

    const f = collectFacts();
    expect(f.wasHiddenRecently).toBe(true);
    expect(f.msSinceResume).not.toBeNull();
  });
});

describe("it cannot make an outage worse", () => {
  it("records ONCE — a retry loop cannot flood the log", () => {
    expect(claimSessionLoss()).not.toBeNull();
    expect(claimSessionLoss()).toBeNull();
    expect(claimSessionLoss()).toBeNull();
  });

  it("a NEW session re-arms it, so a repeat victim is visible", () => {
    expect(claimSessionLoss()).not.toBeNull();
    resetForNewSession();
    expect(claimSessionLoss()).not.toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    expect(() => noteRequest(null as unknown as string, 200)).not.toThrow();
    expect(() => noteRequest(REFRESH, undefined as unknown as number)).not.toThrow();
    expect(() => declareSignOut("member_action", null as unknown as string)).not.toThrow();
    expect(() => installVisibilityObserver(null as unknown as Document)).not.toThrow();
    expect(() => collectFacts()).not.toThrow();
  });
});

describe("source-pinned decisions", () => {
  const REC = readFileSync(join(process.cwd(), "src/lib/sessionLossRecorder.ts"), "utf8");
  const AUTH = readFileSync(join(process.cwd(), "src/hooks/core/useAuth.tsx"), "utf8");
  const CLIENT = readFileSync(join(process.cwd(), "src/integrations/supabase/client.ts"), "utf8");

  it("the recorder imports NOTHING — an import closes a cycle through the client", () => {
    // src/integrations/supabase/client.ts imports this file; the logger imports
    // that client. One import here and the module graph eats itself.
    expect(REC).not.toMatch(/^\s*import\s/m);
  });

  it("the recorder writes nothing to storage — the store is itself a suspect", () => {
    expect(REC).not.toMatch(/localStorage\.setItem|sessionStorage\.setItem/);
  });

  it("the fetch wrapper reports every outcome, including the failures", () => {
    expect(CLIENT).toMatch(/noteRequest\(url, res\.status\)/);
    expect(CLIENT).toMatch(/"timeout"\s*:\s*"network"/);
  });

  it("an involuntary loss is ERROR (persisted); a deliberate one is not", () => {
    // logger persists at WARN and above. If an intentional logout were logged
    // at error, 84 members' logouts would bury the handful that are bugs.
    expect(AUTH).toMatch(/if \(involuntary\) logger\.error\(line\)/);
    expect(AUTH).toMatch(/else logger\.debug\(line\)/);
  });

  it("every deliberate sign-out path in the app declares itself", () => {
    // A path that forgets to declare would file a normal logout as the bug.
    const sites: Array<[string, string]> = [
      ["src/hooks/core/useAuth.tsx", "member_action"],
      ["src/hooks/core/useAuth.tsx", "account_deleted"],
      ["src/components/ActiveDevices.tsx", "sign_out_everywhere"],
      ["src/components/settings/DeleteAccountSection.tsx", "delete_account"],
      ["src/lib/s3Upload.ts", "upload_auth_failure"],
    ];
    for (const [file, cause] of sites) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, `${file} must declare ${cause}`).toMatch(
        new RegExp(`declareSignOut\\(\\s*["']${cause}["']`),
      );
    }
  });

  it("EVERY signOut call is matched by a declaration — counted, not just present", () => {
    /**
     * Written as an INVARIANT, not a list of known files, and then tightened
     * again. Two lessons are baked in here:
     *
     *  1. The first version kept an allowlist. When it flagged Login.tsx and
     *     ResetPassword.tsx, the tempting fix was to add them to the list —
     *     which would have made the alarm green while both files still signed
     *     members out silently. The exact bug, hidden by its own alarm.
     *  2. The second version only asked "does this file declare ANYWHERE?".
     *     A mutation deleting ONE of Login.tsx's two declarations passed. So
     *     the calls are now COUNTED: a file with two sign-outs needs two
     *     declarations.
     */
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(e.name) && !p.includes("__tests__")) out.push(p);
      }
      return out;
    };
    const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;
    const short: string[] = [];
    for (const f of walk(join(process.cwd(), "src"))) {
      const src = readFileSync(f, "utf8");
      const signOuts = count(src, /supabase\.auth\.signOut\s*\(/g);
      if (signOuts === 0) continue;
      const declares = count(src, /declareSignOut\s*\(/g);
      if (declares < signOuts) {
        short.push(`${f.replace(process.cwd() + "/", "")}: ${signOuts} signOut, ${declares} declared`);
      }
    }
    expect(short).toEqual([]);
  });
});
