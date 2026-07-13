import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { PlayerCard, Position } from "../../shared/types";
import { Flag, Spinner, cx } from "./bits";

const POS_TEXT: Record<Position, string> = {
  GK: "text-gold",
  DEF: "text-bone-dim",
  MID: "text-lime",
  FWD: "text-flag",
};

// Tap-through player detail: full knockout history match-by-match, who owned them each
// game, any boost, and — the point — what the current owner has actually banked vs the
// player's total production (the two diverge when a player was picked up after a big game).
export default function PlayerCardSheet({
  playerId,
  onClose,
}: {
  playerId: string;
  onClose: () => void;
}) {
  const { data, loading } = usePoll<PlayerCard>(() => api.player(playerId), 20000, [playerId]);

  // Portaled to <body> so it can't be trapped/mis-centered by a transformed ancestor
  // (e.g. the page's animate-rise) — `fixed` then pins to the viewport, not the tall page.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="my-auto max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-edge bg-panel p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && !data ? (
          <Spinner label="Loading player…" />
        ) : data ? (
          <>
            <div className="mb-4 flex items-start gap-3">
              <Flag team={data.team} size={32} />
              <div className="min-w-0">
                <p className="truncate font-display text-2xl uppercase leading-none tracking-tight">
                  {data.playerName}
                </p>
                <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wide text-bone-dim">
                  <span className={POS_TEXT[data.position]}>{data.position}</span> · {data.team.name}
                </p>
              </div>
              <div className="ml-auto shrink-0 text-right">
                <div className="font-display text-3xl leading-none tabular-nums text-lime">
                  {data.total}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-bone-dim">
                  total pts
                </div>
              </div>
            </div>

            {data.ownerName && (
              <div className="mb-4 flex items-center justify-between rounded-md border border-edge bg-black/20 px-3 py-2 text-xs">
                <span className="text-bone-dim">
                  Owned by{" "}
                  <b className={data.mine ? "text-lime" : "text-bone"}>
                    {data.mine ? "You" : data.ownerName}
                  </b>
                </span>
                <span
                  className={cx(
                    "font-mono font-bold",
                    data.banked < data.total ? "text-gold" : "text-lime"
                  )}
                >
                  banked {data.banked}
                  {data.banked < data.total && (
                    <span className="font-normal text-bone-dim/60"> of {data.total}</span>
                  )}
                </span>
              </div>
            )}
            {data.ownerName && data.banked < data.total && (
              <p className="-mt-3 mb-4 font-mono text-[10px] text-bone-dim/70">
                ⚠ {data.total - data.banked} pts scored before {data.mine ? "you" : data.ownerName} picked him up — not credited.
              </p>
            )}

            <div className="space-y-1.5">
              {data.matches.length === 0 ? (
                <p className="font-mono text-xs text-bone-dim">No knockout matches yet.</p>
              ) : (
                data.matches.map((m) => (
                  <div key={m.matchId} className="rounded-md border border-edge/60 bg-black/20 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-7 shrink-0 font-mono text-[9px] font-bold uppercase text-bone-dim">
                        {m.round}
                      </span>
                      {m.opponent && <Flag team={m.opponent} size={12} />}
                      <span className="text-bone/80">vs {m.opponent?.abbr ?? "?"}</span>
                      {m.teamScore != null && (
                        <span
                          className={cx(
                            "font-mono",
                            m.won ? "text-lime" : m.won === false ? "text-flag" : "text-bone-dim"
                          )}
                        >
                          {m.teamScore}-{m.oppScore}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 font-mono font-bold text-lime">
                        +{m.raw}
                        {m.boost > 1 && <span className="text-gold"> ×{m.boost}</span>}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[9px] text-bone-dim">
                      {m.breakdown.map((b, i) => (
                        <span key={i}>
                          {b.label} {b.pts >= 0 ? "+" : ""}
                          {b.pts}
                        </span>
                      ))}
                      {m.ownerName ? (
                        <span className="ml-auto text-lime/70">→ {m.ownerName} +{m.attributed}</span>
                      ) : (
                        <span className="ml-auto text-bone-dim/40">free agent · +0</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="font-mono text-xs text-flag">Couldn't load this player.</p>
        )}
      </div>
    </div>,
    document.body
  );
}
