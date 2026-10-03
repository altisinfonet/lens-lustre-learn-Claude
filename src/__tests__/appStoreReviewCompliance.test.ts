import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * App Store review of build 18 (2026-09-28) rejected 1.2, 2.1(b), 4.8 and
 * 5.1.1(v). These guard the code-level answers so a later edit cannot quietly
 * undo them.
 */
describe("App Store review compliance", () => {
  it("4.8 — no Sign in with Apple code remains, and the iOS build offers no Google login", () => {
    for (const f of ["src/pages/Login.tsx", "src/pages/Signup.tsx", "src/lib/oauthHelper.ts", "src/hooks/core/useAuthPageSettings.ts"]) {
      expect(read(f), f).not.toMatch(/show_apple|APPLE_SIGN_IN_ENABLED|continueApple|"apple"/);
    }
    expect(read("src/pages/Login.tsx")).toMatch(/!isNativeIOSApp\(\)/);
    expect(read("src/pages/Signup.tsx")).toMatch(/!isNativeIOSApp\(\)/);
  });

  it("1.2 — terms are agreed before registering, and posts, comments and profiles can block", () => {
    expect(read("src/pages/Signup.tsx")).toMatch(/eulaAccepted/);
    expect(read("src/pages/Login.tsx")).toMatch(/community-guidelines/);
    expect(read("src/components/post/PostCard.tsx")).toMatch(/BlockUserDialog/);
    expect(read("src/components/comments/CommentThread.tsx")).toMatch(/onBlockUser/);
    expect(read("src/pages/PublicProfile.tsx")).toMatch(/BlockUserButton/);
    expect(read("src/pages/Feed.tsx")).toMatch(/blockedIds/);
  });

  it("5.1.1(v) — Delete Account is reachable from both account menus", () => {
    expect(read("src/components/UserMenu.tsx")).toMatch(/Delete Account/);
    expect(read("src/components/MobileProfileSheet.tsx")).toMatch(/Delete Account/);
  });

  it("3.1.1 — the wallet is not offered in the iOS app", () => {
    expect(read("src/components/UserMenu.tsx")).toMatch(/label: "Wallet"[^\n]*show: !isNativeIOSApp\(\)/);
    expect(read("src/components/MobileProfileSheet.tsx")).toMatch(/label: "Wallet"[^\n]*show: !isNativeIOSApp\(\)/);
    expect(read("src/App.tsx")).toMatch(/path="\/wallet" element=\{isNativeIOSApp\(\)/);
  });

  it("user_blocks migration is closed to anon and has a rollback and a probe", () => {
    const m = read("supabase/migrations/20261003_0001_user_blocks.sql");
    expect(m).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(m).toMatch(/REVOKE ALL ON public\.user_blocks FROM anon/);
    expect(m).not.toMatch(/GRANT[^;]*user_blocks[^;]*TO anon/);
    read("supabase/rollback/20261003_0001_user_blocks_ROLLBACK.sql");
    read("supabase/migrations/PROBE_user_blocks_closed.sql");
  });
});
