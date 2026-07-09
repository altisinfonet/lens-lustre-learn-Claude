// Phase 3B — Scheduled Posts page (owner-only view).
import { Helmet } from "react-helmet-async";
import ScheduledPostsList from "@/components/post/ScheduledPostsList";
import { useAuth } from "@/hooks/core/useAuth";
import { Navigate } from "react-router-dom";

export default function ScheduledPostsPage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      <Helmet>
        <title>Scheduled Posts — 50mm Retina World</title>
        <meta name="description" content="Manage posts you've scheduled to publish later." />
      </Helmet>
      <div className="max-w-3xl mx-auto p-4 md:p-6">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
            Scheduled Posts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Posts you've queued to publish later. Cancel any time before they publish.
          </p>
        </header>
        <ScheduledPostsList />
      </div>
    </>
  );
}
