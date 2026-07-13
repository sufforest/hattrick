import { Link } from "react-router-dom";
import type { Match } from "../../shared/types";
import { Flag, LiveDot, ScoreNum, cx } from "./bits";
import { statusLabel } from "../lib/format";

function TeamRow({
  name,
  team,
  score,
  isWinner,
  dim,
  showScore,
}: {
  name: string;
  team: { id: string; name: string; abbr: string; logo?: string } | null;
  score: number | null;
  isWinner: boolean;
  dim: boolean;
  showScore: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-2.5", dim && "opacity-45")}>
      <Flag team={team} size={24} />
      <span
        className={cx(
          "truncate text-sm",
          isWinner ? "font-bold text-bone" : "font-medium text-bone/85"
        )}
      >
        {name}
      </span>
      {showScore && (
        <ScoreNum className={cx("ml-auto text-2xl", isWinner ? "text-lime" : "text-bone/70")}>
          {score ?? 0}
        </ScoreNum>
      )}
    </div>
  );
}

export default function MatchCard({ m, predict }: { m: Match; predict?: boolean }) {
  const homeName = m.home?.name ?? m.homePlaceholder ?? "TBD";
  const awayName = m.away?.name ?? m.awayPlaceholder ?? "TBD";
  const homeWin = m.state === "post" && m.winnerId === m.home?.id;
  const awayWin = m.state === "post" && m.winnerId === m.away?.id;
  const live = m.state === "in";
  const showScore = m.state !== "pre";

  return (
    <Link
      to={`/match/${m.id}`}
      className={cx(
        "group block overflow-hidden rounded-lg border bg-panel transition-colors hover:bg-panel-2",
        live ? "border-flag/50" : "border-edge hover:border-edge-bright"
      )}
    >
      <div className="flex items-center justify-between border-b border-edge bg-black/20 px-3 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-bone-dim">
          {m.roundLabel}
          {predict && m.state === "pre" && m.home && m.away && (
            <span className="text-lime" title="Predictions open">
              🎯
            </span>
          )}
        </span>
        <span
          className={cx(
            "flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider",
            live ? "text-flag" : "text-bone-dim"
          )}
        >
          {live && <LiveDot />}
          {statusLabel(m)}
        </span>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        <TeamRow
          name={homeName}
          team={m.home}
          score={m.homeScore}
          isWinner={homeWin}
          dim={m.state === "post" && awayWin}
          showScore={showScore}
        />
        <TeamRow
          name={awayName}
          team={m.away}
          score={m.awayScore}
          isWinner={awayWin}
          dim={m.state === "post" && homeWin}
          showScore={showScore}
        />
      </div>
    </Link>
  );
}
