import { forwardRef } from "react";

/** Instagram/Facebook-style verified badge – blue starburst with white checkmark */
const VerifiedBadge = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  ({ className = "h-4 w-4", ...props }, ref) => (
    <svg ref={ref} viewBox="0 0 24 24" fill="none" className={className} aria-label="Verified" {...props}>
      <path
        d="M12 0l2.37 3.15L18 2.1l.9 3.9 4 .45-2.1 3.45L23.1 13.5l-3.6 1.8.15 4.05-3.9-.75L12 21.75 8.25 18.6l-3.9.75.15-4.05L.9 13.5 3.2 9.9 1.1 6.45l4-.45L6 2.1l3.63 1.05L12 0z"
        fill="#1D9BF0"
      />
      <path
        d="M9.5 12.5l2 2 4-4.5"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
);

VerifiedBadge.displayName = "VerifiedBadge";

export default VerifiedBadge;
