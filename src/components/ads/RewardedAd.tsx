/**
 * RewardedAd — opt-in full-screen static ad → verified attention → wallet credit.
 *
 * Flow: open → server `start` (returns a signed token stamping the start time)
 * → the user views the sponsor for the required seconds (the countdown PAUSES
 * if the app is backgrounded, honouring the "foreground attention" promise) →
 * "Claim" calls server `claim`, which enforces the minimum dwell + daily cap +
 * cooldown before crediting. If no reward is configured (amount 0), it closes
 * quietly.
 *
 * Additive: nothing imports this yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import FullscreenAdShell from "./FullscreenAdShell";
import { type AdZoneCreative, fetchAdZones, fetchAdFrequency, fetchAdZonesEnabled } from "@/lib/ads/adZonesV2";
import { detectDevice, trackZoneEvent } from "@/lib/ads/adTrackV2";

type Phase = "loading" | "watching" | "claimable" | "claiming" | "done" | "error" | "unavailable";

interface RewardedAdProps {
  open: boolean;
  onClose: (result?: { credited: number }) => void;
}

const RewardedAd = ({ open, onClose }: RewardedAdProps) => {
  const [phase, setPhase] = useState<Phase>("loading");
  const [creative, setCreative] = useState<AdZoneCreative | null>(null);
  const [token, setToken] = useState<string>("");
  const [remaining, setRemaining] = useState<number>(0);
  const [amount, setAmount] = useState<number>(0);
  const [message, setMessage] = useState<string>("");
  const startedRef = useRef(false);

  // Initialise on open.
  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const [enabled, zones, freq] = await Promise.all([fetchAdZonesEnabled(), fetchAdZones(), fetchAdFrequency()]);
        const zone = zones["rewarded"];
        const renderable = zone.mode === "own" && (zone.own.image_source === "code" ? zone.own.ad_code.trim() : zone.own.image_url.trim());
        if (!enabled || !renderable || !(freq.rewarded_credit_amount > 0)) { setPhase("unavailable"); onClose(); return; }
        setCreative(zone.own);
        setAmount(freq.rewarded_credit_amount);

        const { data, error } = await supabase.functions.invoke("ad-reward-credit", { body: { action: "start" } });
        if (error || !data?.ok) { setPhase("unavailable"); onClose(); return; }
        setToken(data.token);
        setRemaining(Math.max(1, Math.ceil(data.attention_seconds || 15)));
        setPhase("watching");
        trackZoneEvent("rewarded", "own", "impression", detectDevice(window.innerWidth));
      } catch {
        setPhase("unavailable"); onClose();
      }
    })();
  }, [open, onClose]);

  // Reset when closed so it can run again next time.
  useEffect(() => {
    if (!open) { startedRef.current = false; setPhase("loading"); setToken(""); setCreative(null); }
  }, [open]);

  // Attention countdown — pauses while the app is backgrounded.
  useEffect(() => {
    if (phase !== "watching") return;
    const tick = () => {
      if (document.hidden) return; // pause when not in foreground
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    };
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    if (phase === "watching" && remaining <= 0) setPhase("claimable");
  }, [phase, remaining]);

  const claim = useCallback(async () => {
    setPhase("claiming");
    try {
      const { data, error } = await supabase.functions.invoke("ad-reward-credit", { body: { action: "claim", token } });
      if (error || !data?.ok) {
        setMessage(data?.error === "daily_cap_reached" ? "You've reached today's reward limit." : data?.error === "cooldown" ? "Please wait a bit before the next reward." : "Couldn't add the reward. Please try again later.");
        setPhase("error");
        return;
      }
      setPhase("done");
      setTimeout(() => onClose({ credited: data.credited }), 1600);
    } catch {
      setMessage("Couldn't add the reward. Please try again later.");
      setPhase("error");
    }
  }, [token, onClose]);

  if (!open || phase === "unavailable") return null;

  const footer = (() => {
    switch (phase) {
      case "loading":
        return <div className="flex items-center justify-center gap-2 text-white/70 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Preparing…</div>;
      case "watching":
        return (
          <div className="text-center space-y-2">
            <p className="text-white/80 text-sm">Keep viewing to earn <strong className="text-white">{amount}</strong> credits</p>
            <div className="mx-auto h-10 w-10 rounded-full border-2 border-primary/40 flex items-center justify-center text-white text-sm tabular-nums">{remaining}</div>
            <button onClick={() => onClose()} className="text-white/40 text-[10px] uppercase tracking-[0.15em] hover:text-white/70">Skip (no reward)</button>
          </div>
        );
      case "claimable":
        return (
          <button onClick={claim} className="w-full flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground py-3 text-xs uppercase tracking-[0.18em] font-semibold hover:opacity-90">
            <Gift className="h-4 w-4" /> Claim {amount} credits
          </button>
        );
      case "claiming":
        return <div className="flex items-center justify-center gap-2 text-white/80 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Adding to your wallet…</div>;
      case "done":
        return <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-semibold"><CheckCircle2 className="h-5 w-5" /> {amount} credits added!</div>;
      case "error":
        return (
          <div className="text-center space-y-2">
            <p className="text-white/80 text-sm">{message}</p>
            <button onClick={() => onClose()} className="text-white/50 text-[10px] uppercase tracking-[0.15em] hover:text-white/80">Close</button>
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <FullscreenAdShell
      creative={creative ?? ({ image_source: "upload", image_url: "", ad_code: "", click_url: "", alt_text: "", creative_headline: "", creative_subtext: "", creative_cta: "" } as AdZoneCreative)}
      skippableAfterSeconds={0}
      hideDefaultClose
      label="Rewarded"
      onClose={() => onClose()}
      onClickThrough={() => trackZoneEvent("rewarded", "own", "click", detectDevice(window.innerWidth))}
      footer={footer}
    />
  );
};

export default RewardedAd;
