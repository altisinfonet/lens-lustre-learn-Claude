/** Types for scripts/web-build-commit.mjs (F-AUD-1). */
export declare const META_NAME: "build-commit";
export declare function resolveBuildCommit(env?: Record<string, string | undefined>, git?: () => string): string;
export declare function stampHtml(html: string, sha: string): string;
export declare function readStamp(html: string): string | null;
export declare function buildCommitPlugin(): {
  name: string;
  apply: "build";
  transformIndexHtml: { order: "post"; handler: (html: string) => string };
};
