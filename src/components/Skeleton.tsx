import { cx } from "./bits";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-edge/60", className)} />;
}

export function MatchCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge bg-black/20 px-3 py-1.5">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-16" />
      </div>
      <div className="space-y-2.5 px-3 py-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded-sm" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded-sm" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

export function MatchCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <MatchCardSkeleton key={i} />
      ))}
    </div>
  );
}
