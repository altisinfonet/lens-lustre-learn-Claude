/** Types for tools/uishot/video-shape.mjs. */
export interface ShapeInput {
  manifest: { width: number; height: number; duration_s: number };
  /** media playlists of the encoded package, by file name (master.m3u8 may be included) */
  playlists?: Record<string, string>;
  /** sha256 of the bytes the page actually encoded */
  sourceSha256?: string;
  /** sha256 of the fixture the harness made for this case */
  fixtureSha256?: string;
}
export declare function playlistSeconds(text: string): number;
export declare function judgeShape(
  r: ShapeInput,
  expect: { portrait: boolean; seconds: number },
): { ok: boolean; reasons: string[]; renditionSeconds?: Record<string, number> };
