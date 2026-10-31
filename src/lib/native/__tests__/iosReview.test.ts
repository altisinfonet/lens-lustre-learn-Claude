/**
 * The App Store review helpers (src/lib/native/iosReview.ts): what counts as
 * a money notification, a paid course, money in a prize line, and how lesson
 * videos move to youtube-nocookie.com.
 */
import { describe, it, expect } from "vitest";
import { isWalletNotificationType, isPaidCourse, toYouTubeNoCookie, hasMoneyText } from "../iosReview";

describe("isWalletNotificationType", () => {
  it.each(["deposit_approved", "deposit_rejected", "withdrawal_approved", "gift_received", "referral_earning", "vote_reward", "wallet_credited"])(
    "%s is a money notification", (t) => expect(isWalletNotificationType(t)).toBe(true),
  );
  it.each(["post_reaction", "competition_vote", "new_follower", "vote_reward_x", "my_deposit_", "", null, undefined])(
    "%s is not", (t) => expect(isWalletNotificationType(t as string)).toBe(false),
  );
});

describe("isPaidCourse", () => {
  it("free courses are not paid", () => {
    expect(isPaidCourse({ is_free: true, price: 49 })).toBe(false);
    expect(isPaidCourse({ is_free: false, price: 0 })).toBe(false);
  });
  it("a price above zero, or a course that does not say it is free, is paid", () => {
    expect(isPaidCourse({ is_free: false, price: 9.99 })).toBe(true);
    expect(isPaidCourse({ is_free: false })).toBe(true);
    expect(isPaidCourse({})).toBe(true);
  });
});

describe("toYouTubeNoCookie", () => {
  it("rewrites youtube.com/embed and youtu.be, keeping the query", () => {
    expect(toYouTubeNoCookie("https://www.youtube.com/embed/abc123?start=10")).toBe("https://www.youtube-nocookie.com/embed/abc123?start=10");
    expect(toYouTubeNoCookie("https://youtube.com/embed/abc123")).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(toYouTubeNoCookie("https://youtu.be/abc123")).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(toYouTubeNoCookie("https://youtu.be/abc123?t=5")).toBe("https://www.youtube-nocookie.com/embed/abc123?t=5");
  });
  it("leaves every other URL alone", () => {
    for (const u of ["https://player.vimeo.com/video/1", "https://www.youtube-nocookie.com/embed/x", "https://evil.com/youtube.com/embed/x"]) {
      expect(toYouTubeNoCookie(u)).toBe(u);
    }
  });
});

describe("hasMoneyText", () => {
  it.each(["$500 grand prize", "₹10,000 cash", "100 USD", "Wallet credits", "500 rupees"])("%s mentions money", (s) => expect(hasMoneyText(s)).toBe(true));
  it.each(["Certificate + featured on the home page", "Trophy and a feature", "", null])("%s does not", (s) => expect(hasMoneyText(s as string)).toBe(false));
});
