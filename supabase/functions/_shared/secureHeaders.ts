/**
 * Shared secure headers for all edge functions.
 * Includes CORS restrictions, security headers, and cache control.
 */

const ALLOWED_ORIGINS = [
  "https://50mmretina.com",
  "https://www.50mmretina.com",
  "https://fiftymmretinaworld.lovable.app",
  "https://lens-lustre-learn.lovable.app",
  "https://id-preview--8658c335-87a2-4e48-86ad-6c1fff54dead.lovable.app",
];

export function getSecureHeaders(req?: Request): Record<string, string> {
  let origin = "*";
  if (req) {
    const requestOrigin = req.headers.get("Origin") || "";
    if (ALLOWED_ORIGINS.some((o) => requestOrigin.startsWith(o))) {
      origin = requestOrigin;
    } else if (requestOrigin.endsWith(".lovable.app")) {
      origin = requestOrigin; // Allow all lovable preview subdomains
    }
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
}
