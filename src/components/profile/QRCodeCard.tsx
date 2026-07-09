import { useState, useRef, useEffect } from "react";
import { QrCode, Download } from "lucide-react";
import QRCode from "qrcode";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface Props {
  profileUrl: string;
  displayName: string;
  avatarUrl?: string | null;
}

const QRCodeCard = ({ profileUrl, displayName, avatarUrl }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(profileUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [profileUrl]);

  const handleDownload = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 520;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 400, 520);

    // Header gradient
    const grad = ctx.createLinearGradient(0, 0, 400, 80);
    grad.addColorStop(0, "#1a1a2e");
    grad.addColorStop(1, "#16213e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 80);

    // Brand name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("50mm Retina World", 200, 50);

    // Display name
    ctx.fillStyle = "#333333";
    ctx.font = "24px sans-serif";
    ctx.fillText(displayName, 200, 130);

    // QR Code
    if (qrDataUrl) {
      const qrImg = new Image();
      qrImg.crossOrigin = "anonymous";
      await new Promise<void>((resolve) => {
        qrImg.onload = () => {
          ctx.drawImage(qrImg, 100, 160, 200, 200);
          resolve();
        };
        qrImg.src = qrDataUrl;
      });
    }

    // URL text
    ctx.fillStyle = "#666666";
    ctx.font = "12px sans-serif";
    ctx.fillText(profileUrl, 200, 400);

    // Scan instruction
    ctx.fillStyle = "#999999";
    ctx.font = "11px sans-serif";
    ctx.fillText("Scan to view profile", 200, 430);

    // Footer line
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(50, 450, 300, 1);

    ctx.fillStyle = "#aaaaaa";
    ctx.font = "10px sans-serif";
    ctx.fillText("www.50mmretina.com", 200, 480);

    // Download
    const link = document.createElement("a");
    link.download = `${displayName.replace(/\s+/g, "-").toLowerCase()}-qr-card.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="border border-border p-5 space-y-4">
      <h3 className="text-[11px] tracking-[0.2em] uppercase text-foreground flex items-center gap-2" style={headingFont}>
        <QrCode className="h-3.5 w-3.5 text-primary" />
        QR Profile Card
      </h3>
      <div className="flex flex-col items-center gap-3">
        {qrDataUrl && (
          <img loading="lazy" decoding="async" src={qrDataUrl} alt="QR Code" className="h-32 w-32 rounded-sm border border-border" />
        )}
        <p className="text-[10px] text-muted-foreground text-center" style={bodyFont}>
          Scan to visit your profile
        </p>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border hover:border-primary hover:text-primary transition-all"
          style={headingFont}
        >
          <Download className="h-3 w-3" />
          Download Card
        </button>
      </div>
    </div>
  );
};

export default QRCodeCard;
