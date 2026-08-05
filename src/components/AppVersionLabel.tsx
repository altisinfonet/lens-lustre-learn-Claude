/**
 * The loaded build number, rendered beside the Logout button.
 *
 * Owner, 2026-08-05: "…show app version so that user can understand
 * 1050 (1.2.2) … what is the current app version loaded". See
 * src/lib/appVersion.ts for where the string comes from on each surface.
 *
 * Renders nothing while unknown or when no version can be determined —
 * the Logout row must never show a wrong number, and with this component
 * absent the button simply keeps the whole row.
 */
import { useEffect, useState } from "react";
import { getAppVersionLabel } from "@/lib/appVersion";

const headingFont = { fontFamily: "var(--font-heading)" };

const AppVersionLabel = () => {
  const [label, setLabel] = useState("");

  useEffect(() => {
    let alive = true;
    getAppVersionLabel().then((v) => {
      if (alive) setLabel(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!label) return null;

  return (
    <span
      className="flex-1 px-4 text-[9px] tracking-[0.1em] uppercase text-muted-foreground"
      style={headingFont}
    >
      {label}
    </span>
  );
};

export default AppVersionLabel;
