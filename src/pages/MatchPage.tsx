import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { DraftState, KeyEvent, LineupPlayer, MatchDetail, TeamRef } from "../../shared/types";
import { Flag, LiveDot, ScoreNum, Spinner, cx } from "../components/bits";
import { Updated } from "../components/Updated";
import PredictionSlate from "../components/PredictionSlate";
import MatchFantasy from "../components/MatchFantasy";
import Lineups, { type PlayerOwner } from "../components/Lineups";
import { useSession } from "../lib/session";
import PlayerSheet from "../components/PlayerSheet";
import { statusLabel, kickoff } from "../lib/format";
import { linkifyPlayers } from "../lib/linkify";

type Tab = "picks" | "everyone" | "live" | "points" | "lineups";

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const { data: m, loading, error, lastUpdated } = usePoll<MatchDetail>(
    () => api.match(id!),
    12000,
    [id]
  );
  // Fantasy ownership in the viewer's league (logged-in only), to tag lineup players.
  const { data: draft } = usePoll<DraftState | null>(
    () => (session ? api.draft() : Promise.resolve(null)),
    20000,
    [session?.memberId]
  );
  const [player, setPlayer] = useState<LineupPlayer | null>(null);
  const [showAllFeed, setShowAllFeed] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);

  if (loading && !m) return <Spinner label="Loading match…" />;
  if (error || !m)
    return (
      <div className="space-y-3">
        <p className="font-mono text-xs text-flag">
          Couldn't load this match{error ? `: ${error}` : ""}.
        </p>
        <Link to="/" className="font-mono text-xs uppercase tracking-wider text-lime">
          ← Back to scores
        </Link>
      </div>
    );

  const homeName = m.home?.name ?? m.homePlaceholder ?? "TBD";
  const awayName = m.away?.name ?? m.awayPlaceholder ?? "TBD";
  const live = m.state === "in";
  const goals = m.keyEvents.filter((e) => e.isGoal);
  const homeGoals = goals.filter((g) => g.teamId && g.teamId === m.home?.id);
  const awayGoals = goals.filter((g) => g.teamId && g.teamId === m.away?.id);
  const feed = [...m.commentary].sort((a, b) => b.sequence - a.sequence);
  const players = (m.lineups ?? []).flatMap((t) => t.players);
  const teamsKnown = !!(m.home && m.away);
  const hasLineups = (m.lineups ?? []).some((t) => t.players.length > 0);

  // playerId → who drafted them in this league (with captain flag for your own captain).
  const me = session?.memberId;
  const ownerByPlayer = new Map<string, PlayerOwner>();
  if (draft && me) {
    const capForRound = draft.captainRounds.find((cr) => cr.round === m.round)?.captainPlayerId ?? null;
    for (const pk of draft.picks) {
      const mine = pk.memberId === me;
      ownerByPlayer.set(pk.playerId, {
        name: pk.memberName,
        mine,
        captain: mine && capForRound === pk.playerId,
      });
    }
  }
  const ownerOf = (pid: string): PlayerOwner | null => ownerByPlayer.get(pid) ?? null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "picks", label: "Picks" },
    { key: "everyone", label: "Everyone" },
    { key: "live", label: "Live" },
    ...(session && m.state !== "pre" ? [{ key: "points" as Tab, label: "Points" }] : []),
    ...(hasLineups ? [{ key: "lineups" as Tab, label: "Lineups" }] : []),
  ];
  const active: Tab = tab ?? (live ? "live" : "picks");

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-block font-mono text-[11px] uppercase tracking-wider text-bone-dim hover:text-bone"
      >
        ← Scores
      </Link>

      {/* Persistent scoreboard */}
      <div className="overflow-hidden rounded-lg border border-edge bg-panel">
        <div className="flex items-center justify-center gap-2 border-b border-edge bg-black/20 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.15em]">
          {live && <LiveDot />}
          <span className={cx(live ? "text-flag" : "text-bone-dim")}>
            {m.roundLabel} · {m.state === "pre" ? "Upcoming" : statusLabel(m)}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-3 py-5">
          <TeamSide team={m.home} name={homeName} goals={homeGoals} />
          <div className="pt-2 text-center">
            {m.state === "pre" ? (
              <span className="font-mono text-xs text-bone-dim">{kickoff(m.date)}</span>
            ) : (
              <ScoreNum className="text-5xl">
                <span className={m.winnerId === m.home?.id ? "text-lime" : "text-bone"}>
                  {m.homeScore ?? 0}
                </span>
                <span className="mx-1.5 text-edge-bright">·</span>
                <span className={m.winnerId === m.away?.id ? "text-lime" : "text-bone"}>
                  {m.awayScore ?? 0}
                </span>
              </ScoreNum>
            )}
          </div>
          <TeamSide team={m.away} name={awayName} goals={awayGoals} />
        </div>
        {m.venue && (
          <p className="border-t border-edge py-2 text-center font-mono text-[10px] uppercase tracking-widest text-bone-dim">
            {m.venue}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border border-edge">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "flex-1 py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
              active === t.key ? "bg-lime text-ink" : "text-bone-dim hover:text-bone"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {(active === "picks" || active === "everyone") && (
        <PredictionSlate
          eventId={m.id}
          teamsKnown={teamsKnown}
          view={active === "everyone" ? "everyone" : "mine"}
        />
      )}

      {active === "live" && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wide text-bone-dim">
              Play-by-play
            </span>
            <Updated at={lastUpdated} />
          </div>
          {feed.length === 0 ? (
            <p className="font-mono text-xs text-bone-dim">
              No commentary yet{m.state === "pre" ? " — match hasn't started." : "."}
            </p>
          ) : (
            <>
              <ol>
                {(showAllFeed ? feed : feed.slice(0, 20)).map((c) => (
                  <li
                    key={c.sequence}
                    className={cx(
                      "flex gap-3 border-b border-edge/60 py-2.5 text-sm",
                      c.isGoal && "rounded-sm bg-lime/10 px-2"
                    )}
                  >
                    <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-bone-dim">
                      {c.clock}
                    </span>
                    <span className={cx(c.isGoal ? "font-semibold text-lime" : "text-bone/85")}>
                      {c.isGoal && "⚽ "}
                      {linkifyPlayers(c.text, players, setPlayer)}
                    </span>
                  </li>
                ))}
              </ol>
              {!showAllFeed && feed.length > 20 && (
                <button
                  onClick={() => setShowAllFeed(true)}
                  className="mt-2 w-full rounded-md border border-edge py-2 font-mono text-[11px] uppercase tracking-wider text-bone-dim transition-colors hover:border-edge-bright hover:text-bone"
                >
                  Show all {feed.length} updates
                </button>
              )}
            </>
          )}
        </section>
      )}

      {active === "points" && <MatchFantasy eventId={m.id} home={m.home} away={m.away} />}

      {active === "lineups" && (
        <Lineups lineups={m.lineups} onSelect={setPlayer} ownerOf={ownerOf} />
      )}

      <PlayerSheet player={player} onClose={() => setPlayer(null)} />
    </div>
  );
}

function TeamSide({
  team,
  name,
  goals,
}: {
  team: TeamRef | null;
  name: string;
  goals: KeyEvent[];
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Flag team={team} size={46} />
      <span className="text-xs font-bold uppercase tracking-wide sm:text-sm">{name}</span>
      {goals.length > 0 && (
        <div className="space-y-0.5 pt-0.5">
          {goals.map((g, i) => (
            <p key={i} className="font-mono text-[10px] leading-tight text-bone/65">
              <span className="text-lime">⚽</span> {g.scorer ?? "Goal"}{" "}
              <span className="text-bone-dim">{g.clock}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
