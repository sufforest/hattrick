import { useState } from "react";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { PlayerStanding, Position } from "../../shared/types";
import { Flag, SectionLabel, Spinner, cx } from "./bits";
import { usePlayerSheet } from "../lib/playerSheet";

const POS_TEXT: Record<Position, string> = {
  GK: "text-gold",
  DEF: "text-bone-dim",
  MID: "text-lime",
  FWD: "text-flag",
};

// Global top scorers: every player ranked by total production, with their current owner and
// what that owner actually banked. When banked < total the player was picked up after a big
// game (⚠); undrafted high scorers are transfer targets. Tap a row for the full history.
export default function PlayerBoard() {
  const { data, loading } = usePoll<PlayerStanding[]>(api.playerStandings, 30000);
  const openPlayer = usePlayerSheet();
  const [showAll, setShowAll] = useState(false);
  if (loading && !data) return <Spinner label="Loading top scorers…" />;
  const rows = data ?? [];
  const shown = showAll ? rows : rows.slice(0, 20);

  return (
    <section>
      <SectionLabel right="tap for match history">Top scorers</SectionLabel>
      {rows.length === 0 ? (
        <p className="font-mono text-xs text-bone-dim">No points scored yet.</p>
      ) : (
        <ul className="divide-y divide-edge/60 overflow-hidden rounded-lg border border-edge bg-panel">
          {shown.map((p, i) => {
            const shortchanged = !!p.ownerName && p.banked < p.total;
            return (
              <li key={p.playerId}>
                <button
                  type="button"
                  onClick={() => openPlayer(p.playerId)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/20"
                >
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-bone-dim/60">
                    {i + 1}
                  </span>
                  <Flag team={p.team} size={16} />
                  <span className={cx("shrink-0 font-mono text-[9px] font-bold", POS_TEXT[p.position])}>
                    {p.position}
                  </span>
                  <span className="truncate text-sm text-bone">{p.playerName}</span>
                  {p.ownerName ? (
                    <span
                      className={cx(
                        "ml-auto shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide",
                        p.mine ? "bg-lime/15 text-lime" : "bg-bone/10 text-bone-dim"
                      )}
                    >
                      {p.mine ? "You" : p.ownerName}
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 rounded-sm bg-gold/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-gold">
                      free
                    </span>
                  )}
                  <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums">
                    <span className="font-bold text-lime">{p.total}</span>
                    {shortchanged && (
                      <span className="ml-1 text-[9px] text-gold" title={`owner banked only ${p.banked}`}>
                        ⚠{p.banked}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!showAll && rows.length > 20 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 w-full rounded-md border border-edge py-2 font-mono text-[11px] uppercase tracking-wider text-bone-dim transition-colors hover:border-edge-bright hover:text-bone"
        >
          Show all {rows.length}
        </button>
      )}
    </section>
  );
}
