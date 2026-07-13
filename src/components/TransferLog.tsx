import type { TransferLogEntry } from "../../shared/types";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import { usePlayerSheet } from "../lib/playerSheet";
import { SectionLabel, Spinner, cx } from "./bits";

const POS_TEXT: Record<string, string> = {
  GK: "text-gold",
  DEF: "text-bone-dim",
  MID: "text-lime",
  FWD: "text-flag",
};

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The league's transfer history: every drop→add, newest first, with the points context
// (what you gave up vs what you picked up) and a churn badge for players that keep moving.
export default function TransferLog() {
  const { data, loading } = usePoll<TransferLogEntry[]>(api.transfers, 30000);
  const openPlayer = usePlayerSheet();
  if (loading && !data) return <Spinner label="Loading transfers…" />;
  const rows = data ?? [];

  // How many transfers each player has been involved in (in or out) — "how many transfers
  // a player has" across the whole league.
  const count = new Map<string, number>();
  for (const t of rows) {
    count.set(t.outPlayerId, (count.get(t.outPlayerId) ?? 0) + 1);
    count.set(t.inPlayerId, (count.get(t.inPlayerId) ?? 0) + 1);
  }

  return (
    <section>
      <SectionLabel right={rows.length > 0 ? `${rows.length} total` : undefined}>Transfers</SectionLabel>
      {rows.length === 0 ? (
        <p className="font-mono text-xs text-bone-dim">
          No transfers yet — the window opens once a round finishes.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => {
            const churn = count.get(t.inPlayerId) ?? 1;
            return (
              <li key={t.id} className="rounded-lg border border-edge bg-panel px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-bone">{t.memberName}</span>
                  <span className={cx("font-mono text-[9px] font-bold uppercase", POS_TEXT[t.position])}>
                    {t.position}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-bone-dim">
                    {ago(t.createdAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <button
                    type="button"
                    onClick={() => openPlayer(t.outPlayerId)}
                    className="truncate text-bone-dim/70 line-through hover:text-bone-dim"
                  >
                    {t.outPlayerName}
                  </button>
                  {t.outPts != null && (
                    <span className="font-mono text-[10px] text-bone-dim/60">{t.outPts}p</span>
                  )}
                  <span className="text-bone-dim">→</span>
                  <button
                    type="button"
                    onClick={() => openPlayer(t.inPlayerId)}
                    className="truncate font-semibold text-lime hover:text-lime-deep"
                  >
                    {t.inPlayerName}
                  </button>
                  {t.inBaseline != null && (
                    <span className="font-mono text-[10px] text-bone-dim/60">{t.inBaseline}p</span>
                  )}
                  {churn > 1 && (
                    <span
                      className="ml-auto shrink-0 rounded-sm bg-bone/10 px-1 font-mono text-[9px] text-bone-dim"
                      title={`this player has changed hands ${churn} times`}
                    >
                      ⇄{churn}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
