// Types for the vendored thumbhash@0.1.1 (thumbhash.mjs beside this file).
export function rgbaToThumbHash(w: number, h: number, rgba: ArrayLike<number>): Uint8Array;
export function thumbHashToRGBA(hash: ArrayLike<number>): { w: number; h: number; rgba: Uint8Array };
export function thumbHashToAverageRGBA(hash: ArrayLike<number>): { r: number; g: number; b: number; a: number };
export function thumbHashToApproximateAspectRatio(hash: ArrayLike<number>): number;
export function rgbaToDataURL(w: number, h: number, rgba: ArrayLike<number>): string;
export function thumbHashToDataURL(hash: ArrayLike<number>): string;
