import { useState } from "react";
import ImageCropModal from "@/components/admin/ImageCropModal";

// Public dev-only route for reproducing crop-modal bugs. No auth required.
export default function CropTest() {
  const [src, setSrc] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      setSrc(r.result as string);
      setOpen(true);
    };
    r.readAsDataURL(f);
  };

  return (
    <div style={{ padding: 24, color: "#fff", fontFamily: "monospace" }}>
      <h1 style={{ marginBottom: 12 }}>Crop Modal Test</h1>
      <input type="file" accept="image/*" onChange={onFile} />
      {src && !open && (
        <button
          onClick={() => setOpen(true)}
          style={{ marginLeft: 12, padding: "6px 12px", background: "#3B82F6", color: "#fff" }}
        >
          Re-open modal
        </button>
      )}
      {result && (
        <div style={{ marginTop: 24 }}>
          <div>RESULT (final posted crop):</div>
          <img src={result} style={{ maxWidth: 400, border: "2px solid lime", marginTop: 8 }} />
        </div>
      )}
      {open && src && (
        <ImageCropModal
          imageSrc={src}
          forcedAspect={4 / 5}
          queuePosition={1}
          queueTotal={2}
          onSkip={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onCropComplete={(file) => {
            const url = URL.createObjectURL(file);
            setResult(url);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
