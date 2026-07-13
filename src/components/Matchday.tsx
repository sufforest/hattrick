import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { DraftState, LiveMatchMine, Match } from "../../shared/types";
import { CHIPS } from "../../shared/types";
import { useSession } from "../lib/session";
import { Flag, LiveDot, ScoreNum, SectionLabel, cx } from "./bits";
import { isToday, statusLabel } from "../lib/format";

// The one match to spotlight, in priority order — and within each tier, prefer one where
// the manager actually has players, so the panel feels personal rather than generic:
//   1. a live match (your stake on the pitch right now)
//   2. one of today's upcoming matches
//   3. the next upcoming match whenever it is
function focusMatch(matches: Match[], myTeams: Set<string>): Match | null {
  const byDate = (a: Match, b: Match) => a.date.localeCompare(b.date);
  const ready = matches.filter((m) => m.home && m.away);
  const mine = (m: Match) => myTeams.has(m.home!.id) || myTeams.has(m.away!.id);
  const live = ready.filter((m) => m.state === "in").sort(byDate);
  if (live.length) return live.find(mine) ?? live[0];
  const today = ready.filter((m) => m.state === "pre" && isToday(m.date)).sort(byDate);
  if (today.length) return today.find(mine) ?? today[0];
  const upcoming = ready.filter((m) => m.state === "pre").sort(byDate);
  return upcoming.find(mine) ?? upcoming[0] ?? null;
}

