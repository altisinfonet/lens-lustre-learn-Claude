/**
 * P12 — choosing a language downloads THAT language only.
 *
 * Each `translations.<code>` module is mocked to record that it was loaded.
 * Choosing Hindi must load hi and nothing else; switching to Tamil must then
 * load ta only; English loads nothing. Under the pre-P12 shape (one shared
 * `translations.rest` chunk) the first assertion could not hold — every
 * choice paid for six dictionaries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { useEffect } from "react";

const loaded = vi.hoisted(() => [] as string[]);
const dict = (code: string) => ({ default: { "nav.home": `home-${code}` } });
vi.mock("../translations.hi", () => { loaded.push("hi"); return dict("hi"); });
vi.mock("../translations.bn", () => { loaded.push("bn"); return dict("bn"); });
vi.mock("../translations.mr", () => { loaded.push("mr"); return dict("mr"); });
vi.mock("../translations.gu", () => { loaded.push("gu"); return dict("gu"); });
vi.mock("../translations.ta", () => { loaded.push("ta"); return dict("ta"); });
vi.mock("../translations.te", () => { loaded.push("te"); return dict("te"); });

import { I18nProvider, useI18n } from "../I18nContext";

let api: ReturnType<typeof useI18n>;
function Probe() {
  const v = useI18n();
  useEffect(() => { api = v; });
  return <span data-testid="t">{v.t("nav.home")}</span>;
}

beforeEach(() => {
  try { localStorage.setItem("app_lang", "en"); } catch { /* ignore */ }
});

describe("P12 · one chunk per language", () => {
  it("English loads no dictionary; Hindi loads hi only; then Tamil loads ta only", async () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(loaded).toEqual([]);

    await act(async () => { api.setLang("hi"); });
    await screen.findByText("home-hi");
    expect(loaded).toEqual(["hi"]);

    await act(async () => { api.setLang("ta"); });
    await screen.findByText("home-ta");
    expect(loaded).toEqual(["hi", "ta"]);
  });
});
