/**
 * F-89 · THE BARE-SHELL FLAG MUST BE RAISED BY *BOTH* ROUTES TO THE 404.
 *
 * The browser probe covers the catch-all route on the real app. It cannot cover
 * the OTHER route — CustomUrlProfile rendering <NotFound /> in place for a dead
 * vanity URL — because `resolve_custom_url` never settles in this container
 * (the egress proxy resets POSTs to supabase.co), so the page sits on the
 * spinner forever and the 404 is never reached there.
 *
 * That is exactly the path a route-list fix would have failed silently, so it
 * is the path that most needs a control. This file is that control, in jsdom,
 * where the RPC is a mock and settles.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n/I18nContext";
import { BareLayoutProvider, useIsBareShell } from "@/components/BareLayoutContext";
import CustomUrlProfile from "@/pages/CustomUrlProfile";
import NotFound from "@/pages/NotFound";

const rpcMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => ({
      select: () => ({
        ilike: () => ({ maybeSingle: () => maybeSingleMock() }),
        eq: () => ({ maybeSingle: () => maybeSingleMock() }),
      }),
    }),
  },
}));

vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("@/pages/PublicProfile", () => ({
  __esModule: true,
  default: () => <div>PROFILE</div>,
  PublicProfileInner: ({ userId }: { userId: string }) => <div>PROFILE {userId}</div>,
}));

/** Stands in for Layout: reports what the shell would do. */
const ShellProbe = () => (
  <div data-testid="shell">{useIsBareShell() ? "BARE" : "WITH-SIDEBARS"}</div>
);

function renderAt(path: string) {
  return render(
    <I18nProvider>
      <BareLayoutProvider>
        <ShellProbe />
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/:customUrl" element={<CustomUrlProfile />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </MemoryRouter>
      </BareLayoutProvider>
    </I18nProvider>,
  );
}

const shell = () => screen.getByTestId("shell").textContent;

beforeEach(() => {
  rpcMock.mockReset();
  maybeSingleMock.mockReset();
  rpcMock.mockResolvedValue({ data: [] });
  maybeSingleMock.mockResolvedValue({ data: null });
});

describe("F-89 · the 404 asks for the bare shell on both routes", () => {
  it("the catch-all route raises the flag", async () => {
    renderAt("/no/such/page/at/all");
    await screen.findByText("This frame is empty");
    await waitFor(() => expect(shell()).toBe("BARE"));
  });

  it("CustomUrlProfile's IN-PLACE 404 raises the flag too", async () => {
    renderAt("/zzz-definitely-not-a-page-98765");
    await screen.findByText("This frame is empty");
    await waitFor(() => expect(shell()).toBe("BARE"));
  });

  it("GUARD a resolved vanity url does NOT raise it — the profile keeps its sidebars", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", is_current: true }] });
    renderAt("/a-real-member");
    await screen.findByText("PROFILE user-1");
    expect(shell()).toBe("WITH-SIDEBARS");
  });

  it("GUARD a signed-out visitor is given BOTH a signup and a login link", async () => {
    renderAt("/no/such/page/at/all");
    await screen.findByText("This frame is empty");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/signup");
    expect(hrefs).toContain("/login");
  });
});
