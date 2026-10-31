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

/**
 * App Store review, final round (2026-10-17). One test per point of the
 * Owner's list (1–7), plus the server push filter. Web and Android are
 * untouched: every visible change is behind isNativeIOSApp().
 */
describe("App Store review compliance — final iOS round", () => {
  it("1 — Ask Anything is not rendered in the iOS app", () => {
    expect(read("src/components/Layout.tsx")).toMatch(/isHome && !hideNav && !isNativeIOSApp\(\) && <AskAnything \/>/);
  });

  it("2 — no Google Play badge or Get App action in the iOS app", () => {
    const index = read("src/pages/Index.tsx");
    const badge = index.indexOf("play.google.com");
    expect(badge).toBeGreaterThan(0);
    expect(index.lastIndexOf("{!isNativeIOSApp() && (", badge)).toBeGreaterThan(badge - 600);
    expect(read("src/components/MobileProfileSheet.tsx")).toMatch(/showInstallAction = !isNativeApp && !isNativeIOSApp\(\)/);
    for (const f of ["src/components/SiteFooter.tsx", "src/components/Layout.tsx", "src/components/UserMenu.tsx"]) {
      expect(read(f), f).not.toMatch(/play\.google\.com/);
    }
  });

  it("3 — no wallet, money or reward text in the iOS app", () => {
    const voting = read("src/hooks/competition/useCompetitionVoting.ts");
    expect(voting).toMatch(/if \(isNativeIOSApp\(\)\) \{\s*\/\/[^\n]*\n\s*toast\(\{ title: action === "vote" \? "Vote recorded" : "Vote removed" \}\);/);
    for (const f of ["src/components/VotingLightbox.tsx", "src/components/CompetitionLightbox.tsx", "src/components/EntryCard.tsx"]) {
      expect(read(f), f).toMatch(/isNativeIOSApp\(\)[\s\S]{0,120}(Tap again to remove your vote|Your vote for this photo will be removed)/);
    }
    expect(read("src/components/UserMenu.tsx")).toMatch(/label: "Referrals"[^\n]*show: !isNativeIOSApp\(\)/);
    expect(read("src/components/MobileProfileSheet.tsx")).toMatch(/label: "Referrals"[^\n]*show: !isNativeIOSApp\(\)/);
    expect(read("src/App.tsx")).toMatch(/path="\/referrals" element=\{isNativeIOSApp\(\) \? <Navigate to="\/dashboard" replace \/>/);
    expect(read("src/components/Layout.tsx")).toMatch(/!showOnboarding && !isNativeIOSApp\(\) && <GiftCelebrationModal \/>/);
    const bell = read("src/components/NotificationBell.tsx");
    expect(bell).toMatch(/allUserNotifications\.filter\(\(g\) => !isWalletNotificationType\(g\.type\)\)/);
    expect(bell).toMatch(/\{!ios && giftNotifications\.length > 0/);
    expect(read("src/pages/Notifications.tsx")).toMatch(/isNativeIOSApp\(\) && isWalletNotificationType\(g\.type\)/);
    expect(read("src/pages/NotificationSettings.tsx")).toMatch(/\{!isNativeIOSApp\(\) && \(\s*<ToggleRow\s*icon=\{<Gift/);
    for (const f of ["src/components/settings/DeleteAccountSection.tsx", "src/pages/HelpSupport.tsx"]) {
      const iosText = [...read(f).matchAll(/isNativeIOSApp\(\)\s*\?\s*"([^"]+)"/g)].map((m) => m[1]).join(" ");
      expect(iosText, f).toMatch(/Deletion removes your profile, photos, posts, comments, competition entries and certificates/);
      expect(iosText, f).not.toMatch(/wallet|withdraw|payout/i);
    }
    expect(read("src/lib/notificationLinks.ts")).toMatch(/if \(isNativeIOSApp\(\) && isWalletNotificationType\(notif\.type\)\) return "\/dashboard";/);
    expect(read("src/components/ads/RewardedAdEntry.tsx")).toMatch(/if \(!eligible \|\| isNativeIOSApp\(\)\) return null;/);
    expect(read("src/components/FeedLeftSidebar.tsx")).toMatch(/isNativeIOSApp\(\) \? t\("sidebar\.voteIos", "Vote"\)/);
    for (const f of ["src/pages/CompetitionDetail.tsx", "src/pages/Competitions.tsx"]) {
      expect(read(f), f).toMatch(/prize_info && !\(isNativeIOSApp\(\) && hasMoneyText\(/);
    }
  });

  it("4 — no Refund Policy in the iOS app: footer link hidden, the page redirects to Help", () => {
    expect(read("src/components/SiteFooter.tsx")).toMatch(/!\(isNativeIOSApp\(\) && page\.slug === "refund-policy"\)/);
    expect(read("src/pages/ManagedPageView.tsx")).toMatch(/if \(isNativeIOSApp\(\) && slug === "refund-policy"\) return <Navigate to="\/help-support" replace \/>;/);
  });

  it("5 — a paid course is hidden from lists and its page redirects on iOS unless enrolled; never 'Enroll for $'", () => {
    expect(read("src/hooks/content/useCourses.ts")).toMatch(/isNativeIOSApp\(\) \? data\.filter\(\(c: any\) => !isPaidCourse\(c\)\)/);
    expect(read("src/components/FeedRightSidebar.tsx")).toMatch(/!\(isNativeIOSApp\(\) && isPaidCourse\(c\)\)/);
    expect(read("src/pages/CourseDetail.tsx")).toMatch(/if \(isNativeIOSApp\(\) && isPaidCourse\(course\) && !courseData\?\.enrolled\) return <Navigate to="\/courses" replace \/>;/);
    expect(read("src/components/course/CourseSidebar.tsx")).toMatch(/course\.is_free \|\| isNativeIOSApp\(\)\s*\? t\("crs\.startLearning"\)/);
  });

  it("6 — lesson videos play from youtube-nocookie.com, and the CSP lets them", () => {
    expect(read("src/pages/LessonView.tsx")).toMatch(/src=\{toYouTubeNoCookie\(lesson\.video_url\)\}/);
    expect(/frame-src[^;]*https:\/\/www\.youtube-nocookie\.com/.test(read("public/_headers"))).toBe(true);
  });

  it("7 — test pages render only in development builds", () => {
    const app = read("src/App.tsx");
    for (const [path, el] of [["/__crop-test", "CropTest"], ["/dev/phase7-badges", "Phase7BadgesQA"], ["/qa/watermark-matrix", "WatermarkQAMatrix"]]) {
      expect(app, path).toContain(`<Route path="${path}" element={import.meta.env.DEV ? <${el} /> : <NotFound />} />`);
    }
  });

  it("push — send-push skips iOS devices for money notification types", () => {
    const fn = read("supabase/functions/send-push/index.ts");
    expect(fn).toMatch(/select\("token, platform"\)/);
    expect(fn).toMatch(/!\(walletType && t\.platform === "ios"\)/);
    // The server's list and the app's list are the same rule.
    const re = /\/\^\(deposit_\|withdrawal_\|gift_\|referral_\|wallet_\)\|\^vote_reward\$\//;
    expect(fn).toMatch(re);
    expect(read("src/lib/native/iosReview.ts")).toMatch(re);
  });
});
