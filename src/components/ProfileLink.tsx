import { Link, type LinkProps } from "react-router-dom";
import { useCallback, useRef } from "react";
import { usePrefetchProfile } from "@/hooks/profile/useProfileData";

interface ProfileLinkProps extends Omit<LinkProps, "to"> {
  userId: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A Link to /profile/:userId that prefetches profile data on hover.
 * Facebook-style: data starts loading before you click.
 */
const ProfileLink = ({ userId, children, className, ...rest }: ProfileLinkProps) => {
  const prefetch = usePrefetchProfile();
  const prefetched = useRef(false);

  const handleMouseEnter = useCallback(() => {
    if (!prefetched.current) {
      prefetched.current = true;
      prefetch(userId);
    }
  }, [userId, prefetch]);

  return (
    <Link
      to={`/profile/${userId}`}
      className={className}
      onMouseEnter={handleMouseEnter}
      {...rest}
    >
      {children}
    </Link>
  );
};

export default ProfileLink;
