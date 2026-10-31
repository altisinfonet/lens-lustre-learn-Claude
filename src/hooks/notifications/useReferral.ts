import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * On signup page, captures ?ref=CODE into sessionStorage so we can
 * link the new user to the referrer after registration.
 */
export const useCaptureReferral = () => {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      sessionStorage.setItem("referral_code", ref);
    }
  }, [searchParams]);
};

export const getStoredReferralCode = (): string | null => {
  return sessionStorage.getItem("referral_code");
};

export const clearStoredReferralCode = () => {
  sessionStorage.removeItem("referral_code");
};
