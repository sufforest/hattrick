import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { DraftStanding, DraftState } from "../../shared/types";
import { useSession } from "../lib/session";
import { cx } from "./bits";

const ord = (n: number) => {
  const v = n % 100;
  const s = ["th", "st", "nd", "rd"];
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// A one-line "what do I do now" hub: your rank + the outstanding actions (captain not set
// for the next round, transfers available). So nobody has to hunt for what's next.
export default function StatusStrip() {
  const { session } = useSession();
  const me = session?.memberId;
  const { data: draft } = usePoll<DraftState>(api.draft, 20000);
  const { data: standings } = usePoll<DraftStanding[]>(api.draftStandings, 20000);

  if (!draft || draft.status !== "done") return null;
  if (!(draft.picks ?? []).some((p) => p.memberId === me)) return null; // not in the draft

  const hasScores = (standings ?? []).some((s) => s.points !== 0);
  const rank = hasScores && standings ? standings.findIndex((s) => s.memberId === me) + 1 : null;
  const total = standings?.length ?? 0;
  const nextCap = draft.captainRounds.find((cr) => !cr.locked && !cr.captainPlayerId);
  const transfersLeft = draft.transfersPerRound * draft.completedRounds - draft.myTransfersUsed;
  const allSet = !nextCap && transfersLeft <= 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-panel/60 px-3 py-2 animate-rise">
      {rank ? (
        <span
          className={cx(
            "font-mono text-[11px] font-bold uppercase tracking-wider",
            rank === 1 ? "text-gold" : "text-bone"
          )}
        >
          {rank === 1 && "🏆 "}You're {ord(rank)} of {total}
        </span>
      ) : (
        <span className="font-mono text-[11px] uppercase tracking-wider text-bone-dim">
          Squad locked · waiting on kickoff
        </span>
      )}

      {(nextCap || transfersLeft > 0 || allSet) && <span className="h-3.5 w-px bg-edge" />}

      {nextCap && (
        <Link
          to="/draft"
          className="rounded border border-gold/40 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20"
        >
          © Set {nextCap.round} captain
        </Link>
      )}
      {transfersLeft > 0 && (
        <Link
          to="/draft"
          className="rounded border border-lime/40 bg-lime/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-lime transition-colors hover:bg-lime/20"
        >
          🔄 {transfersLeft} transfer{transfersLeft !== 1 ? "s" : ""}
        </Link>
      )}
      {allSet && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-bone-dim">✓ all set</span>
      )}
    </div>
  );
}
