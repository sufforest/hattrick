import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BracketResponse } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { Bracket, BracketSlot, RoundCode, TeamRef } from "../../shared/types";
import { Flag, SectionLabel, Pill, Kicker, Spinner, cx } from "../components/bits";
import { Updated } from "../components/Updated";

const ROUND_SEQ: RoundCode[] = ["R32", "R16", "QF", "SF", "F"];
const ROUND_LABEL: Record<string, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarters",
  SF: "Semis",
  F: "Final",
};
const ROUND_PTS: Record<string, number> = { R32: 10, R16: 20, QF: 40, SF: 80, F: 160 };

// desktop tree geometry
const COL_W = 244;
const CARD_W = 212;
const CARD_H = 70;
const ROW_H = 86;
const PAD = 10;

type Advancing = { team: TeamRef | null; dead: boolean };
type Picks = Record<string, { teamId: string; teamName: string }>;

// Compact "time until" a kickoff, for the bracket deadline nudge.
function untilStr(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function slotStatus(slot: BracketSlot): { text: string; live: boolean } {
  if (slot.state === "in") return { text: "LIVE", live: true };
  if (slot.state === "post") return { text: slot.statusDetail || "FT", live: false };
  return {
    text: new Date(slot.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    live: false,
  };
}

export default function BracketPage() {
  const { data: resp, lastUpdated } = usePoll<BracketResponse>(api.bracket, 20000);
  const [picks, setPicks] = useState<Picks>({});
  const inited = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"mine" | "all">("mine");
  const [hoverTeam, setHoverTeam] = useState<string | null>(null);
  const [step, setStep] = useState<RoundCode>("R32");

  useEffect(() => {
    if (resp && !inited.current) {
      setPicks(resp.picks);
      inited.current = true;
    }
  }, [resp]);

  const slots = resp?.bracket.slots ?? [];
  const slotByKey = useMemo(() => new Map(slots.map((s) => [s.key, s])), [slots]);
  const teamById = useMemo(() => {
    const m = new Map<string, TeamRef>();
    for (const s of slots) {
      if (s.teamA) m.set(s.teamA.id, s.teamA);
      if (s.teamB) m.set(s.teamB.id, s.teamB);
    }
    return m;
  }, [slots]);
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) {
      if (s.childAKey) m.set(s.childAKey, s.key);
      if (s.childBKey) m.set(s.childBKey, s.key);
    }
    return m;
  }, [slots]);
  // Every team knocked out anywhere in the tournament (loser of any decided match).
  const eliminated = useMemo(() => {
    const out = new Set<string>();
    for (const s of slots) {
      if (!s.actualWinnerId) continue;
      for (const t of [s.teamA, s.teamB]) if (t && t.id !== s.actualWinnerId) out.add(t.id);
    }
    return out;
  }, [slots]);
  const layout = useMemo(() => computeLayout(slots), [slots]);
  const highlight = useMemo(() => computePath(hoverTeam, slots, parentOf), [hoverTeam, slots, parentOf]);

  if (!resp) return <Spinner label="Loading the bracket…" />;
  const locked = resp.locked;

  const advancing = (childKey: string | null): Advancing => {
    if (!childKey) return { team: null, dead: false };
    const slot = slotByKey.get(childKey);
    const pick = picks[childKey];
    if (pick) {
      const team =
        teamById.get(pick.teamId) ?? {
          id: pick.teamId,
          name: pick.teamName,
          abbr: pick.teamName.slice(0, 3).toUpperCase(),
        };
      return { team, dead: !!(slot?.actualWinnerId && slot.actualWinnerId !== pick.teamId) };
    }
    if (slot?.actualWinnerId) return { team: teamById.get(slot.actualWinnerId) ?? null, dead: false };
    return { team: null, dead: false };
  };
  const candidatesFor = (slot: BracketSlot): [Advancing, Advancing] =>
    slot.round === "R32"
      ? [{ team: slot.teamA, dead: false }, { team: slot.teamB, dead: false }]
      : [advancing(slot.childAKey), advancing(slot.childBKey)];
  const slotLocked = (slot: BracketSlot) => locked || slot.state !== "pre";

  async function select(slot: BracketSlot, team: TeamRef) {
    if (slotLocked(slot)) return;
    setErr(null);
    const prev = picks;
    setPicks({ ...picks, [slot.key]: { teamId: team.id, teamName: team.name } }); // optimistic
    try {
      const res = await api.bracketPick(slot.key, team.id, team.name);
      // Authoritative state: the server may have cascade-cleared now-orphaned downstream
      // picks (e.g. a QF pick whose team this change just eliminated).
      if (res.picks) setPicks(res.picks);
    } catch (e: any) {
      setErr(e.message);
      setPicks(prev);
    }
  }

  const champion = advancing(resp.bracket.champKey).team;
  const totalPicked = Object.keys(picks).length;
  // Slots you can still fill: unpicked and not yet kicked off (and bracket not locked).
  const openSlots = locked ? [] : slots.filter((s) => s.state === "pre" && !picks[s.key]);
  const nextLock = openSlots.reduce<string | null>(
    (min, s) => (min == null || s.date < min ? s.date : min),
    null
  );

  const connectors: { d: string; on: boolean }[] = [];
  for (const s of slots) {
    for (const ck of [s.childAKey, s.childBKey]) {
      if (!ck) continue;
      const c = layout.pos.get(ck);
      const p = layout.pos.get(s.key);
      if (!c || !p) continue;
      const midX = c.x + CARD_W + (COL_W - CARD_W) / 2;
      connectors.push({
        d: `M ${c.x + CARD_W} ${c.y} H ${midX} V ${p.y} H ${p.x}`,
        on: highlight.segs.has(`${s.key}|${ck}`),
      });
    }
  }

  return (
    <div className="animate-rise space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Kicker>Predict the knockout</Kicker>
          <h1 className="font-display text-3xl uppercase leading-none tracking-tight sm:text-4xl">
            Your Bracket
          </h1>
        </div>
        <Updated at={lastUpdated} className="mb-1.5" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold">Champion</span>
          {champion ? (
            <span className="flex items-center gap-1.5 font-bold text-gold">
              <Flag team={champion} size={16} /> {champion.name}
            </span>
          ) : (
            <span className="text-bone-dim">not picked</span>
          )}
        </span>
        {locked && <Pill tone="gold">🔒 locked</Pill>}
        <div className="ml-auto flex border border-edge">
          {(["mine", "all"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cx(
                "px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                view === v ? "bg-lime text-ink" : "text-bone-dim hover:text-bone"
              )}
            >
              {v === "mine" ? "My picks" : "Everyone"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-edge bg-panel p-3">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
          <span className={totalPicked >= 31 ? "text-lime" : "text-bone-dim"}>
            {totalPicked} / 31 picked
          </span>
          <span className="text-bone-dim">
            {locked ? (
              "locked"
            ) : openSlots.length > 0 ? (
              <>
                {openSlots.length} open
                {nextLock && (
                  <>
                    {" · next locks in "}
                    <b className="text-bone">{untilStr(nextLock)}</b>
                  </>
                )}
              </>
            ) : totalPicked >= 31 ? (
              <span className="text-lime">complete ✓</span>
            ) : (
              "open matches all locked"
            )}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
          <div
            className="h-full rounded-full bg-lime transition-all"
            style={{ width: `${Math.round((totalPicked / 31) * 100)}%` }}
          />
        </div>
      </div>

      {err && <p className="font-mono text-xs text-flag">{err}</p>}

      {view === "mine" ? (
        <>
          <p className="font-mono text-[10px] uppercase leading-relaxed tracking-wide text-bone-dim">
            Tap a team to advance it · finished matches fill in automatically · picks lock at
            kickoff
          </p>

          {/* desktop / tablet: real tree with connectors */}
          <div className="hidden overflow-x-auto pb-4 sm:block">
            <div style={{ width: layout.width }}>
              <div className="mb-2 flex">
                {ROUND_SEQ.map((r) => (
                  <div
                    key={r}
                    style={{ width: COL_W }}
                    className="font-mono text-[10px] font-bold uppercase tracking-wider text-bone-dim"
                  >
                    {ROUND_LABEL[r]}
                    <span className="text-bone-dim/40"> · {ROUND_PTS[r]}pt</span>
                  </div>
                ))}
              </div>
              <div className="relative" style={{ width: layout.width, height: layout.height }}>
                <svg
                  className="pointer-events-none absolute inset-0"
                  width={layout.width}
                  height={layout.height}
                >
                  {connectors.map((cn, i) => (
                    <path
                      key={i}
                      d={cn.d}
                      fill="none"
                      stroke={cn.on ? "#b8ff2e" : "#333b34"}
                      strokeWidth={cn.on ? 2 : 1.25}
                    />
                  ))}
                </svg>
                {slots.map((s) => {
                  const p = layout.pos.get(s.key);
                  if (!p) return null;
                  return (
                    <div
                      key={s.key}
                      style={{ position: "absolute", left: p.x, top: p.y - CARD_H / 2, width: CARD_W }}
                    >
                      <MatchBox
                        slot={s}
                        candidates={candidatesFor(s)}
                        pickedId={picks[s.key]?.teamId}
                        locked={slotLocked(s)}
                        onSelect={select}
                        onHover={setHoverTeam}
                        highlightTeam={hoverTeam}
                        inPath={highlight.slotKeys.has(s.key)}
                        eliminated={eliminated}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* mobile: round stepper */}
          <div className="sm:hidden">
            <div className="mb-3 flex gap-1">
              {ROUND_SEQ.map((r) => (
                <button
                  key={r}
                  onClick={() => setStep(r)}
                  className={cx(
                    "flex-1 rounded-sm py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                    step === r ? "bg-lime text-ink" : "border border-edge text-bone-dim"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {slots
                .filter((s) => s.round === step)
                .sort((a, b) => a.matchNumber - b.matchNumber)
                .map((s) => (
                  <MatchBox
                    key={s.key}
                    slot={s}
                    candidates={candidatesFor(s)}
                    pickedId={picks[s.key]?.teamId}
                    locked={slotLocked(s)}
                    onSelect={select}
                    onHover={() => {}}
                    highlightTeam={null}
                    inPath={false}
                    eliminated={eliminated}
                  />
                ))}
            </div>
          </div>
        </>
      ) : (
        <RevealView bracket={resp.bracket} teamById={teamById} />
      )}
    </div>
  );
}

// Visual top-to-bottom order of the R32 leaves: an in-order DFS of the bracket
// tree (childA above childB). ESPN's match numbers are NOT bracket-adjacent
// (e.g. R16 match 2 is fed by R32 1 and 3, skipping 2), so ordering leaves by the
// tree — not by matchNumber — is what makes each parent sit between its two real
// feeders with clean, non-crossing connectors.
function leafOrder(slots: BracketSlot[]): Map<string, number> {
  const byKey = new Map(slots.map((s) => [s.key, s]));
  const order = new Map<string, number>();
  let idx = 0;
  const visit = (key: string | null | undefined) => {
    if (!key) return;
    const s = byKey.get(key);
    if (!s) return;
    if (s.round === "R32") {
      if (!order.has(key)) order.set(key, idx++);
      return;
    }
    visit(s.childAKey);
    visit(s.childBKey);
  };
  visit("F-1");
  // Any leaves the tree didn't reach (incomplete feeder data) fall in after, by number.
  for (const s of [...slots]
    .filter((s) => s.round === "R32")
    .sort((a, b) => a.matchNumber - b.matchNumber))
    if (!order.has(s.key)) order.set(s.key, idx++);
  return order;
}

function computeLayout(slots: BracketSlot[]) {
  const pos = new Map<string, { x: number; y: number }>();
  const order = leafOrder(slots);
  for (const s of slots.filter((s) => s.round === "R32"))
    pos.set(s.key, { x: 0, y: PAD + ((order.get(s.key) ?? s.matchNumber - 1) + 0.5) * ROW_H });
  // Each higher-round slot is centered on its two actual children (resolved via
  // childAKey/childBKey), processed round-by-round so children are placed first.
  (["R16", "QF", "SF", "F"] as RoundCode[]).forEach((round) => {
    const x = ROUND_SEQ.indexOf(round) * COL_W;
    const inR = slots.filter((s) => s.round === round);
    for (const s of inR) {
      const a = s.childAKey ? pos.get(s.childAKey) : null;
      const b = s.childBKey ? pos.get(s.childBKey) : null;
      const y =
        a && b ? (a.y + b.y) / 2 : a ? a.y : b ? b.y : PAD + (s.matchNumber - 0.5) * ROW_H * (16 / inR.length);
      pos.set(s.key, { x, y });
    }
  });
  return { pos, width: 4 * COL_W + CARD_W, height: PAD * 2 + 16 * ROW_H };
}

function computePath(teamId: string | null, slots: BracketSlot[], parentOf: Map<string, string>) {
  const slotKeys = new Set<string>();
  const segs = new Set<string>();
  if (!teamId) return { slotKeys, segs };
  const start = slots.find(
    (s) => s.round === "R32" && (s.teamA?.id === teamId || s.teamB?.id === teamId)
  );
  if (!start) return { slotKeys, segs };
  slotKeys.add(start.key);
  let cur = start.key;
  while (parentOf.has(cur)) {
    const p = parentOf.get(cur)!;
    slotKeys.add(p);
    segs.add(`${p}|${cur}`);
    cur = p;
  }
  return { slotKeys, segs };
}

function MatchBox({
  slot,
  candidates,
  pickedId,
  locked,
  onSelect,
  onHover,
  highlightTeam,
  inPath,
  eliminated,
}: {
  slot: BracketSlot;
  candidates: [Advancing, Advancing];
  pickedId?: string;
  locked: boolean;
  onSelect: (slot: BracketSlot, team: TeamRef) => void;
  onHover: (teamId: string | null) => void;
  highlightTeam: string | null;
  inPath: boolean;
  eliminated: Set<string>; // teams knocked out anywhere in the tournament
}) {
  const decided = !!slot.actualWinnerId;
  // A pick is busted the moment its team is eliminated — even before this slot's match.
  const pickedElim = !!(pickedId && eliminated.has(pickedId));
  const pickRight = pickedElim ? false : decided && pickedId ? pickedId === slot.actualWinnerId : null;
  const status = slotStatus(slot);
  const border = inPath
    ? "border-lime/70"
    : pickRight === true
      ? "border-lime/40"
      : pickRight === false
        ? "border-flag/40"
        : "border-edge";

  return (
    <div className={cx("overflow-hidden rounded-md border bg-panel transition-colors", border)}>
      <div className="flex items-center justify-between bg-black/20 px-2 py-0.5">
        <span
          className={cx(
            "font-mono text-[9px] uppercase tracking-wider",
            status.live ? "font-bold text-flag" : "text-bone-dim/70"
          )}
        >
          {status.live ? "● LIVE" : status.text}
        </span>
        {pickRight === true && <span className="text-[9px] text-lime">✓ nailed</span>}
        {pickRight === false && <span className="text-[9px] text-flag/70">✗ busted</span>}
      </div>
      {candidates.map(({ team, dead }, i) => {
        // Dead = lost its feeder match, or eliminated anywhere in the tournament.
        const isDead = dead || (!!team && eliminated.has(team.id));
        const isPicked = !!team && team.id === pickedId;
        const isActual = !!team && team.id === slot.actualWinnerId;
        const isHi = !!team && team.id === highlightTeam;
        const disabled = locked || !team || isDead; // can't pick a knocked-out team
        const loser = decided && !!team && !isActual && !isPicked;
        const wrong = isPicked && decided && !isActual;
        return (
          <button
            key={i}
            disabled={disabled}
            onClick={() => team && onSelect(slot, team)}
            onMouseEnter={() => team && onHover(team.id)}
            onMouseLeave={() => onHover(null)}
            className={cx(
              "flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] transition-colors",
              i === 0 && "border-b border-edge/50",
              isDead && "text-bone-dim/30 line-through",
              !isDead && wrong && "bg-flag/10 text-flag/70 line-through",
              !isDead && !wrong && isPicked && "bg-lime/20 font-bold text-bone",
              !isDead && !isPicked && isActual && "font-bold text-lime",
              !isDead && loser && "text-bone-dim/50",
              !isDead && !isPicked && !isActual && !loser && "text-bone/75",
              isHi && !isPicked && !isDead && "text-lime",
              !disabled && !isPicked && "hover:bg-white/5",
              disabled && "cursor-default"
            )}
          >
            {team ? <Flag team={team} size={15} /> : <span className="h-[15px] w-[15px] shrink-0" />}
            <span className="truncate">{team?.name ?? "—"}</span>
            {isActual && <span className="ml-auto shrink-0 text-lime">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function RevealView({ bracket, teamById }: { bracket: Bracket; teamById: Map<string, TeamRef> }) {
  const { data, loading } = usePoll(api.bracketReveal, 20000);
  if (loading && !data) return <Spinner />;
  const slotsData = data?.slots ?? {};
  const anyRevealed = Object.keys(slotsData).length > 0;

  if (!anyRevealed)
    return (
      <p className="rounded-md border border-edge bg-panel p-4 font-mono text-xs uppercase tracking-wide text-bone-dim">
        🔒 Nothing to reveal yet — everyone's picks for a match appear here the moment it kicks off.
      </p>
    );

  return (
    <div className="space-y-5">
      {ROUND_SEQ.map((round) => {
        const revealed = bracket.slots
          .filter((s) => s.round === round && slotsData[s.key]?.length)
          .sort((a, b) => a.matchNumber - b.matchNumber);
        if (revealed.length === 0) return null;
        return (
          <section key={round}>
            <SectionLabel>{ROUND_LABEL[round]}</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {revealed.map((s) => {
                const aName = s.teamA?.name ?? "TBD";
                const bName = s.teamB?.name ?? "TBD";
                return (
                  <div key={s.key} className="rounded-md border border-edge bg-panel p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Flag team={s.teamA} size={16} />
                      <span className={s.actualWinnerId === s.teamA?.id ? "text-lime" : "text-bone/80"}>
                        {aName}
                      </span>
                      <span className="font-mono text-[10px] text-bone-dim">vs</span>
                      <Flag team={s.teamB} size={16} />
                      <span className={s.actualWinnerId === s.teamB?.id ? "text-lime" : "text-bone/80"}>
                        {bName}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {slotsData[s.key].map((e) => {
                        const right = s.actualWinnerId
                          ? e.teamId === s.actualWinnerId
                          : null;
                        const abbr = teamById.get(e.teamId)?.abbr ?? e.teamName.slice(0, 3);
                        return (
                          <span
                            key={e.memberId}
                            className={cx(
                              "rounded-sm border px-2 py-0.5 font-mono text-[10px]",
                              right === true && "border-lime/40 bg-lime/10 text-lime",
                              right === false && "border-flag/30 bg-flag/10 text-flag/80",
                              right === null && "border-edge text-bone-dim"
                            )}
                          >
                            {e.memberName} → {abbr}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
