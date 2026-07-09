const PostCardSkeleton = () => (
  <div className="border border-border rounded-xl md:rounded-none p-4 space-y-3 animate-pulse">
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-muted" />
      <div className="space-y-1.5 flex-1">
        <div className="h-3.5 w-32 bg-muted rounded" />
        <div className="h-2.5 w-20 bg-muted rounded" />
      </div>
    </div>
    <div className="h-4 w-full bg-muted rounded" />
    <div className="h-4 w-2/3 bg-muted rounded" />
    <div className="aspect-[4/5] w-full bg-muted rounded-sm" />
    <div className="flex justify-between items-center">
      <div className="flex gap-2">
        <div className="h-4 w-10 bg-muted rounded" />
        <div className="h-4 w-10 bg-muted rounded" />
      </div>
      <div className="h-3 w-16 bg-muted rounded" />
    </div>
  </div>
);

export default PostCardSkeleton;
