import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, X, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { formatUSDFixed } from "@/lib/currencyFormat";

interface GiftAnnouncement {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

const confettiColors = [
  "hsl(var(--primary))",
  "#FFD700",
  "#FF6B6B",
  "#4ECDC4",
  "#A855F7",
  "#F97316",
];

const ConfettiPiece = ({ index }: { index: number }) => {
  const left = Math.random() * 100;
  const delay = Math.random() * 0.5;
  const duration = 2 + Math.random() * 2;
  const color = confettiColors[index % confettiColors.length];
  const size = 6 + Math.random() * 8;
  const rotate = Math.random() * 360;

  return (
    <motion.div
      className="absolute top-0 pointer-events-none"
      style={{
        left: `${left}%`,
        width: size,
        height: size * 0.6,
        backgroundColor: color,
        borderRadius: "2px",
      }}
      initial={{ y: -20, opacity: 1, rotate }}
      animate={{
        y: "100vh",
        opacity: [1, 1, 0],
        rotate: rotate + 720,
        x: [0, (Math.random() - 0.5) * 200],
      }}
      transition={{
        duration,
        delay,
        ease: "easeIn",
      }}
    />
  );
};

const GiftCelebrationModal = () => {
  const { user } = useAuth();
  const [gifts, setGifts] = useState<GiftAnnouncement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [show, setShow] = useState(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markAsRead = (giftList: GiftAnnouncement[]) => {
    if (giftList.length > 0) {
      const ids = giftList.map(g => g.id);
      supabase
        .from("gift_announcements")
        .update({ is_read: true })
        .in("id", ids)
        .then(() => {});
    }
  };

  useEffect(() => {
    if (!user) return;

    const fetchUnread = async () => {
      const { data } = await supabase
        .from("gift_announcements")
        .select("id, amount, reason, created_at")
        .eq("user_id", user.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        setGifts(data);
        setShow(true);

        // Auto-dismiss after 6 seconds
        autoDismissRef.current = setTimeout(() => {
          setShow(false);
          markAsRead(data);
        }, 6000);
      }
    };

    const timer = setTimeout(fetchUnread, 1500);
    return () => {
      clearTimeout(timer);
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
    };
  }, [user]);

  const dismiss = () => {
    if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
    setShow(false);
    markAsRead(gifts);
  };

  const totalAmount = gifts.reduce((sum, g) => sum + Number(g.amount), 0);

  if (!show || gifts.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={dismiss}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />

        {/* Confetti */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 50 }).map((_, i) => (
            <ConfettiPiece key={i} index={i} />
          ))}
        </div>

        {/* Modal */}
        <motion.div
          className="relative z-10 w-full max-w-md mx-4 border border-primary/30 bg-background p-8 md:p-10 text-center"
          initial={{ scale: 0.8, y: 40, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: "spring", damping: 20, stiffness: 200, delay: 0.2 }}
        >
          {/* Close */}
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Gift icon with glow */}
          <motion.div
            className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6"
            animate={{
              boxShadow: [
                "0 0 20px hsl(var(--primary) / 0.2)",
                "0 0 40px hsl(var(--primary) / 0.4)",
                "0 0 20px hsl(var(--primary) / 0.2)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Gift className="h-10 w-10 text-primary" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                🎉 You've received a gift!
              </span>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>

            <h2
              className="text-3xl md:text-4xl font-light tracking-tight mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <span className="text-primary">{formatUSDFixed(totalAmount)}</span>
            </h2>

            <p className="text-sm text-muted-foreground mb-6" style={{ fontFamily: "var(--font-body)" }}>
              has been credited to your wallet
            </p>

            {/* List gifts */}
            <div className="space-y-3 mb-8 text-left">
              {gifts.map((g, i) => (
                <motion.div
                  key={g.id}
                  className="border border-border p-4 flex items-center justify-between"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                >
                  <div>
                    <p className="text-xs text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                      {g.reason}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
                      {new Date(g.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <span className="text-sm text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                    +{formatUSDFixed(Number(g.amount))}
                  </span>
                </motion.div>
              ))}
            </div>

            <button
              onClick={dismiss}
              className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Gift className="h-3.5 w-3.5" /> Awesome, Thanks!
            </button>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default GiftCelebrationModal;
