import { useEffect } from "react";
import { isNativeApp } from "@/lib/video/playback";
import { setPhotoSaveGuard } from "@/lib/native/photoSaveGuard";

/**
 * Inside the installed app, long-press "save image" is off on every photo
 * (src/lib/native/photoSaveGuard.ts). POLICY, NOT A SWITCH (photo plan Unit B;
 * Owner-confirmed requirement 3, 3 Nov 2026: "App: no save at all"): U3 tied it
 * to `photo_set_v2`, so with the switch off or unknown the app could still
 * save a photo. On the web nothing is installed (right-click on the full-screen
 * photo gives the credited copy — ZoomableImage). Renders nothing.
 */
const AppPhotoSaveGuard = () => {
  const on = isNativeApp();
  useEffect(() => {
    setPhotoSaveGuard(on);
    return () => setPhotoSaveGuard(false);
  }, [on]);
  return null;
};

export default AppPhotoSaveGuard;
