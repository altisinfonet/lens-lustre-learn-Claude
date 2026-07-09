import { AlertTriangle, Play } from "lucide-react";

interface StartRoundDialogProps {
  roundName: string;
  totalImages: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const StartRoundDialog = ({ roundName, totalImages, onConfirm, onCancel }: StartRoundDialogProps) => {
  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Play className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-medium" style={{ fontFamily: "var(--font-display)" }}>
            Start {roundName} Judging?
          </h2>
          <p className="text-sm text-muted-foreground mt-2" style={{ fontFamily: "var(--font-body)" }}>
            You are about to begin judging <strong className="text-foreground">{totalImages}</strong> images in this round.
          </p>
        </div>

        <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-1.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              <p>Images will be shown one at a time. Your progress is saved automatically — you can stop and resume anytime.</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Play className="h-3.5 w-3.5" />
            Start Judging
          </button>
        </div>
      </div>
    </div>
  );
};

export default StartRoundDialog;
