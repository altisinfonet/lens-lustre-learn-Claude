import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

interface SimpleCaptchaProps {
  onVerified: (verified: boolean) => void;
}

const generateChallenge = () => {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const ops = ["+", "-"] as const;
  const op = ops[Math.floor(Math.random() * ops.length)];
  const answer = op === "+" ? a + b : a - b;
  return { question: `${a} ${op} ${b}`, answer };
};

const SimpleCaptcha = ({ onVerified }: SimpleCaptchaProps) => {
  const [challenge, setChallenge] = useState(generateChallenge);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "correct" | "wrong">("idle");

  const refresh = useCallback(() => {
    setChallenge(generateChallenge());
    setInput("");
    setStatus("idle");
    onVerified(false);
  }, [onVerified]);

  useEffect(() => {
    if (input === "") { setStatus("idle"); return; }
    const num = parseInt(input, 10);
    if (isNaN(num)) { setStatus("wrong"); onVerified(false); return; }
    if (num === challenge.answer) {
      setStatus("correct");
      onVerified(true);
    } else {
      setStatus("wrong");
      onVerified(false);
    }
  }, [input, challenge.answer, onVerified]);

  return (
    <div className="border border-border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Security Check
        </span>
        <button type="button" onClick={refresh} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="New challenge">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-foreground whitespace-nowrap" style={{ fontFamily: "var(--font-body)" }}>
          What is <strong className="text-primary">{challenge.question}</strong> ?
        </span>
        {status === "correct" && (
          <span className="text-[10px] tracking-[0.15em] uppercase text-green-500 whitespace-nowrap" style={{ fontFamily: "var(--font-heading)" }}>✓ Verified</span>
        )}
        <input
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Answer"
          className={`flex-1 min-w-0 py-2 px-3 bg-transparent border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none transition-colors ${
            status === "correct" ? "border-green-500" : status === "wrong" && input ? "border-destructive" : "border-border focus:border-primary"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
        />
      </div>
      
    </div>
  );
};

export default SimpleCaptcha;
