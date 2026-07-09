/**
 * Format raw EXIF data into clean human-readable strings.
 */

interface ExifField {
  label: string;
  value: string;
}

const EXIF_KEY_MAP: Record<string, string> = {
  iso: "ISO",
  aperture: "Aperture",
  f_stop: "Aperture",
  fstop: "Aperture",
  shutter_speed: "Shutter",
  shutter: "Shutter",
  exposure_time: "Shutter",
  focal_length: "Focal Length",
  lens: "Lens",
  lens_model: "Lens",
  camera: "Camera",
  camera_model: "Camera",
  make: "Make",
  model: "Model",
  white_balance: "White Balance",
  flash: "Flash",
  metering_mode: "Metering",
  date_taken: "Date Taken",
};

function formatValue(key: string, val: unknown): string {
  const s = String(val);
  const k = key.toLowerCase();
  if (k.includes("aperture") || k.includes("f_stop") || k.includes("fstop")) {
    const n = parseFloat(s);
    return isNaN(n) ? s : `f/${n}`;
  }
  if (k.includes("shutter") || k.includes("exposure")) {
    const n = parseFloat(s);
    if (isNaN(n)) return s;
    return n < 1 ? `1/${Math.round(1 / n)}s` : `${n}s`;
  }
  if (k.includes("focal")) {
    const n = parseFloat(s);
    return isNaN(n) ? s : `${n}mm`;
  }
  if (k === "iso") {
    return `ISO ${s}`;
  }
  return s;
}

export function formatExifData(data: Record<string, unknown>): ExifField[] {
  return Object.entries(data).map(([key, val]) => ({
    label: EXIF_KEY_MAP[key.toLowerCase()] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    value: formatValue(key, val),
  }));
}

export function formatExifSummary(data: Record<string, unknown>): string {
  const parts: string[] = [];
  const entries = Object.entries(data);
  const find = (keys: string[]) => entries.find(([k]) => keys.some(kk => k.toLowerCase().includes(kk)));

  const iso = find(["iso"]);
  if (iso) parts.push(`ISO ${iso[1]}`);

  const aperture = find(["aperture", "f_stop", "fstop"]);
  if (aperture) {
    const n = parseFloat(String(aperture[1]));
    parts.push(isNaN(n) ? String(aperture[1]) : `f/${n}`);
  }

  const shutter = find(["shutter", "exposure"]);
  if (shutter) {
    const n = parseFloat(String(shutter[1]));
    if (!isNaN(n)) parts.push(n < 1 ? `1/${Math.round(1 / n)}s` : `${n}s`);
    else parts.push(String(shutter[1]));
  }

  const focal = find(["focal"]);
  if (focal) {
    const n = parseFloat(String(focal[1]));
    parts.push(isNaN(n) ? String(focal[1]) : `${n}mm`);
  }

  return parts.join(" • ");
}
