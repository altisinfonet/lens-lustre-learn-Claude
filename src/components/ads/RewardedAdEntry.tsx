/**
 * RewardedAdEntry — the opt-in "watch an ad, earn credits" entry point.
 *
 * Renders a button ONLY when the rewarded zone is genuinely usable:
 *   • the master ad flag is on,
 *   • an admin has set a reward amount > 0 (the payout is the admin's call, set
 *     in Admin → Advertisements → Full-screen & Rewards), AND
 *   • a rewarded creative is configured.
 * Otherwise it renders nothing — no dead button, no "reward not configured"
 * dead-ends. The moment an admin sets an amount + creative, the button appears.
 *
 * Clicking opens the full-screen RewardedAd, which measures foreground
 * attention and then asks the server (ad-reward-credit) to verify + credit the
 * wallet. The amount is never trusted from the client.
 */
import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import RewardedAd from "./RewardedAd";
import { fetchAdZones, fetchAdFrequency, fetchAdZonesEnabled } from "@/lib/ads/adZonesV2";

const RewardedAdEntry = ({ onCredited }: { onCredited?: () => void }) => {
  const [eligible, setEligible] = useState(false);
  const [amount, setAmount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [enabled, zones, freq] = await Promise.all([
          fetchAdZonesEnabled(),
          fetchAdZones(),
          fetchAdFrequency(),
        ]);
        if (!alive) return;
        const z = zones["rewarded"];
        const renderable =
          z.mode === "own" &&
          (z.own.image_source === "code" ? z.own.ad_code.trim().length > 0 : z.own.image_url.trim().length > 0);
        setAmount(freq.rewarded_credit_amount);
        setEligible(!!enabled && renderable && freq.rewarded_credit_amount > 0);
      } catch {
        if (alive) setEligible(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!eligible) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full mb-6 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 hover:bg-primary/10 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Gift className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium" style={{ fontFamily: "var(--font-heading)" }}>
              Watch a quick ad, earn {amount} credit{amount === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              A few seconds of attention — added straight to your wallet.
            </p>
          </div>
        </div>
        <span
          className="text-[10px] tracking-[0.2em] uppercase text-primary shrink-0"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Earn
        </span>
      </button>
      <RewardedAd
        open={open}
        onClose={(res) => {
          setOpen(false);
          if (res?.credited) onCredited?.();
        }}
      />
    </>
  );
};

export default RewardedAdEntry;
