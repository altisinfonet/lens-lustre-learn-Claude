// Branded 404 — photography-themed, with useful ways forward.
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Aperture, Home, Trophy, Compass, Newspaper, ArrowLeft } from "lucide-react";
import { useT } from "@/i18n/I18nContext";

const NotFound = () => {
  const t = useT();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg text-center">
        {/* aperture motif */}
        <div className="relative mx-auto mb-8 h-28 w-28">
          <Aperture
            className="h-28 w-28 animate-[spin_14s_linear_infinite] text-primary/25"
            strokeWidth={1}
          />
          <span className="absolute inset-0 flex items-center justify-center text-3xl font-black tracking-tight">
            404
          </span>
        </div>

        <h1 className="text-2xl font-bold sm:text-3xl">{t("nf.frameEmpty")}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("nf.pageGone")}
          {location.pathname && (
            <>
              {" "}
              <span className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {location.pathname}
              </span>{" "}
              didn't develop.
            </>
          )}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Home className="h-4 w-4" /> {t("nf.backToHome")}
          </Link>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" /> {t("nf.goBack")}
          </button>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-3 text-sm">
          <Link
            to="/competitions"
            className="group rounded-lg border p-4 transition hover:border-primary/40 hover:bg-muted/50"
          >
            <Trophy className="mx-auto mb-2 h-5 w-5 text-muted-foreground transition group-hover:text-primary" />
            Competitions
          </Link>
          <Link
            to="/discover"
            className="group rounded-lg border p-4 transition hover:border-primary/40 hover:bg-muted/50"
          >
            <Compass className="mx-auto mb-2 h-5 w-5 text-muted-foreground transition group-hover:text-primary" />
            Discover
          </Link>
          <Link
            to="/journal"
            className="group rounded-lg border p-4 transition hover:border-primary/40 hover:bg-muted/50"
          >
            <Newspaper className="mx-auto mb-2 h-5 w-5 text-muted-foreground transition group-hover:text-primary" />
            Journal
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
