import { useEffect, useState } from "react";
import { cx } from "./bits";

// A small live-ticking "updated Ns ago" indicator so the polling is visible.
export function Updated({ at, className }: { at: number | null; className?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  const label =
    s < 3 ? "updated just now" : s < 60 ? `updated ${s}s ago` : `updated ${Math.floor(s / 60)}m ago`;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-bone-dim",
        className
      )}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
      {label}
    </span>
  );
}
