import { useState, type ReactNode } from "react";

// A section whose body folds away — same editorial header as SectionLabel, but
// clickable with a chevron. Keeps long pages (the match page especially) scannable.
export function Collapsible({
  title,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
        className="group mb-3 flex w-full items-center gap-3"
        aria-expanded={open}
      >
        <span className="h-4 w-1.5 shrink-0 bg-lime" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-bone">
          {title}
        </span>
        <span className="h-px flex-1 bg-edge" />
        {right && <span className="shrink-0 text-xs text-bone-dim">{right}</span>}
        <span className="shrink-0 font-mono text-xs text-bone-dim transition-colors group-hover:text-bone">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && children}
    </section>
  );
}
