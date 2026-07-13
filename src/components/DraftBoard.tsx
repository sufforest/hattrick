import { Fragment } from "react";
import type { BoardPick, DraftState, Position, TeamRef } from "../../shared/types";
import { Flag, SectionLabel, cx } from "./bits";
import { usePlayerSheet } from "../lib/playerSheet";

const POS_TEXT: Record<Position, string> = {
  GK: "text-gold",
  DEF: "text-bone-dim",
  MID: "text-lime",
  FWD: "text-flag",
};

// The snake draft board: managers across the top (seat order), one row per round,
// each manager's roster filling in round by round. Pick order serpentines — odd
// rounds left→right, even rounds right→left — which the pick numbers make visible.
export default function DraftBoard({
  data,
  me,
  teamById,
}: {
  data: DraftState;
  me?: string;
  teamById: Map<string, TeamRef>;
}) {
  const openPlayer = usePlayerSheet();
  const seats = data.order;
  const n = seats.length;
  const rounds = data.squad.GK + data.squad.DEF + data.squad.MID + data.squad.FWD;
  if (n === 0) return null;

  // Render the ORIGINAL draft (boardPicks) — it keeps transferred-out slots in place
  // (flagged), so a transfer never blanks a cell like the active-squad list would.
  const board = data.boardPicks ?? [];
  const seatCol = new Map(seats.map((m, i) => [m.id, i]));
  const grid: (BoardPick | undefined)[][] = Array.from({ length: rounds }, () =>
    Array<BoardPick | undefined>(n).fill(undefined)
  );
  for (const p of board) {
    const r = Math.ceil(p.pickNumber / n) - 1;
    const c = seatCol.get(p.memberId);
    if (c != null && r >= 0 && r < rounds) grid[r][c] = p;
  }
  const lastPick = board.reduce((m, p) => Math.max(m, p.pickNumber), 0);
  const clockRound = Math.ceil(data.currentPickNumber / n) - 1;
  const clockCol = data.onTheClockMemberId ? seatCol.get(data.onTheClockMemberId) : undefined;

  // Overall pick number for any cell, accounting for the serpentine direction.
  const pickNo = (r: number, c: number) => r * n + (r % 2 === 0 ? c + 1 : n - c);

  const teamFor = (p: BoardPick): TeamRef =>
    teamById.get(p.teamId) ?? { id: p.teamId, name: p.country, abbr: p.country.slice(0, 3).toUpperCase() };
  const traded = board.filter((p) => p.dropped).length;
  const dead = board.filter((p) => p.eliminated && !p.dropped).length;
  const rightLabel =
    dead > 0 || traded > 0
      ? [dead > 0 ? `🪦 ${dead} out` : null, traded > 0 ? `${traded} traded` : null]
          .filter(Boolean)
          .join(" · ")
      : `${board.length}/${data.totalPicks} picks`;

  return (
    <section>
      <SectionLabel right={rightLabel}>Draft board</SectionLabel>
      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <div
          className="grid min-w-max text-[11px]"
          style={{ gridTemplateColumns: `1.9rem repeat(${n}, minmax(78px, 1fr))` }}
        >
          {/* header row */}
          <div className="sticky left-0 z-10 bg-panel" />
          {seats.map((m) => (
            <div
              key={m.id}
              className={cx(
                "truncate border-b border-edge px-1.5 py-1.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider",
                m.id === me ? "text-lime" : "text-bone-dim",
                m.id === data.onTheClockMemberId && data.status === "active" && "bg-lime/10 text-lime"
              )}
              title={m.name}
            >
              {m.name}
            </div>
          ))}

          {/* round rows */}
          {Array.from({ length: rounds }).map((_, r) => (
            <Fragment key={r}>
              <div className="sticky left-0 z-10 flex items-center justify-center bg-panel font-mono text-[9px] font-bold text-bone-dim/50">
                R{r + 1}
              </div>
              {seats.map((m, c) => {
                const p = grid[r][c];
                const onClock =
                  data.status === "active" && r === clockRound && c === clockCol && !p;
                return (
                  <div
                    key={m.id}
                    onClick={() => p && openPlayer(p.playerId)}
                    className={cx(
                      "min-h-[2.4rem] border-b border-l border-edge/60 px-1.5 py-1",
                      m.id === me && "bg-lime/[0.06]",
                      p?.dropped && "bg-flag/[0.05]",
                      p?.eliminated && !p?.dropped && "bg-black/25",
                      p && "cursor-pointer hover:bg-black/25",
                      p && p.pickNumber === lastPick && !p.dropped && "ring-1 ring-inset ring-gold/60",
                      onClock && "animate-pulse bg-lime/10 ring-1 ring-inset ring-lime/60"
                    )}
                  >
                    {p ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <Flag team={teamFor(p)} size={12} />
                          <span className={cx("font-mono text-[8px] font-bold", POS_TEXT[p.position])}>
                            {p.position}
                          </span>
                          <span className="ml-auto font-mono text-[8px] text-bone-dim/40">{p.pickNumber}</span>
                        </div>
                        <span
                          className={cx(
                            "flex items-center gap-0.5 truncate leading-tight",
                            p.dropped || p.eliminated ? "text-bone-dim/45 line-through" : "text-bone/85"
                          )}
                        >
                          {p.eliminated && !p.dropped && (
                            <span className="shrink-0 no-underline" title="team eliminated">🪦</span>
                          )}
                          <span className="truncate">{p.playerName}</span>
                        </span>
                        {p.dropped && p.replacedByName && (
                          <span
                            className="flex items-center gap-0.5 truncate font-mono text-[8px] text-lime/75"
                            title={`traded for ${p.replacedByName}`}
                          >
                            <span className="text-bone-dim/50">→</span>
                            {p.replacedByName}
                          </span>
                        )}
                      </div>
                    ) : onClock ? (
                      <span className="font-mono text-[8px] font-bold uppercase tracking-wide text-lime">
                        on the clock
                      </span>
                    ) : (
                      <span className="font-mono text-[8px] text-bone-dim/25">{pickNo(r, c)}</span>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
