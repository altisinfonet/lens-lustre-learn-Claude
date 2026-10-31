/**
 * HTML Injection Prevention Utility
 *
 * Sanitizes user-supplied strings to prevent XSS and HTML injection attacks.
 * Use this whenever rendering user content that could contain HTML.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#96;",
};

/**
 * Escapes HTML special characters to prevent injection.
 */
export function escapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/[&<>"'\/`]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Strip all HTML tags from a string, keeping only text content.
 */
export function stripHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

/**
 * Convert rich HTML into safe plain text for non-HTML surfaces
 * such as PDF text, native share text, meta descriptions, and JSON-LD.
 */
export function htmlToPlainText(str: string, maxLength?: number): string {
  if (!str) return "";

  const withoutActiveContent = sanitizeUserContent(str)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n");

  let plain = stripHtml(withoutActiveContent)
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (maxLength && plain.length > maxLength) {
    plain = `${plain.slice(0, maxLength).trimEnd()}…`;
  }

  return plain;
}

/**
 * Sanitize a URL to prevent javascript: and data: protocol attacks.
 */
export function sanitizeUrl(url: string): string {
  if (!url) return "";
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("vbscript:") ||
    trimmed.startsWith("data:text/html")
  ) {
    return "";
  }
  return url;
}

/**
 * Sanitize user input for safe display. Removes script tags and event handlers.
 */
export function sanitizeUserContent(str: string): string {
  if (!str) return "";
  return str
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/on\w+\s*=\s*\S+/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/vbscript\s*:/gi, "");
}
