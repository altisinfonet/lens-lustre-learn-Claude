/**
 * Photo plan U4 · is "Save mobile data" saving right now, for ME?
 * Only with switch `photo_set_v2` on (OFF ⇒ always false, nothing changes),
 * the member's setting on, and a link the device does not name as Wi-Fi.
 * Re-renders when the setting or the link changes.
 */
import { useSyncExternalStore } from "react";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { getLinkKind, getSaveMobileData, savingDataNow, subscribeDataSaver, type LinkKind } from "@/lib/dataSaver";

const snap = (): string => `${getSaveMobileData() ? 1 : 0}:${getLinkKind()}`;

export interface DataSaverState {
  /** One size down now. */
  saving: boolean;
  /** The link the device names (wifi / mobile / unknown). */
  kind: LinkKind;
  /** The member's setting on this device. */
  setting: boolean;
}

export function useDataSaver(): DataSaverState {
  const v2 = usePhotoSetV2();
  const s = useSyncExternalStore(subscribeDataSaver, snap, snap);
  const setting = s.startsWith("1");
  const kind = s.slice(2) as LinkKind;
  return { saving: v2 && savingDataNow(setting, kind), kind, setting };
}
