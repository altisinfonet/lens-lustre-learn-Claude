import { useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook that provides a playNotificationSound() callback.
 * Respects user's notification_sound_enabled preference.
 * Uses dashboard-init cache first, no independent fetch.
 */
export function useNotificationSound() {
  const { user } = useAuth();
  const soundEnabled = useRef(true);
  const audioCtx = useRef<AudioContext | null>(null);
  const qc = useQueryClient();

  // Read from dashboard-init cache — no independent fetch
  useEffect(() => {
    if (!user) return;
    const dashData = qc.getQueryData(["dashboard-init", user.id]) as any;
    if (dashData?.user_meta && typeof dashData.user_meta.notification_sound_enabled === "boolean") {
      soundEnabled.current = dashData.user_meta.notification_sound_enabled;
    }
  }, [user, qc]);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabled.current) return;

    try {
      if (!audioCtx.current) {
        audioCtx.current = new AudioContext();
      }
      const ctx = audioCtx.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.value = 523;
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = 659;
      gain2.gain.setValueAtTime(0.25, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.4);

      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = "sine";
      osc3.frequency.value = 784;
      gain3.gain.setValueAtTime(0.2, now + 0.2);
      gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.2);
      osc3.stop(now + 0.5);
    } catch {
      // Silent fail
    }
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    soundEnabled.current = enabled;
  }, []);

  return { playNotificationSound, setSoundEnabled, soundEnabled };
}
