import { useState } from "react";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import { REACTIONS, type ActivityItem } from "../../shared/types";
import { SectionLabel, cx } from "./bits";

// Compact "x ago" for a feed timestamp.
function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Auto-generated league activity (the app narrates the drama) with one-tap emoji reactions.
export default function Feed() {
  const { data, refresh } = usePoll<ActivityItem[]>(api.activity, 15000);
  const [busy, setBusy] = useState(false);

  async function react(id: number, emoji: string) {
    setBusy(true);
    try {
      await api.react(id, emoji);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!data || data.length === 0) return null;

  return (
    <section>
      <SectionLabel>League activity</SectionLabel>
      <div className="space-y-1.5">
        {data.map((a) => (
          <div key={a.id} className="rounded-lg border border-edge bg-panel px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="text-sm leading-5">{a.emoji}</span>
              <span className="flex-1 text-sm leading-5 text-bone/85">{a.text}</span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-bone-dim/50">
                {ago(a.createdAt)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {REACTIONS.map((e) => {
                const n = a.reactions[e] ?? 0;
                const mine = a.myReactions.includes(e);
                return (
                  <button
                    key={e}
                    disabled={busy}
                    onClick={() => react(a.id, e)}
                    className={cx(
                      "rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors",
                      mine
                        ? "border-lime/50 bg-lime/15"
                        : n > 0
                          ? "border-edge hover:border-bone-dim"
                          : "border-edge/50 opacity-40 hover:opacity-100"
                    )}
                  >
                    {e}
                    {n > 0 && <span className="ml-0.5 font-mono text-[9px] text-bone-dim">{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
