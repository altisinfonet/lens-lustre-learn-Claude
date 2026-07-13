import { useEffect, useRef, useState, useCallback } from "react";
import { Languages } from "lucide-react";

interface LangEntry {
  code: string;
  label: string;
  flag: string;
}

interface LangGroup {
  name: string;
  langs: LangEntry[];
}

const LANGUAGE_GROUPS: LangGroup[] = [
  {
    name: "Indian",
    langs: [
      { code: "hi", label: "हिंदी", flag: "🇮🇳" },
      { code: "bn", label: "বাংলা", flag: "🇮🇳" },
      { code: "ta", label: "தமிழ்", flag: "🇮🇳" },
      { code: "te", label: "తెలుగు", flag: "🇮🇳" },
      { code: "mr", label: "मराठी", flag: "🇮🇳" },
      { code: "gu", label: "ગુજરાતી", flag: "🇮🇳" },
      { code: "kn", label: "ಕನ್ನಡ", flag: "🇮🇳" },
      { code: "ml", label: "മലയാളം", flag: "🇮🇳" },
      { code: "pa", label: "ਪੰਜਾਬੀ", flag: "🇮🇳" },
      { code: "ur", label: "اردو", flag: "🇵🇰" },
      { code: "or", label: "ଓଡ଼ିଆ", flag: "🇮🇳" },
      { code: "as", label: "অসমীয়া", flag: "🇮🇳" },
      { code: "ne", label: "नेपाली", flag: "🇳🇵" },
      { code: "si", label: "සිංහල", flag: "🇱🇰" },
    ],
  },
  {
    name: "European",
    langs: [
      { code: "es", label: "Español", flag: "🇪🇸" },
      { code: "fr", label: "Français", flag: "🇫🇷" },
      { code: "de", label: "Deutsch", flag: "🇩🇪" },
      { code: "pt", label: "Português", flag: "🇧🇷" },
      { code: "it", label: "Italiano", flag: "🇮🇹" },
      { code: "nl", label: "Nederlands", flag: "🇳🇱" },
      { code: "pl", label: "Polski", flag: "🇵🇱" },
      { code: "sv", label: "Svenska", flag: "🇸🇪" },
      { code: "no", label: "Norsk", flag: "🇳🇴" },
      { code: "da", label: "Dansk", flag: "🇩🇰" },
      { code: "fi", label: "Suomi", flag: "🇫🇮" },
      { code: "el", label: "Ελληνικά", flag: "🇬🇷" },
      { code: "cs", label: "Čeština", flag: "🇨🇿" },
      { code: "ro", label: "Română", flag: "🇷🇴" },
      { code: "hu", label: "Magyar", flag: "🇭🇺" },
      { code: "uk", label: "Українська", flag: "🇺🇦" },
    ],
  },
  {
    name: "East Asian",
    langs: [
      { code: "zh-CN", label: "中文", flag: "🇨🇳" },
      { code: "ja", label: "日本語", flag: "🇯🇵" },
      { code: "ko", label: "한국어", flag: "🇰🇷" },
      { code: "th", label: "ไทย", flag: "🇹🇭" },
      { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
      { code: "id", label: "Indonesia", flag: "🇮🇩" },
      { code: "ms", label: "Melayu", flag: "🇲🇾" },
      { code: "fil", label: "Filipino", flag: "🇵🇭" },
      { code: "my", label: "မြန်မာ", flag: "🇲🇲" },
      { code: "km", label: "ខ្មែរ", flag: "🇰🇭" },
    ],
  },
  {
    name: "Middle East & Africa",
    langs: [
      { code: "ar", label: "العربية", flag: "🇸🇦" },
      { code: "fa", label: "فارسی", flag: "🇮🇷" },
      { code: "he", label: "עברית", flag: "🇮🇱" },
      { code: "tr", label: "Türkçe", flag: "🇹🇷" },
      { code: "sw", label: "Kiswahili", flag: "🇰🇪" },
      { code: "am", label: "አማርኛ", flag: "🇪🇹" },
    ],
  },
  {
    name: "Americas",
    langs: [
      { code: "ru", label: "Русский", flag: "🇷🇺" },
    ],
  },
];

const ALL_LANGS: Record<string, { label: string; flag: string }> = {
  en: { label: "English", flag: "🇬🇧" },
};
LANGUAGE_GROUPS.forEach((g) =>
  g.langs.forEach((l) => {
    ALL_LANGS[l.code] = { label: l.label, flag: l.flag };
  })
);

function getStoredLang(): string {
  try {
    return localStorage.getItem("preferred_translate_lang") || "en";
  } catch {
    return "en";
  }
}

function setStoredLang(lang: string) {
  try {
    localStorage.setItem("preferred_translate_lang", lang);
  } catch {}
}

function purgeGoogTransCookies() {
  const hostname = window.location.hostname;
  const parts = hostname.split(".");
  const domains = [hostname, "." + hostname, ""];
  if (parts.length >= 2) {
    const tld = parts.slice(-2).join(".");
    domains.push("." + tld);
    domains.push(tld);
  }
  const paths = ["/", ""];
  domains.forEach((d) => {
    paths.forEach((p) => {
      const domainPart = d ? `; domain=${d}` : "";
      const pathPart = p ? `; path=${p}` : "";
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC${pathPart}${domainPart}`;
      document.cookie = `googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT${pathPart}${domainPart}`;
    });
  });
}

function setGoogTransCookie(lang: string) {
  purgeGoogTransCookies();
  if (lang !== "en") {
    const val = `/en/${lang}`;
    document.cookie = `googtrans=${val}; path=/`;
    document.cookie = `googtrans=${val}; path=/; domain=${window.location.hostname}`;
  }
}

interface Props {
  compact?: boolean;
  className?: string;
}

const LanguagePicker = ({ compact = false, className = "" }: Props) => {
  const [current, setCurrent] = useState(getStoredLang);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (document.getElementById("gt-script")) return;

    let container = document.getElementById("google_translate_element");
    if (!container) {
      container = document.createElement("div");
      container.id = "google_translate_element";
      container.style.display = "none";
      document.body.appendChild(container);
    }

    (window as any).googleTranslateElementInit = () => {
      new (window as any).google.translate.TranslateElement(
        { pageLanguage: "en", autoDisplay: false },
        "google_translate_element"
      );
    };

    const script = document.createElement("script");
    script.id = "gt-script";
    script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    script.async = true;
    document.body.appendChild(script);

    const style = document.createElement("style");
    style.textContent = `
      .skiptranslate, .goog-te-banner-frame, #goog-gt-tt, .goog-te-balloon-frame { display: none !important; }
      body { top: 0 !important; position: static !important; }
      .goog-te-gadget { display: none !important; }
      /* Newer Google Translate menu frame is appended directly to <body> and
         is NOT matched by the .skiptranslate rule above, leaving an empty
         ~96px block below the footer. Hide it — translation still works via
         the hidden .goog-te-combo select, so this only removes dead space. */
      .VIpgJd-ZVi9od-aZ2wEe-wOHMyf { display: none !important; }
    `;
    document.head.appendChild(style);

    const observer = new MutationObserver(() => {
      if (document.body.style.top !== "0px" && document.body.style.top !== "") {
        document.body.style.top = "0px";
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });

    const saved = getStoredLang();
    if (saved !== "en") {
      setGoogTransCookie(saved);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const origRemoveChild = Node.prototype.removeChild;
    const origInsertBefore = Node.prototype.insertBefore;

    Node.prototype.removeChild = function <T extends Node>(child: T): T {
      if (child.parentNode !== this) return child;
      return origRemoveChild.call(this, child) as T;
    };

    Node.prototype.insertBefore = function <T extends Node>(newNode: T, refNode: Node | null): T {
      if (refNode && refNode.parentNode !== this) return newNode;
      return origInsertBefore.call(this, newNode, refNode) as T;
    };

    return () => {
      Node.prototype.removeChild = origRemoveChild;
      Node.prototype.insertBefore = origInsertBefore;
    };
  }, []);

  const selectLanguage = useCallback((lang: string) => {
    setCurrent(lang);
    setStoredLang(lang);
    setOpen(false);

    if (lang === "en") {
      purgeGoogTransCookies();
      const frame = document.querySelector<HTMLIFrameElement>(".goog-te-banner-frame");
      if (frame?.contentDocument) {
        const restoreBtn = frame.contentDocument.querySelector<HTMLButtonElement>("#\\:1\\.restore, button.goog-close-link");
        if (restoreBtn) {
          restoreBtn.click();
          setTimeout(() => window.location.reload(), 300);
          return;
        }
      }
      const select = document.querySelector<HTMLSelectElement>(".goog-te-combo");
      if (select) {
        select.value = "en";
        select.dispatchEvent(new Event("change"));
        setTimeout(() => {
          purgeGoogTransCookies();
          window.location.reload();
        }, 200);
      } else {
        window.location.reload();
      }
      return;
    }

    const select = document.querySelector<HTMLSelectElement>(".goog-te-combo");
    if (select) {
      select.value = lang;
      select.dispatchEvent(new Event("change"));
    } else {
      setGoogTransCookie(lang);
      window.location.reload();
    }
  }, []);

  const currentEntry = ALL_LANGS[current] || ALL_LANGS["en"];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-border hover:border-primary transition-colors text-xs"
        aria-label="Change language"
      >
        <span className="text-sm leading-none">{currentEntry.flag}</span>
        {!compact && (
          <span className="tracking-wide text-[10px] max-w-[60px] truncate hidden sm:inline" style={{ fontFamily: "var(--font-heading)" }}>
            {currentEntry.label}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-[100] bg-card border border-border shadow-lg rounded-md p-3 w-72 max-h-[420px] overflow-y-auto scrollbar-hide">
          {/* English reset */}
          <button
            onClick={() => selectLanguage("en")}
            className={`w-full text-left text-xs px-2 py-1.5 rounded mb-2 transition-colors flex items-center gap-2 ${
              current === "en" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
            }`}
          >
            <span>🇬🇧</span> English (Original)
          </button>

          {LANGUAGE_GROUPS.map((group) => (
            <div key={group.name} className="mb-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold px-2 py-1 border-b border-border mb-1">
                {group.name}
              </div>
              <div className="grid grid-cols-2 gap-0.5">
                {group.langs.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => selectLanguage(lang.code)}
                    className={`text-[11px] px-2 py-1.5 rounded transition-colors text-left truncate flex items-center gap-1.5 ${
                      current === lang.code
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <span className="text-sm leading-none shrink-0">{lang.flag}</span>
                    <span className="truncate">{lang.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguagePicker;