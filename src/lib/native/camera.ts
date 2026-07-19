import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

// Native camera / photo picker. Returns a File you can hand straight to your
// existing upload pipeline (uploadImage / compressImage). On web, Capacitor's
// Camera falls back to a file input, so this also works in the browser.

export async function pickPhoto(source: 'camera' | 'gallery' | 'prompt' = 'prompt'): Promise<File | null> {
  const src =
    source === 'camera' ? CameraSource.Camera :
    source === 'gallery' ? CameraSource.Photos :
    CameraSource.Prompt;

  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: src,
    promptLabelHeader: 'Add a photo',
    promptLabelPhoto: 'Choose from gallery',
    promptLabelPicture: 'Take a photo',
  });

  const path = photo.webPath;
  if (!path) return null;

  const res = await fetch(path);
  const blob = await res.blob();
  const ext = photo.format || 'jpeg';
  return new File([blob], `photo-${Date.now()}.${ext}`, { type: blob.type || `image/${ext}` });
}

/** Convenience: whether we're running where the native camera is available. */
export const hasNativeCamera = () => Capacitor.isNativePlatform();
