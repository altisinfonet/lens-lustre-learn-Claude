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
    return (
      <span className={className} onMouseEnter={handleMouseEnter}>
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
