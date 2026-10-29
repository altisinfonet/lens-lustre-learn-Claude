import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

let release: Record<string, (v: string) => void> = {};
vi.mock("qrcode", () => ({
  default: { toDataURL: (url: string) => new Promise<string>((r) => { release[url] = r; }) },
}));

import QRCodeCard from "@/components/profile/QRCodeCard";

describe("S11 — the QR code library is not in every visitor's first script", () => {
  it("QRCodeCard has no static import of qrcode (it is loaded with the card)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../QRCodeCard.tsx"), "utf8");
    expect(src).not.toMatch(/^import [^;]* from "qrcode";/m);
    expect(src).toContain('import("qrcode")');
  });

  it("shows the QR for the CURRENT url; a slower answer for an earlier url is ignored", async () => {
    release = {};
    const { rerender, container } = render(<QRCodeCard profileUrl="https://x/a" displayName="A" />);
    await waitFor(() => expect(release["https://x/a"]).toBeTypeOf("function"));
    rerender(<QRCodeCard profileUrl="https://x/b" displayName="A" />);
    await waitFor(() => expect(release["https://x/b"]).toBeTypeOf("function"));
    release["https://x/b"]("data:image/png;base64,BBBB");
    await waitFor(() => expect(container.querySelector('img[src="data:image/png;base64,BBBB"]')).not.toBeNull());
    release["https://x/a"]("data:image/png;base64,AAAA");
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('img[src="data:image/png;base64,AAAA"]')).toBeNull();
    void screen;
  });
});
