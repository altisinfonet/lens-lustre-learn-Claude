export declare const CREDIT_GEOMETRY: Readonly<{
  version: number;
  urlVersion: number;
}>;
export declare const CREDIT_GEOMETRY_V5: Readonly<{
  version: 5;
  fontPctShort: number;
  minFontPx: number;
  maxFontPx: number;
  tinyMinFontPx: number;
  insetPctShort: number;
  insetMinEm: number;
  fillAlpha: number;
  shadowAlpha: number;
  shadowBlurEm: number;
  shadowOffsetEm: number;
  maxLinePct: number;
  fontFamily: string;
  fontStyle: string;
  weight: number;
}>;
export declare function creditGeometryV5For(width: number, height: number): {
  fontPx: number;
  inset: number;
  maxLineWidth: number;
};
