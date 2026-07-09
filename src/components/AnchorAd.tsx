import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { useLocation } from "react-router-dom";
import AdPlacement from "@/components/AdPlacement";

const hideRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"];

const AnchorAd = () => {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [adsEmpty, setAdsEmpty] = useState(false);

  const isHidden = hideRoutes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (isHidden || dismissed) return null;

  // Hide entire sticky container when no ads are active
  if (adsEmpty) return null;

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-12 lg:bottom-0 left-0 right-0 z-[70] flex justify-center pointer-events-none">
      <div className="relative pointer-events-auto w-[320px] h-[50px] lg:w-[728px] lg:h-[90px] bg-background/95 backdrop-blur-sm border-t border-border shadow-lg">
        <button
          onClick={handleDismiss}
          className="absolute -top-6 left-1 lg:left-auto lg:right-2 z-50 bg-background/90 border border-border rounded-full p-0.5 hover:bg-muted transition-colors pointer-events-auto"
          aria-label="Close ad"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <AdPlacement placement="anchor-bottom" variant="plain" maxAds={1} reportEmpty={setAdsEmpty} />
      </div>
    </div>
  );
};

export default AnchorAd;
