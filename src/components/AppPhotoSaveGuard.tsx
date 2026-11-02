import { useEffect } from "react";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { isNativeApp } from "@/lib/video/playback";
import { setPhotoSaveGuard } from "@/lib/native/photoSaveGuard";

/**
 * Photo plan U3: inside the installed app, with `photo_set_v2` on, long-press
 * "save image" is off on every photo (src/lib/native/photoSaveGuard.ts).
 * Web, or switch off/unknown → nothing is installed. Renders nothing.
 */
const AppPhotoSaveGuard = () => {
  const v2 = usePhotoSetV2();
  const on = v2 && isNativeApp();
  useEffect(() => {
    setPhotoSaveGuard(on);
    return () => setPhotoSaveGuard(false);
  }, [on]);
  return null;
};

export default AppPhotoSaveGuard;
