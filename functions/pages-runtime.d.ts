/**
 * Minimal ambient types for the Cloudflare Pages Functions runtime.
 *
 * Why this exists: functions/_seo.ts uses HTMLRewriter, a Workers-runtime
 * global with no DOM or Node equivalent. Nothing had ever pulled functions/
 * into the app's TypeScript program, so the missing global went unnoticed.
 * G5b's unit test imports functions/_seo.ts to prove it has no production
 * defaults, which put the file in the program and surfaced TS2304.
 *
 * Declared narrowly, covering only what functions/ actually uses, rather than
 * pulling in the whole @cloudflare/workers-types surface: a small honest
 * declaration is easier to check against reality than a large borrowed one.
 */
declare class HTMLRewriter {
  on(selector: string, handlers: {
    element?(element: {
      remove(): void;
      setAttribute(name: string, value: string): void;
      setInnerContent(content: string, options?: { html?: boolean }): void;
      append(content: string, options?: { html?: boolean }): void;
    }): void;
  }): HTMLRewriter;
  transform(response: Response): Response;
}
