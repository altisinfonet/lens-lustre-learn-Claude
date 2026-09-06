import { Link, type LinkProps } from "react-router-dom";
import { useCallback, useRef } from "react";
import { usePrefetchProfile } from "@/hooks/profile/useProfileData";
import { memberPath } from "@/lib/urlHelpers";

interface ProfileLinkProps extends Omit<LinkProps, "to"> {
  /** Still the id: the prefetch cache and the badge lookup are keyed by it. */
  userId: string;
  /**
   * The member's name-URL handle. Required as a PROP and never resolved here —
   * a link component that fetched its own handle would issue one request per
   * link on screen and undo profileMapCache, which exists because that pattern
   * cost 52 requests on a single feed load.
   */
  handle: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}

/**
 * The avatar/wrapper link to a member, with Facebook-style hover prefetch: the
 * profile starts loading before the click lands.
 *
 * F-95 — IT LINKS TO /<handle>, NEVER /profile/<id>. The edge redirect in
 * functions/profile/[id].ts only sees real HTTP requests; an in-app click is a
 * client-side navigation it cannot touch, so an id built here would sit in the
 * address bar and stay there.
 *
 * With no handle this renders its children WITHOUT a link — not a dead anchor,
 * not a disabled control, just the content. Falling back to the id would be the
 * exact address the rule forbids. Hover prefetch still runs, because the id is
 * all that needs, and it means the profile is warm the moment a handle exists.
 */
const ProfileLink = ({ userId, handle, children, className, ...rest }: ProfileLinkProps) => {
  const prefetch = usePrefetchProfile();
  const prefetched = useRef(false);

  const handleMouseEnter = useCallback(() => {
    if (!prefetched.current) {
      prefetched.current = true;
      prefetch(userId);
    }
  }, [userId, prefetch]);

  const href = memberPath(handle);
  if (!href) {
    /*
     * F-98c — TWO FAULTS FIXED IN THIS BRANCH, both found while linking the
     * winners row.
     *
     * 1. `rest` was dropped here and spread only on the <Link> below, so a
     *    caller that passed `style` (this codebase passes a font on almost
     *    every name) silently lost it the moment a member had no handle. The
     *    unlinked name rendered in a different typeface from the linked one.
     * 2. There was no marker. UserIdentityBlock distinguishes a stated null
     *    ("deliberate") from an absent handle ("missing"); this component
     *    rendered both as a bare span, so a walking probe could not tell a
     *    decision from an omission — the exact state the auditor said he would
     *    not accept.
     *
     * `handle === null` is a caller SAYING there is no link. undefined is
     * nobody having decided.
     */
    return (
      <span
        className={className}
        onMouseEnter={handleMouseEnter}
        data-unlinked={handle === null ? "deliberate" : "missing"}
        {...(rest as React.HTMLAttributes<HTMLSpanElement>)}
      >
        {children}
      </span>
    );
  }

  return (
    <Link to={href} className={className} onMouseEnter={handleMouseEnter} {...rest}>
      {children}
    </Link>
  );
};

export default ProfileLink;
