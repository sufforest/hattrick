import { useState } from "react";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { BracketStanding, DraftStanding, H2HStanding, League, PredictionStanding } from "../../shared/types";
import { useSession } from "../lib/session";
import { ScoreNum, Spinner, cx } from "../components/bits";
import { Updated } from "../components/Updated";
import { shareCard } from "../lib/shareCard";
import PlayerBoard from "../components/PlayerBoard";
import { usePlayerSheet } from "../lib/playerSheet";

export default function StandingsPage() {
  const [tab, setTab] = useState<"draft" | "players" | "bracket" | "predictions">("draft");
  return (
    <div className="animate-rise space-y-5">
      <h1 className="font-display text-3xl uppercase leading-none tracking-tight sm:text-4xl">
        The Table
      </h1>
      <div className="flex border border-edge">
        {(["draft", "players", "bracket", "predictions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "flex-1 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
              tab === t ? "bg-lime text-ink" : "text-bone-dim hover:text-bone"
            )}
          >
            {t === "draft" ? "Draft" : t === "players" ? "Players" : t === "bracket" ? "Bracket" : "Predict"}
          </button>
        ))}
      </div>
      {tab === "draft" ? (
        <DraftBoard />
      ) : tab === "players" ? (
        <PlayerBoard />
      ) : tab === "bracket" ? (
        <BracketBoard />
      ) : (
        <PredictionsBoard />
      )}
    </div>
  );
}

