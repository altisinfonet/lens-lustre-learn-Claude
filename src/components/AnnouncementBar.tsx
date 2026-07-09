 import { useState, useMemo } from "react";
 import { useSiteSetting } from "@/hooks/core/useSiteSetting";
import { parseUTC } from "@/utils/time";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

interface Announcement {
  id: string;
  message: string;
  link_url: string;
  link_text: string;
  bg_color: string;
  text_color: string;
  is_active: boolean;
  is_dismissible: boolean;
  priority: number;
  starts_at: string;
  expires_at: string;
}

const AnnouncementBar = () => {
   const { data: cachedAnnouncements } = useSiteSetting<unknown[]>("announcements");

  const announcements = useMemo(() => {
    if (!cachedAnnouncements || !Array.isArray(cachedAnnouncements)) return [];
    const now = Date.now();
    return (cachedAnnouncements as unknown as Announcement[])
      .filter((a) => {
        if (!a.is_active) return false;
        if (a.starts_at && parseUTC(a.starts_at).getTime() > now) return false;
        if (a.expires_at && parseUTC(a.expires_at).getTime() < now) return false;
        return true;
      })
      .sort((a, b) => a.priority - b.priority);
  }, [cachedAnnouncements]);

  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("dismissed-announcements");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    localStorage.setItem("dismissed-announcements", JSON.stringify([...next]));
  };

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="w-full z-50 overflow-hidden">
      <AnimatePresence>
        {visible.map((a) => (
          <motion.div
            key={a.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className="relative flex items-center justify-center gap-3 px-4 py-2 text-sm text-center"
              style={{ backgroundColor: a.bg_color, color: a.text_color }}
            >
              <span>{a.message}</span>
              {a.link_url && (
                a.link_url.startsWith("/") ? (
                  <Link to={a.link_url} className="underline font-medium whitespace-nowrap" style={{ color: a.text_color }}>
                    {a.link_text || "Learn More"}
                  </Link>
                ) : (
                  <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="underline font-medium whitespace-nowrap" style={{ color: a.text_color }}>
                    {a.link_text || "Learn More"}
                  </a>
                )
              )}
              {a.is_dismissible && (
                <button
                  onClick={() => dismiss(a.id)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" style={{ color: a.text_color }} />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default AnnouncementBar;
