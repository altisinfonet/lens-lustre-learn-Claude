/**
 * Photo plan U4 · the member's "Save mobile data" switch (Owner decision 6).
 * Shown only with switch `photo_set_v2` on (OFF ⇒ renders nothing, the
 * settings page is exactly today's). Kept on this device — see lib/dataSaver.
 */
import { useSyncExternalStore } from "react";
import { Signal } from "lucide-react";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { getSaveMobileData, setSaveMobileData, subscribeDataSaver } from "@/lib/dataSaver";

const labelCls = "block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2";

export function SaveMobileDataSetting() {
  const on = usePhotoSetV2();
  const checked = useSyncExternalStore(subscribeDataSaver, getSaveMobileData, getSaveMobileData);
  if (!on) return null;
  return (
    <div>
      <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
        <Signal className="inline h-3 w-3 mr-1.5" aria-hidden="true" />Mobile data
      </span>
      <label className="flex items-start gap-3 py-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => setSaveMobileData(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-foreground">Save mobile data</span>
          <span className="block text-xs text-muted-foreground">
            On mobile data, photos load one size smaller and videos start in low quality. On Wi-Fi nothing changes.
            On a phone that cannot tell Wi-Fi from mobile data, it always saves. This setting is kept on this device.
          </span>
        </span>
      </label>
    </div>
  );
}
