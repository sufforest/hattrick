import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { PredictionPropView, PredictionSlateView } from "../../shared/types";
import { useSession } from "../lib/session";
import { cx } from "./bits";

// Rendered inside the match-page tabs. `view` is driven by the parent ("mine"
// or "everyone"); this component just owns the slate data + editing.
export default function PredictionSlate({
  eventId,
  teamsKnown = true,
  view,
}: {
  eventId: string;
  teamsKnown?: boolean;
  view: "mine" | "everyone";
}) {
  const { session } = useSession();
  const [slate, setSlate] = useState<PredictionSlateView | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSlate(await api.predictionSlate(eventId));
    } catch {
      /* ignore */
    }
  }, [eventId]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);
  useEffect(() => {
    if (!slate?.locked) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [slate?.locked, load]);

  if (!session) {
    return (
      <p className="rounded-md border border-edge bg-panel p-3 text-sm text-bone/75">
        <Link to="/start" className="font-semibold text-lime underline">
          Join a league
        </Link>{" "}
        to call this match against your friends.
      </p>
    );
  }
  if (!slate) return <p className="font-mono text-xs text-bone-dim">Loading…</p>;

  if (slate.open && !teamsKnown) {
    return (
      <p className="rounded-md border border-edge bg-panel p-3 font-mono text-xs uppercase tracking-wide text-bone-dim">
        🔒 Predictions open once both teams are confirmed.
      </p>
    );
  }

  // ---- Everyone view ----
  if (view === "everyone") {
    if (!slate.locked) {
      return (
        <p className="rounded-md border border-edge bg-panel p-3 font-mono text-xs uppercase tracking-wide text-bone-dim">
          🔒 Everyone's picks reveal the moment the match kicks off.
        </p>
      );
    }
    return <RevealView slate={slate} />;
  }

  // ---- My picks view ----
  const selected = (p: PredictionPropView) => picks[p.key] ?? p.myValue;
  async function set(prop: string, value: string) {
    if (!slate!.open) return;
    setErr(null);
    setPicks((p) => ({ ...p, [prop]: value }));
    try {
      await api.savePrediction(eventId, prop, value);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-bone-dim">
        <span>
          {slate.open
            ? "Pick before kickoff · winner is upset-weighted"
            : slate.graded
              ? "Final"
              : "Locked"}
        </span>
        {slate.graded && <span className="font-bold text-lime">+{slate.myScore} pts</span>}
      </div>
      {err && <p className="font-mono text-xs text-flag">{err}</p>}
      {slate.props.map((p) => (
        <PropRow
          key={p.key}
          prop={p}
          open={slate.open}
          graded={slate.graded}
          selected={selected(p)}
          onSet={(v) => set(p.key, v)}
        />
      ))}
    </div>
  );
}

function PropRow({
  prop,
  open,
  graded,
  selected,
  onSet,
}: {
  prop: PredictionPropView;
  open: boolean;
  graded: boolean;
  selected?: string;
  onSet: (value: string) => void;
}) {
  return (
    <div className="rounded-md border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold">{prop.label}</span>
        <span className="font-mono text-[10px] text-bone-dim">
          {prop.points} pts{prop.upset ? " · upset-weighted" : ""}
        </span>
        {graded && prop.myValue != null && (
          <span
            className={cx(
              "ml-auto font-mono text-[10px] font-bold",
              prop.correct ? "text-lime" : "text-flag"
            )}
          >
            {prop.correct ? "✓ nailed" : "✗ miss"}
          </span>
        )}
        {graded && prop.actual && (
          <span
            className={cx("font-mono text-[10px] text-bone-dim", prop.myValue == null ? "ml-auto" : "")}
          >
            actual: <span className="text-lime">{prop.actual}</span>
          </span>
        )}
      </div>

      {prop.type === "score" ? (
        <ScoreInput value={selected} disabled={!open} onSet={onSet} />
      ) : (
        <div className="flex gap-1.5">
          {prop.options?.map((o) => {
            const isSel = selected === o.value;
            const isActual = graded && prop.actual === o.label;
            return (
              <button
                key={o.value}
                disabled={!open}
                onClick={() => onSet(o.value)}
                className={cx(
                  "flex-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                  isSel && graded && prop.correct && "border-lime bg-lime/20 font-bold text-bone",
                  isSel && graded && !prop.correct && "border-flag/50 bg-flag/10 text-flag/80",
                  isSel && !graded && "border-lime bg-lime/20 font-bold text-bone",
                  !isSel && isActual && "border-lime/50 text-lime",
                  !isSel && !isActual && "border-edge text-bone/70",
                  open && !isSel && "hover:border-lime/50",
                  !open && "cursor-default"
                )}
              >
                {o.label}
                {!graded && o.points != null && (
                  <span className="mt-0.5 block font-mono text-[10px] text-lime/80">{o.points} pts</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreInput({
  value,
  disabled,
  onSet,
}: {
  value?: string;
  disabled?: boolean;
  onSet: (value: string) => void;
}) {
  const [h, a] = (value ?? "").split("-");
  const box =
    "w-14 rounded-md border border-edge bg-black/30 px-2 py-1.5 text-center font-display text-lg text-bone outline-none focus:border-lime disabled:opacity-60";
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={20}
        value={h ?? ""}
        disabled={disabled}
        onChange={(e) => onSet(`${Math.max(0, +e.target.value || 0)}-${a || 0}`)}
        className={box}
      />
      <span className="text-bone-dim">–</span>
      <input
        type="number"
        min={0}
        max={20}
        value={a ?? ""}
        disabled={disabled}
        onChange={(e) => onSet(`${h || 0}-${Math.max(0, +e.target.value || 0)}`)}
        className={box}
      />
      <span className="ml-1 font-mono text-[10px] uppercase tracking-wide text-bone-dim">home – away</span>
    </div>
  );
}

function RevealView({ slate }: { slate: PredictionSlateView }) {
  return (
    <div className="space-y-3">
      {slate.perMember && slate.perMember.length > 0 && (
        <div className="rounded-md border border-gold/30 bg-gold/[0.05] p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-bone-dim">
            This match
          </p>
          {slate.perMember.map((m, i) => (
            <div key={m.memberName} className="flex items-center justify-between py-0.5 text-sm">
              <span>
                <span className="mr-1">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}</span>
                {m.memberName}
              </span>
              <span className="font-display tabular-nums">{m.points}</span>
            </div>
          ))}
        </div>
      )}
      {slate.props.map((p) => (
        <div key={p.key} className="rounded-md border border-edge bg-panel p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold">{p.label}</span>
            {p.actual && (
              <span className="font-mono text-[10px] text-bone-dim">
                actual: <span className="text-lime">{p.actual}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(p.reveal ?? []).map((r) => (
              <span
                key={r.memberName}
                className={cx(
                  "rounded-sm border px-2 py-0.5 font-mono text-[10px]",
                  r.correct === true && "border-lime/40 bg-lime/10 text-lime",
                  r.correct === false && "border-flag/30 bg-flag/10 text-flag/80",
                  r.correct == null && "border-edge text-bone-dim"
                )}
              >
                {r.memberName}: {r.value}
              </span>
            ))}
            {(!p.reveal || p.reveal.length === 0) && (
              <span className="font-mono text-[10px] text-bone-dim/60">no picks</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