// Personalized matchday panel: the next/live match + *your* stake in it (your players,
// your captain, your chip) + the one thing to do now (predict / set captain). This is the
// daily hook — open the app, see what's happening and what's yours on the line.
export default function Matchday({ matches }: { matches: Match[] }) {
  const { session } = useSession();
  const { data: draft } = usePoll<DraftState>(api.draft, 20000);
  const me = session?.memberId;
  const myPicks = (draft?.picks ?? []).filter((p) => p.memberId === me);
  const myTeams = useMemo(() => new Set(myPicks.map((p) => p.teamId)), [myPicks]);
  const m = useMemo(() => focusMatch(matches, myTeams), [matches, myTeams]);
  // Your squad's live points in this match, polled while it's on (or just finished).
  const { data: livePts } = usePoll<LiveMatchMine | null>(
    () => (m && m.state !== "pre" ? api.liveMatchMine(m.id) : Promise.resolve(null)),
    15000,
    [m?.id, m?.state]
  );
  // Which player's point breakdown is expanded (hover on desktop, tap on phones).
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!m) return null;

  const live = m.state === "in";
  const homeName = m.home?.name ?? "TBD";
  const awayName = m.away?.name ?? "TBD";
  const showScore = m.state !== "pre";

  // My drafted players whose national team plays in this match, captain marked.
  const inMatch = myPicks.filter((p) => p.teamId === m.home?.id || p.teamId === m.away?.id);
  const capId = draft?.captainRounds.find((cr) => cr.round === m.round)?.captainPlayerId ?? null;
  const capRound = draft?.captainRounds.find((cr) => cr.round === m.round) ?? null;
  const activeChip = draft?.chips.find((ch) => ch.round === m.round) ?? null;
  const chipMeta = activeChip ? CHIPS.find((c) => c.id === activeChip.chip) : null;
  const drafted = (draft?.picks ?? []).some((p) => p.memberId === me);
  const needCaptain = drafted && capRound && !capRound.locked && !capId && inMatch.length > 0;
  const liveBy = new Map((livePts?.players ?? []).map((p) => [p.playerId, p]));
  const showLivePts = m.state !== "pre" && (livePts?.players?.length ?? 0) > 0;
  const activeLive = activeId ? liveBy.get(activeId) : undefined;

  return (
    <section className="animate-rise">
      <SectionLabel
        right={
          live ? (
            <span className="flex items-center gap-1.5 text-flag">
              <LiveDot /> LIVE
            </span>
          ) : (
            statusLabel(m)
          )
        }
      >
        Your matchday
      </SectionLabel>

      <div
        className={cx(
          "overflow-hidden rounded-xl border bg-panel",
          live ? "border-flag/50" : "border-edge"
        )}
      >
        {/* The match */}
        <Link
          to={`/match/${m.id}`}
          className="block bg-black/20 px-4 py-3 transition-colors hover:bg-black/30"
        >
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-bone-dim">
            <span>{m.roundLabel}</span>
            <span className={cx(live && "text-flag")}>{statusLabel(m)}</span>
          </div>
          <div className="flex items-center gap-3">
            <Flag team={m.home} size={28} />
            <span className="truncate text-base font-semibold text-bone">{homeName}</span>
            {showScore && (
              <ScoreNum className="ml-auto text-3xl text-lime">{m.homeScore ?? 0}</ScoreNum>
            )}
            {!showScore && <span className="ml-auto font-mono text-xs text-bone-dim">vs</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <Flag team={m.away} size={28} />
            <span className="truncate text-base font-semibold text-bone">{awayName}</span>
            {showScore && (
              <ScoreNum className="ml-auto text-3xl text-bone/70">{m.awayScore ?? 0}</ScoreNum>
            )}
          </div>
        </Link>

        {/* Your stake */}
        {drafted && (
          <div className="border-t border-edge px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-bone-dim">
                {inMatch.length > 0 ? "Your players in this match" : "Your squad"}
              </span>
              {showLivePts && (
                <span className="shrink-0 font-mono text-[10px] font-bold text-lime">
                  {livePts!.total >= 0 ? "+" : ""}
                  {livePts!.total} pts {m.state === "in" ? "so far" : "this game"}
                </span>
              )}
            </div>
            {inMatch.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {inMatch.map((p) => {
                    const isCap = p.playerId === capId;
                    const lp = showLivePts ? liveBy.get(p.playerId) : undefined;
                    const isOpen = activeId === p.playerId;
                    return (
                      <button
                        key={p.playerId}
                        type="button"
                        onMouseEnter={() => lp && setActiveId(p.playerId)}
                        onMouseLeave={() => setActiveId((cur) => (cur === p.playerId ? null : cur))}
                        onClick={() =>
                          lp && setActiveId((cur) => (cur === p.playerId ? null : p.playerId))
                        }
                        className={cx(
                          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                          isCap ? "border-gold/50 bg-gold/10 text-gold" : "border-edge bg-black/20 text-bone/85",
                          lp && "cursor-help",
                          isOpen && "ring-1 ring-lime/60"
                        )}
                      >
                        {isCap && <span className="font-bold">©</span>}
                        <Flag team={{ id: p.teamId, name: p.country, abbr: p.country }} size={12} />
                        <span className="font-mono text-[8px] text-bone-dim">{p.position}</span>
                        <span className="truncate">{p.playerName}</span>
                        {lp && (
                          <span
                            className={cx(
                              "font-mono text-[10px] font-bold",
                              isCap ? "text-gold" : "text-lime"
                            )}
                          >
                            {lp.points >= 0 ? "+" : ""}
                            {lp.points}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {activeLive && (
                  <div className="mt-2 rounded-md border border-edge bg-black/30 px-2.5 py-2">
                    <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-bone-dim">
                      {activeLive.playerName} — where the points come from
                    </div>
                    {activeLive.breakdown.length === 0 ? (
                      <div className="font-mono text-[10px] text-bone-dim">
                        Hasn't taken the pitch yet — no points.
                      </div>
                    ) : (
                      <>
                        {activeLive.breakdown.map((b, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-4 font-mono text-[10px] leading-relaxed"
                          >
                            <span className="text-bone/70">{b.label}</span>
                            <span className={b.pts >= 0 ? "text-lime" : "text-flag"}>
                              {b.pts >= 0 ? "+" : ""}
                              {b.pts}
                            </span>
                          </div>
                        ))}
                        <div className="mt-1 flex items-center justify-between gap-4 border-t border-edge pt-1 font-mono text-[10px] font-bold">
                          <span className="text-bone">total</span>
                          <span className="text-lime">
                            {activeLive.points >= 0 ? "+" : ""}
                            {activeLive.points}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-bone-dim">
                None of your squad plays here — no points on the line this game.
              </p>
            )}
            {chipMeta && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-lime/40 bg-lime/10 px-2 py-1 text-[11px] text-lime">
                <span>{chipMeta.emoji}</span>
                <b>{chipMeta.name} active</b>
                <span className="text-lime/70">this round</span>
              </div>
            )}
          </div>
        )}

        {/* What to do now */}
        <div className="flex flex-wrap items-center gap-2 border-t border-edge px-4 py-3">
          {m.state === "pre" && m.home && m.away && (
            <Link
              to={`/match/${m.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-lime px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink transition-colors hover:bg-lime-deep"
            >
              🎯 Make your picks
            </Link>
          )}
          {needCaptain && (
            <Link
              to="/draft"
              className="inline-flex items-center gap-1.5 rounded-md border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-gold transition-colors hover:bg-gold/20"
            >
              © Set your captain
            </Link>
          )}
          {live && (
            <Link
              to={`/match/${m.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-flag/50 bg-flag/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-flag transition-colors hover:bg-flag/20"
            >
              ● Watch it live
            </Link>
          )}
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-bone-dim/70">
            {needCaptain
              ? "captain scores 2×"
              : m.state === "pre"
                ? "lock in before kickoff"
                : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
