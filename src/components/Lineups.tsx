import { useState } from "react";
import type { LineupPlayer, TeamLineup } from "../../shared/types";
import { cx } from "./bits";

// Fantasy ownership of a player in this league, for the owner tag next to their name.
export type PlayerOwner = { name: string; mine: boolean; captain: boolean };

export default function Lineups({
  lineups,
  onSelect,
  ownerOf,
}: {
  lineups: TeamLineup[];
  onSelect: (p: LineupPlayer) => void;
  ownerOf?: (playerId: string) => PlayerOwner | null;
}) {
  const teams = (lineups ?? []).filter((t) => t.players.length > 0);
  if (teams.length === 0)
    return (
      <p className="font-mono text-xs uppercase tracking-wide text-bone-dim">
        Lineups not announced yet — usually about an hour before kickoff.
      </p>
    );
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {teams.map((t) => (
          <TeamCol key={t.homeAway} team={t} onSelect={onSelect} ownerOf={ownerOf} />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-bone-dim/60">
        Tap a player for their match stats · tags show who drafted them in your league
      </p>
    </div>
  );
}

function TeamCol({
  team,
  onSelect,
  ownerOf,
}: {
  team: TeamLineup;
  onSelect: (p: LineupPlayer) => void;
  ownerOf?: (playerId: string) => PlayerOwner | null;
}) {
  const [showBench, setShowBench] = useState(false);
  const starters = team.players.filter((p) => p.starter);
  const subs = team.players.filter((p) => !p.starter);
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">{team.teamName}</span>
        {team.formation && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-lime">
            {team.formation}
          </span>
        )}
      </div>
      <ul className="space-y-0.5">
        {starters.map((p) => (
          <PlayerLine key={p.id} p={p} onSelect={onSelect} owner={ownerOf?.(p.id) ?? null} />
        ))}
      </ul>
      {subs.length > 0 && (
        <>
          <button
            onClick={() => setShowBench((b) => !b)}
            className="mt-3 flex w-full items-center justify-between rounded px-1 py-1 font-mono text-[10px] uppercase tracking-wide text-bone-dim hover:text-bone"
          >
            <span>Bench ({subs.length})</span>
            <span>{showBench ? "▾" : "▸"}</span>
          </button>
          {showBench && (
            <ul className="mt-0.5 space-y-0.5">
              {subs.map((p) => (
                <PlayerLine key={p.id} p={p} onSelect={onSelect} owner={ownerOf?.(p.id) ?? null} sub />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PlayerLine({
  p,
  onSelect,
  owner,
  sub,
}: {
  p: LineupPlayer;
  onSelect: (p: LineupPlayer) => void;
  owner?: PlayerOwner | null;
  sub?: boolean;
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(p)}
        className={cx(
          "flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-white/5",
          sub && "opacity-75",
          owner?.mine && "bg-lime/[0.07]"
        )}
      >
        <span className="w-5 shrink-0 text-center font-mono text-[10px] text-bone-dim">
          {p.jersey ?? ""}
        </span>
        <span className="truncate font-medium text-bone/90">{p.name}</span>
        {p.subbedOut && <span className="shrink-0 text-[10px] text-flag/70">↓</span>}
        {p.subbedIn && <span className="shrink-0 text-[10px] text-lime">↑</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {owner && (
            <span
              className={cx(
                "rounded-sm border px-1 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-wider",
                owner.mine ? "border-lime/50 bg-lime/10 text-lime" : "border-edge bg-black/30 text-bone-dim"
              )}
              title={owner.mine ? "Your pick" : `Drafted by ${owner.name}`}
            >
              {owner.captain && "© "}
              {owner.mine ? "You" : owner.name}
            </span>
          )}
          {p.position && (
            <span className="font-mono text-[9px] uppercase text-bone-dim">{p.position}</span>
          )}
        </span>
      </button>
    </li>
  );
}