function PredictionsBoard() {
  const { session } = useSession();
  const { data, loading, lastUpdated } = usePoll<PredictionStanding[]>(api.predictionStandings, 20000);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Spinner />;
  if (!data || data.every((s) => s.matches === 0))
    return (
      <p className="font-mono text-xs text-bone-dim">
        No prediction scores yet — open a match and make your picks before kickoff.
      </p>
    );
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Updated at={lastUpdated} />
      </div>
      {data.map((s, i) => {
        const isOpen = open === s.memberId;
        const canOpen = s.breakdown.length > 0;
        return (
          <div
            key={s.memberId}
            className={cx(
              "overflow-hidden rounded-lg border bg-panel",
              i === 0 ? "border-gold/40" : "border-edge"
            )}
          >
            <button
              disabled={!canOpen}
              onClick={() => setOpen(isOpen ? null : s.memberId)}
              className="flex w-full items-center gap-3 p-3 text-left"
            >
              <Rank i={i} />
              <div className="min-w-0">
                <p className={cx("font-bold", s.memberId === session?.memberId && "text-lime")}>
                  {s.memberName}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-bone-dim">
                  {s.correct} correct · {s.matches} match{s.matches !== 1 ? "es" : ""}
                </p>
              </div>
              <ScoreNum className="ml-auto text-3xl text-bone">{s.points}</ScoreNum>
              {canOpen && (
                <span className="ml-1 shrink-0 font-mono text-[10px] text-lime">{isOpen ? "▾" : "▸"}</span>
              )}
            </button>
            {isOpen && (
              <ul className="divide-y divide-edge/50 border-t border-edge">
                {s.breakdown.map((b) => (
                  <li key={b.eventId} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    <span className="font-mono text-[11px] font-bold text-bone/85">{b.label}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wide text-bone-dim">
                      {b.correct}/{b.props} right
                    </span>
                    <span className="ml-auto font-mono tabular-nums text-lime">+{b.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="px-1 font-mono text-[10px] uppercase leading-relaxed tracking-wide text-bone-dim">
        per match before kickoff — winner (upset-weighted) · exact score 50 · goals O/U 15 · BTTS 15 ·
        extra-time/pens 20. Your winner and exact score must agree.
      </p>
    </div>
  );
}

function Rank({ i }: { i: number }) {
  const medal = ["🥇", "🥈", "🥉"][i];
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center font-display text-lg tabular-nums text-bone-dim">
      {medal ?? i + 1}
    </span>
  );
}

function DraftBoard() {
  const { session } = useSession();
  const openPlayer = usePlayerSheet();
  const { data, loading, lastUpdated } = usePoll<DraftStanding[]>(api.draftStandings, 20000);
  const { data: h2h } = usePoll<H2HStanding[]>(api.h2hStandings, 20000);
  const { data: league } = usePoll<League>(api.league, 60000);
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"total" | "h2h">("total");
  const [sharing, setSharing] = useState(false);
  if (loading && !data) return <Spinner />;
  if (!data || data.every((s) => s.players.length === 0))
    return <p className="font-mono text-xs text-bone-dim">No squads drafted yet.</p>;

  const me = session?.memberId;
  const mine = data.find((s) => s.memberId === me);
  async function shareMine() {
    if (!mine) return;
    setSharing(true);
    try {
      const squad = mine.players.filter((p) => !p.dropped);
      await shareCard({
        league: league?.name ?? "Hattrick",
        manager: mine.memberName,
        rank: data!.findIndex((s) => s.memberId === me) + 1,
        totalManagers: data!.length,
        points: mine.points,
        alive: squad.filter((p) => !p.eliminated).length,
        squadSize: squad.length,
        top: [...squad]
          .sort((a, b) => b.points - a.points)
          .slice(0, 5)
          .map((p) => ({ pos: p.position, name: p.playerName, country: p.country, points: p.points })),
      });
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex border border-edge">
          {(["total", "h2h"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMode(t)}
              className={cx(
                "px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                mode === t ? "bg-gold text-ink" : "text-bone-dim hover:text-bone"
              )}
            >
              {t === "total" ? "Total" : "Head-to-head"}
            </button>
          ))}
        </div>
        {mine && (
          <button
            onClick={shareMine}
            disabled={sharing}
            className="ml-auto rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-lime transition-colors hover:bg-lime/20 disabled:opacity-50"
          >
            {sharing ? "…" : "📤 Share card"}
          </button>
        )}
        <Updated at={lastUpdated} className={mine ? "" : "ml-auto"} />
      </div>
      {mode === "h2h" ? (
        <H2HList rows={h2h} me={session?.memberId} />
      ) : (
        <>
      {data.map((s, i) => (
        <div
          key={s.memberId}
          className={cx(
            "overflow-hidden rounded-lg border bg-panel",
            i === 0 ? "border-gold/40" : "border-edge"
          )}
        >
          <button
            onClick={() => setOpen(open === s.memberId ? null : s.memberId)}
            className="flex w-full items-center gap-3 p-3 text-left"
          >
            <Rank i={i} />
            <span className={cx("font-bold", s.memberId === session?.memberId && "text-lime")}>
              {s.memberName}
            </span>
            {(() => {
              const squad = s.players.filter((p) => !p.dropped);
              const alive = squad.filter((p) => !p.eliminated).length;
              return (
                <span
                  className={cx(
                    "ml-auto font-mono text-[10px] uppercase tracking-wider",
                    squad.length === 0
                      ? "text-bone-dim"
                      : alive === 0
                        ? "text-flag"
                        : alive === squad.length
                          ? "text-lime"
                          : "text-gold"
                  )}
                >
                  {alive}/{squad.length} alive
                </span>
              );
            })()}
            <ScoreNum className="w-14 text-right text-3xl text-bone">{s.points}</ScoreNum>
          </button>
          {open === s.memberId && (
            <ul className="border-t border-edge px-3 py-2">
              {s.players.map((p) => (
                <li key={p.playerId} className="py-1">
                  <div className="flex items-center gap-2 text-sm">
                  <span className="grid h-4 w-7 shrink-0 place-items-center rounded-sm bg-black/40 font-mono text-[8px] font-bold text-bone-dim">
                    {p.position}
                  </span>
                  <button
                    type="button"
                    onClick={() => openPlayer(p.playerId)}
                    className={cx(
                      "hover:underline",
                      p.dropped
                        ? "italic text-bone-dim/40"
                        : p.eliminated
                          ? "text-bone-dim/40 line-through"
                          : "text-bone/85"
                    )}
                  >
                    {p.playerName}
                  </button>
                  {p.dropped ? (
                    <span className="font-mono text-[8px] uppercase tracking-wider text-bone-dim/50">dropped</span>
                  ) : p.eliminated ? (
                    <span className="font-mono text-[8px] uppercase tracking-wider text-flag/70">out</span>
                  ) : null}
                  <span className="truncate font-mono text-[10px] text-bone-dim">
                    {p.country}
                    {p.goals > 0 ? ` · ${p.goals}⚽` : ""}
                    {p.assists > 0 ? ` · ${p.assists}🅰` : ""}
                  </span>
                  {(p.captainBonus > 0 || p.chipBonus > 0) && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[9px]">
                      {p.captainBonus > 0 && <span className="text-gold">© +{p.captainBonus}</span>}
                      {p.chipBonus > 0 && <span className="text-lime">⚡ +{p.chipBonus}</span>}
                    </span>
                  )}
                  <span
                    className={cx(
                      "font-mono text-sm tabular-nums text-bone",
                      p.captainBonus > 0 || p.chipBonus > 0 ? "ml-1.5 w-8 text-right" : "ml-auto"
                    )}
                  >
                    {p.points}
                  </span>
                  </div>
                  {p.breakdown.length > 0 && (
                    <div className="mt-0.5 pl-9 font-mono text-[10px] leading-snug text-bone-dim/70">
                      {p.breakdown.map((b, i) => (
                        <span key={i}>
                          {i > 0 && " · "}
                          {b.label}{" "}
                          <span className={b.pts >= 0 ? "text-bone-dim" : "text-flag/70"}>
                            {b.pts >= 0 ? "+" : ""}
                            {b.pts}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="rounded-lg border border-edge bg-panel/40 p-3">
        <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-bone-dim">
          How points are scored
        </div>
        <ul className="grid gap-x-5 gap-y-1.5 text-[12px] leading-snug text-bone/70 sm:grid-cols-2">
          <li>
            <b className="text-bone">Goal</b> — FWD +4 · MID +5 · DEF/GK +6
          </li>
          <li>
            <b className="text-bone">Assist</b> — +3
          </li>
          <li>
            <b className="text-bone">Clean sheet</b> — DEF/GK +4 · MID +1{" "}
            <span className="text-bone-dim">(team concedes 0 &amp; you play 60+ min)</span>
          </li>
          <li>
            <b className="text-bone">GK saves</b> — +1 per 3
          </li>
          <li>
            <b className="text-bone">Conceded</b> — −1 per 2 (DEF/GK)
          </li>
          <li>
            <b className="text-bone">Cards</b> — yellow −1 · red −3 · own goal −2
          </li>
          <li>
            <span className="text-gold">©</span> <b className="text-bone">Captain</b> — that round counts ×2
          </li>
          <li>
            <span className="text-lime">⚡</span> <b className="text-bone">Chip</b> — Triple Captain (captain ×3 one round)
          </li>
          <li>
            <span className="text-flag">🐉</span> <b className="text-bone">Giant-killer</b> — points in a round your player's team wins as an underdog get boosted (up to ×3)
          </li>
        </ul>
        <p className="mt-2.5 border-t border-edge/60 pt-2 text-[11px] text-bone-dim">
          A player only scores while their team is still alive in the bracket — draft for survival, not
          just stars. The giant-killer boost scales with the betting-market upset: a coin-flip win is
          ×1, a big underdog up to ×3.
        </p>
      </div>
        </>
      )}
    </div>
  );
}

function H2HList({ rows, me }: { rows?: H2HStanding[] | null; me?: string }) {
  if (!rows || rows.length === 0 || rows.every((r) => r.roundsPlayed === 0))
    return (
      <p className="font-mono text-xs text-bone-dim">
        Head-to-head starts after the first knockout round finishes.
      </p>
    );
  return (
    <div className="space-y-2">
      {rows.map((s, i) => (
        <div
          key={s.memberId}
          className={cx(
            "flex items-center gap-3 rounded-lg border bg-panel p-3",
            i === 0 ? "border-gold/40" : "border-edge"
          )}
        >
          <Rank i={i} />
          <span className={cx("font-bold", s.memberId === me && "text-lime")}>{s.memberName}</span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-bone-dim">
            {s.wins}<span className="text-lime">W</span> · {s.draws}D · {s.losses}
            <span className="text-flag">L</span>
          </span>
          <ScoreNum className="w-12 text-right text-3xl text-bone">{s.points}</ScoreNum>
        </div>
      ))}
      <p className="px-1 font-mono text-[10px] uppercase leading-relaxed tracking-wide text-bone-dim">
        each completed round you play every other manager on that round's points · win 3 · draw 1
      </p>
    </div>
  );
}

function BracketBoard() {
  const { session } = useSession();
  const { data, loading, lastUpdated } = usePoll<BracketStanding[]>(api.bracketStandings, 20000);
  if (loading && !data) return <Spinner />;
  if (!data || data.length === 0)
    return <p className="font-mono text-xs text-bone-dim">No bracket scores yet.</p>;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Updated at={lastUpdated} />
      </div>
      {data.map((s, i) => (
        <div
          key={s.memberId}
          className={cx(
            "flex items-center gap-3 rounded-lg border bg-panel p-3",
            i === 0 ? "border-gold/40" : "border-edge"
          )}
        >
          <Rank i={i} />
          <div className="min-w-0">
            <p className={cx("font-bold", s.memberId === session?.memberId && "text-lime")}>
              {s.memberName}
            </p>
            <p className="truncate font-mono text-[10px] uppercase tracking-wide text-bone-dim">
              {s.correct} correct · 🏆 {s.championPick ?? "—"}
            </p>
          </div>
          <span className="ml-auto flex items-baseline">
            <ScoreNum className="text-3xl text-bone">{s.points}</ScoreNum>
          </span>
        </div>
      ))}
      <p className="px-1 font-mono text-[10px] uppercase leading-relaxed tracking-wide text-bone-dim">
        correct winner: R32 10 → Final 160, × upset bonus (correctly calling an underdog scores up to
        3×)
      </p>
    </div>
  );
}
