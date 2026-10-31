import { Skeleton } from "@/components/ui/skeleton";

/**
 * Facebook-style profile skeleton loader.
 * Shows cover, avatar, name, tabs, and content placeholders.
 */
const ProfileSkeleton = () => (
  <main className="min-h-screen bg-background text-foreground">
    {/* Cover skeleton */}
    <section className="relative">
      <Skeleton className="h-48 sm:h-64 md:h-72 lg:h-80 w-full rounded-none" />
      {/* Avatar skeleton */}
      <div className="max-w-5xl mx-auto px-4 relative">
        <div className="absolute -bottom-16 left-4 sm:left-8">
          <Skeleton className="w-28 h-28 sm:w-36 sm:h-36 rounded-full border-4 border-background" />
        </div>
      </div>
    </section>

    {/* Name + actions skeleton */}
    <div className="max-w-5xl mx-auto px-4 pt-20 sm:pt-24 pb-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-2 mt-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-sm" />
          <Skeleton className="h-9 w-24 rounded-sm" />
        </div>
      </div>
    </div>

    {/* Tabs skeleton */}
    <div className="max-w-5xl mx-auto px-4 border-b border-border">
      <div className="flex gap-6 py-3">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-12" />
      </div>
    </div>

    {/* Content skeleton - 3 column grid */}
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-5">
        {/* Left sidebar */}
        <div className="hidden lg:block space-y-5">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="border border-border rounded-sm p-4 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-24 w-full rounded-sm" />
            <Skeleton className="h-24 w-full rounded-sm" />
          </div>
        </div>
        {/* Center */}
        <div className="space-y-4">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-10 flex-1 rounded-full" />
            </div>
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-border rounded-sm p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-48 w-full rounded-sm" />
            </div>
          ))}
        </div>
        {/* Right sidebar */}
        <div className="hidden lg:block space-y-5">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  </main>
);

export default ProfileSkeleton;
