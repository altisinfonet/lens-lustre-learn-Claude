/**
 * /settings/notifications: the switch picks the screen. Off (live today) →
 * today's three lists; on → the one table. Same preferences either way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let centre = false;
vi.mock("@/lib/notifications/centreUi", () => ({ useCentreUi: () => centre }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" }, loading: false }) }));
vi.mock("@/hooks/core/useNotificationSound", () => ({ useNotificationSound: () => ({ soundEnabled: true, setSoundEnabled: vi.fn() }) }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (k: string, fb?: string) => fb ?? k }));
vi.mock("@/components/PageSEO", () => ({ default: () => null }));
const prefs = {
  email_reactions: true, email_comments: true, email_friend_requests: true, email_new_followers: true,
  email_competition_updates: true, email_gift_credits: true, email_certificates: true, email_course_updates: true,
  inapp_reactions: true, inapp_comments: true, inapp_social: true, inapp_competitions: true,
  email_weekly_digest: true, email_reengagement: true, push_enabled: true, push_reactions: true, push_comments: true,
  push_friend_requests: true, push_new_followers: true, push_competition_updates: true, push_new_posts: true, push_announcements: true,
};
vi.mock("@/hooks/notifications/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ preferences: prefs, isLoading: false, updatePreference: vi.fn() }),
}));

import NotificationSettings from "@/pages/NotificationSettings";

const renderPage = () => render(<MemoryRouter><NotificationSettings /></MemoryRouter>);

describe("notification settings — which screen", () => {
  beforeEach(() => { centre = false; });

  it("switch off: today's lists, no table", () => {
    renderPage();
    expect(screen.queryByRole("table", { name: /notification settings/i })).toBeNull();
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(15);
    expect(screen.getAllByText("notif.pushAll").length).toBeGreaterThan(0);   // today's push section heading row
  });

  it("switch on: the one table", () => {
    centre = true;
    renderPage();
    expect(screen.getByRole("table", { name: /notification settings/i })).toBeInTheDocument();
  });
});
