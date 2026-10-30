/** Types for tools/uishot/a11y-surfaces-ratchet.mjs. */
export type Counts = Record<string, number>;
export type Entry = Counts | { error: string };
export interface SurfacesBaseline {
  _about?: string;
  surfaces: Record<string, Record<string, Counts>>;
}
export declare const A11Y_BASELINE_PATH: string;
export declare const SURFACE_SCENES: string[];
export declare const SURFACE_WIDTHS: Array<{ name: string; width: number; height: number; mobile: boolean }>;
export declare const CHECK_RULES: { B: string; C: string; D: string; E: string };
export declare function entryKey(scene: string, width: string): string;
export declare function splitKey(key: string): [string, string];
export declare function flatten(baseline: unknown): { scenes: Record<string, Counts> } | null;
export declare function unflatten(flat: Record<string, Counts>): Record<string, Record<string, Counts>>;
export declare function judge(baseline: unknown, current: Record<string, Entry>, fullRun: boolean): string[];
export declare function recordBaseline(baseline: unknown, current: Record<string, Entry>): SurfacesBaseline;
export declare function lowerSurfaces(baseline: unknown, current: Record<string, Entry>): SurfacesBaseline;
