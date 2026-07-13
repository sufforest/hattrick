import type { LineupPlayer } from "../../shared/types";

export default function PlayerSheet({
  player,
  onClose,
}: {
  player: LineupPlayer | null;
  onClose: () => void;
}) {
  if (!player) return null;
  const stats = player.stats.filter((s) => s.value && s.value !== "0" && s.value !== "0.0");

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-xl border border-edge bg-panel p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-2xl uppercase leading-none tracking-tight">
              {player.name}
            </p>
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wide text-bone-dim">
              {player.jersey && `#${player.jersey} · `}
              {player.position ?? ""}
              {player.starter ? " · starter" : " · bench"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-wider text-bone-dim hover:text-bone"
          >
            ✕
          </button>
        </div>

        {stats.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-1">
            {stats.map((s, i) => (
              <div key={i} className="flex items-center justify-between border-b border-edge/50 py-1.5">
                <span className="text-xs text-bone/70">{s.label}</span>
                <span className="font-display text-base tabular-nums text-bone">{s.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs text-bone-dim">No match stats yet — check back after kickoff.</p>
        )}

        <p className="mt-4 font-mono text-[9px] uppercase tracking-wide text-bone-dim/60">
          In-match stats · via ESPN
        </p>
      </div>
    </div>
  );
}
