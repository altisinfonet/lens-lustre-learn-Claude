import type { Sharp, SharpOptions } from "sharp";

type SharpFactory = (input?: Buffer | string | SharpOptions, options?: SharpOptions) => Sharp;

export declare const CREDIT_FONT_FILE: string;
export declare function measureCredit(sharp: SharpFactory, text: string, px: number): Promise<{ w: number; h: number }>;
export declare function creditFontPx(sharp: SharpFactory, width: number, height: number, text: string): Promise<{ px: number; inset: number }>;
export declare function renderCredit(sharp: SharpFactory, input: Buffer | string, text: string): Promise<{
  image: Sharp;
  width: number;
  height: number;
  credit: { version: 5; fontPx: number; textW: number; textH: number; left: number; top: number; inset: number };
}>;
