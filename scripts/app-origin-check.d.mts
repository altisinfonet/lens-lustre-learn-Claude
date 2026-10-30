/** Types for scripts/app-origin-check.mjs. */
export declare function parseSiteApi(src: string): string[];
export declare function selectRoutes(
  checkoutPaths: string[],
  deployedPaths: string[] | null,
): { check: string[]; notDeployed: string[] };
