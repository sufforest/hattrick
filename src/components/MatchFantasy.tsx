import { useState } from "react";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { MatchFantasyPlayer, MatchFantasyView, TeamRef } from "../../shared/types";
import { Flag, Spinner, cx } from "./bits";
import { usePlayerSheet } from "../lib/playerSheet";

// The per-match fantasy scoreboard: every player who took the pitch (both teams), ranked
// by the fantasy points they earned, with who drafted them. Answers "who are the top
// scorers" and "how many did each player get" at a glance. Polls while the match is live.
export default function MatchFantasy({
  eventId,
  home,
  away,
}: {
  eventId: string;
  home: TeamRef | null;
  away: TeamRef | null;
}) {
  const { data, loading } = usePoll<MatchFantasyView>(() => api.matchFantasy(eventId), 15000, [
    eventId,
  ]);
  const [openId, setOpenId] = useState<string | null>(null);
  const openPlayer = usePlayerSheet();

  if (loading && !data) return <Spinner label="Tallying points…" />;
  const players = data?.players ?? [];
  if (players.length === 0)
    return (
      <p className="font-mono text-xs text-bone-dim">
        No points on the board yet — nobody's earned anything in this match so far.
      </p>
    );

  const topId = players[0]?.playerId; // overall top scorer (list is sorted high→low)
  const groups: { team: TeamRef | null; list: MatchFantasyPlayer[] }[] = [
    { team: home, list: players.filter((p) => p.teamId === home?.id) },
    { team: away, list: players.filter((p) => p.teamId === away?.id) },
  ].filter((g) => g.list.length > 0);

  return (
    <section className="space-y-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-bone-dim">
        Fantasy points earned this match · tap a player for the breakdown
      </p>
      {groups.map(({ team, list }) => {
        const teamTotal = list.reduce((s, p) => s + p.points, 0);
        return (
          <div key={team?.id ?? "?"} className="overflow-hidden rounded-lg border border-edge">
            <div className="flex items-center gap-2 border-b border-edge bg-black/20 px-3 py-2">
              <Flag team={team} size={18} />
              <span className="text-sm font-bold text-bone">{team?.name ?? "Team"}</span>
              <span className="ml-auto font-mono text-[11px] font-bold text-lime">
                {teamTotal} pts
              </span>
            </div>
            <div className="divide-y divide-edge/60">
              {list.map((p) => {
                const open = openId === p.playerId;
                return (
                  <div key={p.playerId}>
                    <button
                      type="button"
                      onMouseEnter={() => setOpenId(p.playerId)}
                      onMouseLeave={() =>
                        setOpenId((cur) => (cur === p.playerId ? null : cur))
                      }
                      onClick={() =>
                        setOpenId((cur) => (cur === p.playerId ? null : p.playerId))
                      }
                      className={cx(
                        "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/20",
                        open && "bg-black/20"
                      )}
                    >
                      <span className="w-9 shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-bone-dim">
                        {p.position}
                      </span>
                      <span className="truncate text-sm text-bone">
                        {p.playerId === topId && <span className="mr-1">👑</span>}
                        {p.playerName}
                      </span>
                      {p.ownerName && (
                        <span
                          className={cx(
                            "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide",
                            p.mine ? "bg-lime/15 text-lime" : "bg-bone/10 text-bone-dim"
                          )}
                        >
                          {p.mine ? "You" : p.ownerName}
                        </span>
                      )}
                      <span
                        className={cx(
                          "ml-auto shrink-0 font-mono text-sm font-bold tabular-nums",
                          p.points > 0 ? "text-lime" : p.points < 0 ? "text-flag" : "text-bone-dim"
                        )}
                      >
                        {p.points >= 0 ? "+" : ""}
                        {p.points}
                      </span>
                    </button>
                    {open && (
                      <div className="bg-black/30 px-3 pb-2.5 pt-1">
                        {p.breakdown.length === 0 ? (
                          <div className="font-mono text-[10px] text-bone-dim">
                            On the pitch — no points-scoring actions yet.
                          </div>
                        ) : (
                          <div className="ml-9 space-y-0.5">
                            {p.breakdown.map((b, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between gap-4 font-mono text-[10px]"
                              >
                                <span className="text-bone/70">{b.label}</span>
                                <span className={b.pts >= 0 ? "text-lime" : "text-flag"}>
                                  {b.pts >= 0 ? "+" : ""}
                                  {b.pts}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => openPlayer(p.playerId)}
                          className="ml-9 mt-1.5 font-mono text-[9px] uppercase tracking-wider text-lime/70 hover:text-lime"
                        >
                          Full history →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
