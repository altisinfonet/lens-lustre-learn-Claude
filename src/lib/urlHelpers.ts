/**
 * URL helper utilities for human-readable URLs throughout the app.
 */

/** Build a competition URL using slug (preferred) or ID fallback */
export function competitionUrl(comp: { slug?: string | null; id: string }) {
  return `/competitions/${comp.slug || comp.id}`;
}

/** Build a profile URL using custom vanity URL (preferred) or ID fallback */
export function profileUrl(profile: { custom_url?: string | null; id: string }) {
  return profile.custom_url ? `/${profile.custom_url}` : `/profile/${profile.id}`;
}

/** Build structured page title: "Page | Sub | 50mm Retina World" */
export function pageTitle(...parts: (string | undefined | null)[]) {
  const filtered = parts.filter(Boolean) as string[];
  if (filtered.length === 0) return "50mm Retina World";
  return [...filtered, "50mm Retina World"].join(" | ");
}
