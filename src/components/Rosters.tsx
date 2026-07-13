import type { DraftState, Position, TeamRef } from "../../shared/types";
import { Flag, SectionLabel, cx } from "./bits";
import { usePlayerSheet } from "../lib/playerSheet";

const POS_ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
const POS_TEXT: Record<Position, string> = {
  GK: "text-gold",
  DEF: "text-bone-dim",
  MID: "text-lime",
  FWD: "text-flag",
};

// Every manager's squad in a clean, readable list — the plain-language answer to
// "who picked who", without the points framing of the standings or the density of the
// draft-board grid.
export default function Rosters({
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
  if (seats.length === 0) return null;

  return (
    <section>
      <SectionLabel right={`${seats.length} squads`}>Rosters</SectionLabel>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {seats.map((mgr) => {
          const squad = data.picks
            .filter((p) => p.memberId === mgr.id)
            .sort((a, b) => POS_ORDER[a.position] - POS_ORDER[b.position]);
          const mine = mgr.id === me;
          return (
            <div
              key={mgr.id}
              className={cx(
                "overflow-hidden rounded-lg border bg-panel",
                mine ? "border-lime/40" : "border-edge"
              )}
            >
              <div className="flex items-center justify-between border-b border-edge bg-black/20 px-3 py-2">
                <span className={cx("text-sm font-bold", mine ? "text-lime" : "text-bone")}>
                  {mgr.name}
                  {mine && <span className="ml-1.5 font-mono text-[9px] uppercase text-lime/70">you</span>}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-bone-dim">
                  {squad.length} player{squad.length === 1 ? "" : "s"}
                </span>
              </div>
              {squad.length === 0 ? (
                <p className="px-3 py-3 font-mono text-[11px] uppercase tracking-wide text-bone-dim/60">
                  No picks yet
                </p>
              ) : (
                <ul className="divide-y divide-edge/50">
                  {squad.map((p) => (
                    <li
                      key={p.playerId}
                      onClick={() => openPlayer(p.playerId)}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-black/20"
                    >
                      <span className={cx("w-7 shrink-0 font-mono text-[9px] font-bold", POS_TEXT[p.position])}>
                        {p.position}
                      </span>
                      <Flag
                        team={teamById.get(p.teamId) ?? { id: p.teamId, name: p.country, abbr: p.country }}
                        size={14}
                      />
                      <span className="truncate text-bone/90">{p.playerName}</span>
                      <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-bone-dim">
                        {p.country}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
