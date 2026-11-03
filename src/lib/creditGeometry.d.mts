export declare const CREDIT_GEOMETRY: Readonly<{
  version: number;
  sampleFontPx: number;
  sampleWidth: number;
  sizeDivisor: number;
  minFontPx: number;
  fillAlpha: number;
  shadowAlpha: number;
  rightPct: number;
  bottomPct: number;
  maxLinePct: number;
  weight: number;
}>;
export declare function creditGeometryFor(width: number, height: number): {
  fontPx: number;
  x: number;
  y: number;
  fill: string;
  shadow: string;
  shadowOffsetY: number;
  shadowBlur: number;
};
