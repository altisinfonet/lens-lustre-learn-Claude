import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { fireConversion } from "@/lib/adConversionContext";

/**
 * Global conversion tracker — automatically fires ad conversions for:
 * 1. WhatsApp link clicks (wa.me / api.whatsapp.com)
 * 2. CTA buttons with data-ad-cta attribute
 * 3. Form submission success (forms with data-ad-form attribute)
 * 4. Payment success route detection
 *
 * Mount once in Layout. Zero-risk: purely additive, fire-and-forget.
 */

const PAYMENT_SUCCESS_PARAMS = ["payment_success", "payment_status"];

export const useGlobalConversionTracker = () => {
  const { pathname, search } = useLocation();

  // ── 1. Payment success route detection ──
  useEffect(() => {
    const params = new URLSearchParams(search);
    const isPaymentSuccess =
      PAYMENT_SUCCESS_PARAMS.some((key) => params.get(key) === "true" || params.get(key) === "success") ||
      pathname.includes("/payment-success");

    if (isPaymentSuccess) {
      const amount = parseFloat(params.get("amount") || "0") || undefined;
      fireConversion("payment_success", amount ? { amount } : undefined);
    }
  }, [pathname, search]);

  // ── 2. WhatsApp clicks + CTA buttons + Form submissions ──
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Walk up the DOM tree to find relevant elements (max 5 levels for performance)
      let el: HTMLElement | null = target;
      for (let i = 0; i < 5 && el; i++) {
        // WhatsApp link detection
        if (el.tagName === "A") {
          const href = (el as HTMLAnchorElement).href || "";
          if (href.includes("wa.me/") || href.includes("api.whatsapp.com")) {
            fireConversion("whatsapp_click", { url: href });
            return;
          }
        }

        // CTA button detection via data attribute
        if (el.hasAttribute("data-ad-cta")) {
          const ctaLabel = el.getAttribute("data-ad-cta") || "unknown";
          fireConversion("cta_click", { cta: ctaLabel });
          return;
        }

        el = el.parentElement;
      }
    };

    // Form submission detection
    const handleSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!form || form.tagName !== "FORM") return;

      // Only track forms explicitly marked for ad tracking
      if (form.hasAttribute("data-ad-form")) {
        const formName = form.getAttribute("data-ad-form") || "unknown";
        // Fire after a short delay to ensure form succeeds (non-blocking)
        setTimeout(() => {
          fireConversion("form_submission", { form: formName });
        }, 500);
      }
    };

    document.addEventListener("click", handleClick, { capture: true, passive: true });
    document.addEventListener("submit", handleSubmit, { capture: true, passive: true });

    return () => {
      document.removeEventListener("click", handleClick, { capture: true } as EventListenerOptions);
      document.removeEventListener("submit", handleSubmit, { capture: true } as EventListenerOptions);
    };
  }, []);
};
