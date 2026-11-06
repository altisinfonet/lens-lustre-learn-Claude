/**
 * Owner, 6 Nov 2026: "join now image not coming many times". The sign-in /
 * sign-up picture comes from site settings that dashboard-init seeds. When the
 * page drew BEFORE they were seeded, the old hook (a one-time getQueryData)
 * kept an empty address for good. These fail on that hook and pass now.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";

const gate = vi.hoisted(() => ({ open: null as null | (() => void), wait: null as null | Promise<void>, fetched: [] as string[] }));
vi.mock("@/lib/dashboardInitGate", () => ({ awaitDashboardBootstrap: () => gate.wait ?? Promise.resolve() }));
vi.mock("@/lib/siteSettingsCache", () => ({
  getSiteSetting: async (key: string) => {
    gate.fetched.push(key);
    return key === "signup_background" ? "https://cdn.50mmretina.com/site/join.webp" : null;
  },
}));

import { useAuthPageSettings } from "@/hooks/core/useAuthPageSettings";

const IMG = "https://cdn.50mmretina.com/site/join.webp";
let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  gate.fetched = [];
  gate.wait = new Promise<void>((r) => { gate.open = r; });
});

describe("the sign-up picture always arrives", () => {
  it("the page drew BEFORE dashboard-init seeded the picture → it appears once seeded", async () => {
    const { result } = renderHook(() => useAuthPageSettings(), { wrapper });
    expect(result.current.settings.signup.background_image).toBe(""); // not in yet
    await act(async () => {
      qc.setQueryData(["site-setting", "signup_background"], `"${IMG}"`); // dashboard-init seeds it
      gate.open!();
    });
    await waitFor(() => expect(result.current.settings.signup.background_image).toBe(IMG));
  });

  it("nothing seeded it at all → the page asks for it itself", async () => {
    const { result } = renderHook(() => useAuthPageSettings(), { wrapper });
    await act(async () => { gate.open!(); });
    await waitFor(() => expect(result.current.settings.signup.background_image).toBe(IMG));
    expect(gate.fetched).toContain("signup_background");
  });
});
