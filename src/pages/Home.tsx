import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { Match, RoundCode } from "../../shared/types";
import MatchCard from "../components/MatchCard";
import Matchday from "../components/Matchday";
import StatusStrip from "../components/StatusStrip";
import { LiveDot, SectionLabel, Kicker, cx } from "../components/bits";
import { Collapsible } from "../components/Collapsible";
import { MatchCardSkeletonGrid } from "../components/Skeleton";
import { Updated } from "../components/Updated";
import { ROUND_ORDER, ROUND_LABEL, shortTime, isToday } from "../lib/format";
import { useSession } from "../lib/session";

function tickerText(m: Match): string {
  const a = m.home?.abbr ?? "TBD";
  const b = m.away?.abbr ?? "TBD";
  if (m.state === "pre") return `${a} – ${b}`;
  return `${a} ${m.homeScore ?? 0}–${m.awayScore ?? 0} ${b}`;
}

function Ticker({ matches }: { matches: Match[] }) {
  const items = useMemo(() => {
    const live = matches.filter((m) => m.state === "in");
    const pre = matches.filter((m) => m.state === "pre").slice(0, 10);
    const post = matches.filter((m) => m.state === "post").slice(-6);
    return [...live, ...pre, ...post];
  }, [matches]);
  if (items.length === 0) return null;
  const loop = [...items, ...items];

  return (
    <div className="relative overflow-hidden border-y border-edge bg-black/30 py-2">
      <div className="flex w-max animate-ticker gap-6 whitespace-nowrap">
        {loop.map((m, i) => (
          <span key={i} className="flex items-center gap-2 font-mono text-[11px] tracking-wide">
            {m.state === "in" && <LiveDot />}
            <span className={cx(m.state === "in" ? "text-flag" : "text-bone-dim")}>
              {tickerText(m)}
            </span>
            <span className="text-bone-dim/40">
              {m.state === "pre" ? shortTime(m.date) : m.state === "post" ? "FT" : ""}
            </span>
            <span className="text-edge-bright">•</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { data: matches, loading, error, lastUpdated } = usePoll<Match[]>(api.matches, 15000);
  const { session } = useSession();

  const { live, today, byRound } = useMemo(() => {
    const all = matches ?? [];
    const live = all.filter((m) => m.state === "in");
    const today = all
      .filter((m) => m.state !== "in" && isToday(m.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    const byRound = new Map<RoundCode, Match[]>();
    for (const m of all) {
      const arr = byRound.get(m.round) ?? [];
      arr.push(m);
      byRound.set(m.round, arr);
    }
    for (const arr of byRound.values())
      arr.sort((a, b) => a.date.localeCompare(b.date) || a.matchNumber - b.matchNumber);
    return { live, today, byRound };
  }, [matches]);

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <header className="animate-rise">
        <div className="flex items-end justify-between gap-3">
          <div>
            <Kicker>{todayLabel}</Kicker>
            <h1 className="font-display text-4xl leading-[0.9] tracking-tight sm:text-5xl">
              MATCH<span className="text-lime">DAY</span>
            </h1>
          </div>
          <Updated at={lastUpdated} className="mb-1.5" />
        </div>
      </header>

      {matches && <Ticker matches={matches} />}

      {session && <StatusStrip />}

      {session && matches && <Matchday matches={matches} />}

      {!session && (
        <div className="space-y-2">
          <Link
            to="/start"
            className="group flex items-center gap-3 rounded-lg border border-lime/30 bg-lime/[0.06] px-4 py-3 transition-colors hover:bg-lime/10"
          >
            <span className="font-display text-2xl text-lime">▶</span>
            <span className="text-sm">
              <span className="font-bold text-lime">Start a league.</span>{" "}
              <span className="text-bone/80">
                Draft a fantasy squad, predict the bracket, and call every match with your friends.
              </span>
            </span>
            <span className="ml-auto font-mono text-xs text-bone-dim transition-transform group-hover:translate-x-1">
              →
            </span>
          </Link>
          <Link
            to="/how"
            className="block text-center font-mono text-[11px] uppercase tracking-wider text-bone-dim hover:text-bone"
          >
            How it works →
          </Link>
        </div>
      )}

      {loading && !matches && (
        <section>
          <SectionLabel>Loading…</SectionLabel>
          <MatchCardSkeletonGrid />
        </section>
      )}
      {error && <p className="font-mono text-xs text-flag">Couldn't load scores: {error}</p>}

      {live.length > 0 && (
        <section>
          <SectionLabel right={<span className="text-flag">● LIVE</span>}>Live now</SectionLabel>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((m) => (
              <MatchCard key={m.id} m={m} predict={!!session} />
            ))}
          </div>
        </section>
      )}

      {today.length > 0 && (
        <section>
          <SectionLabel right={`${today.length} match${today.length > 1 ? "es" : ""}`}>
            Today
          </SectionLabel>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {today.map((m) => (
              <MatchCard key={m.id} m={m} predict={!!session} />
            ))}
          </div>
        </section>
      )}

      {ROUND_ORDER.map((round) => {
        const arr = byRound.get(round);
        if (!arr || arr.length === 0) return null;
        const allDone = arr.every((m) => m.state === "post");
        return (
          <Collapsible
            key={round}
            title={ROUND_LABEL[round]}
            right={`${arr.length} match${arr.length > 1 ? "es" : ""}`}
            defaultOpen={!allDone}
          >
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {arr.map((m) => (
                <MatchCard key={m.id} m={m} predict={!!session} />
              ))}
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
