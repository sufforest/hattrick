import type { ReactNode } from "react";
import type { TeamRef } from "../../shared/types";

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

export function Flag({ team, size = 24 }: { team: TeamRef | null; size?: number }) {
  if (team?.logo) {
    return (
      <img
        src={team.logo}
        alt={team.name}
        width={size}
        height={size}
        loading="lazy"
        className="inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-black/30"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[2px] bg-edge font-mono text-[9px] font-bold text-bone-dim ring-1 ring-black/30"
      style={{ width: size, height: size }}
    >
      {(team?.abbr ?? "?").slice(0, 3)}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 font-mono text-xs uppercase tracking-widest text-bone-dim">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-edge border-t-lime" />
      {label ?? "Loading…"}
    </div>
  );
}

export function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flag opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-flag" />
    </span>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="h-4 w-1.5 shrink-0 bg-lime" />
      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-bone">
        {children}
      </span>
      <span className="h-px flex-1 bg-edge" />
      {right && <span className="shrink-0 text-xs text-bone-dim">{right}</span>}
    </div>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-bone-dim",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "lime" | "gold" | "flag";
}) {
  const tones = {
    neutral: "border-edge text-bone-dim",
    lime: "border-lime/40 bg-lime/10 text-lime",
    gold: "border-gold/40 bg-gold/10 text-gold",
    flag: "border-flag/40 bg-flag/10 text-flag",
  }[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
        tones
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-lg border border-edge bg-panel", className)}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "gold";
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    primary: "bg-lime text-ink hover:bg-lime-deep",
    gold: "bg-gold text-ink hover:bg-gold/90",
    ghost: "border border-edge-bright bg-transparent text-bone hover:bg-panel-2",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-md px-4 py-2.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        styles,
        className
      )}
    >
      {children}
    </button>
  );
}

export function ScoreNum({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("font-display tabular-nums leading-none", className)}>{children}</span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-md border border-flag/40 bg-flag/10 px-3 py-2 text-sm text-flag">
      {children}
    </div>
  );
}
