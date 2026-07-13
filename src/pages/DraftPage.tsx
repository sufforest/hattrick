import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { DraftStanding, DraftState, FantasyPlayerLine, PoolPlayer, Position, TeamRef } from "../../shared/types";
import { CHIPS } from "../../shared/types";
import { useSession } from "../lib/session";
import { Button, Flag, SectionLabel, Pill, Kicker, Spinner, cx } from "../components/bits";
import { Updated } from "../components/Updated";
import DraftBoard from "../components/DraftBoard";
import Rosters from "../components/Rosters";
import TransferLog from "../components/TransferLog";
import { usePlayerSheet } from "../lib/playerSheet";

const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];

// Remaining clock as m:ss.
function fmtRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type SortKey = "proj" | "team" | "az";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "proj", label: "Proj" },
  { key: "team", label: "Team" },
  { key: "az", label: "A–Z" },
];

// Tier dots: ●●● elite, ●●○, ●○○ — a quantile of projected value, kept deliberately
// coarse so it reads as a hint, not a fake-precise number.
function Tier({ tier }: { tier?: 1 | 2 | 3 }) {
  if (!tier) return null;
  return (
    <span className="shrink-0 font-mono text-[9px] leading-none tracking-tight text-gold" title={`Tier ${tier}`}>
      {"●".repeat(tier)}
      <span className="text-bone-dim/30">{"●".repeat(3 - tier)}</span>
    </span>
  );
}

export default function DraftPage() {
  const { session } = useSession();
  const { data, loading, lastUpdated, setData, refresh } = usePoll<DraftState>(api.draft, 5000);
  const { data: pool } = usePoll<PoolPlayer[]>(api.players, 600000);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [sort, setSort] = useState<SortKey>("proj");
  const [view, setView] = useState<"draft" | "board" | "rosters" | "transfers">("draft");
  const [captainRound, setCaptainRound] = useState<string | null>(null);
  const [chipOpen, setChipOpen] = useState<string | null>(null);
  const [playingChip, setPlayingChip] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const autopickFired = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    playerId: string;
    playerName: string;
    position: Position;
  } | null>(null);

  const me = session?.memberId;
  const openPlayer = usePlayerSheet();
  const taken = useMemo(() => new Set((data?.picks ?? []).map((p) => p.playerId)), [data?.picks]);
  const myPicks = useMemo(
    () => (data?.picks ?? []).filter((p) => p.memberId === me),
    [data?.picks, me]
  );
  // Live points + rank for the finished-draft squad view (empty until the draft's done).
  const { data: standings } = usePoll<DraftStanding[]>(
    () => (data?.status === "done" ? api.draftStandings() : Promise.resolve([])),
    20000,
    [data?.status]
  );
  const myStanding = standings?.find((s) => s.memberId === me) ?? null;
  const myRank = myStanding && standings ? standings.findIndex((s) => s.memberId === me) + 1 : null;
  const lineByPlayer = useMemo(() => {
    const m = new Map<string, FantasyPlayerLine>();
    for (const pl of myStanding?.players ?? []) m.set(pl.playerId, pl);
    return m;
  }, [myStanding]);
  const teamById = useMemo(() => {
    const m = new Map<string, TeamRef>();
    for (const p of pool ?? []) m.set(p.team.id, p.team);
    return m;
  }, [pool]);
  const available = useMemo(() => {
    let list = (pool ?? []).filter((p) => !taken.has(p.id));
    if (posFilter !== "ALL") list = list.filter((p) => p.position === posFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.team.name.toLowerCase().includes(q));
    const byTeam = (a: PoolPlayer, b: PoolPlayer) =>
      a.team.name.localeCompare(b.team.name) || a.name.localeCompare(b.name);
    const cmp =
      sort === "az"
        ? (a: PoolPlayer, b: PoolPlayer) => a.name.localeCompare(b.name)
        : sort === "team"
          ? byTeam
          : (a: PoolPlayer, b: PoolPlayer) => (b.proj ?? 0) - (a.proj ?? 0) || byTeam(a, b);
    return [...list].sort(cmp);
  }, [pool, taken, posFilter, search, sort]);

  // Tick once a second only while a clock is running, to drive the countdown.
  const deadline = data?.deadline ?? null;
  useEffect(() => {
    if (deadline == null || data?.status !== "active") return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline, data?.status]);
  // When the clock hits zero, fire autopick once for this pick (the server is
  // idempotent, so it's harmless if several clients fire at once).
  const curPick = data?.currentPickNumber;
  useEffect(() => {
    if (deadline == null || data?.status !== "active" || curPick == null) return;
    if (nowTs >= deadline && autopickFired.current !== curPick) {
      autopickFired.current = curPick;
      api.autopick().then(setData).catch(() => refresh());
    }
  }, [nowTs, deadline, data?.status, curPick, setData, refresh]);

  if (loading && !data) return <Spinner label="Loading the draft…" />;
  if (!data) return <p className="font-mono text-xs text-flag">Couldn't load the draft.</p>;

  const myTurn = data.onTheClockMemberId === me && data.status === "active";
  const onClock = data.order.find((m) => m.id === data.onTheClockMemberId);
  const myAuto = !!(me && data.autoMemberIds.includes(me));
  const onClockAuto = !!(data.onTheClockMemberId && data.autoMemberIds.includes(data.onTheClockMemberId));
  const squadSize = data.squad.GK + data.squad.DEF + data.squad.MID + data.squad.FWD;
  const transfersLeft =
    data.status === "done"
      ? data.transfersPerRound * data.completedRounds - data.myTransfersUsed
      : 0;
  // Teams whose match this round has kicked off — frozen for transfers. Non-empty only while
  // a round is in play; a player/pool team in it can't be swapped until the round ends.
  const lockedTeams = new Set(data.lockedTeams ?? []);
  const roundInPlay = lockedTeams.size > 0;
  const countAt = (pos: Position) => myPicks.filter((p) => p.position === pos).length;
  const needAt = (pos: Position) => data.squad[pos] - countAt(pos);

  async function pick(playerId: string) {
    setError(null);
    setPicking(playerId);
    try {
      setData(await api.pick(playerId));
    } catch (e: any) {
      setError(e.message);
      await refresh();
    } finally {
      setPicking(null);
    }
  }
  async function start() {
    setError(null);
    try {
      setData(await api.startDraft());
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function resume() {
    setError(null);
    try {
      setData(await api.resumeDraft());
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function reset() {
    setError(null);
    try {
      setData(await api.resetDraft());
      setConfirmReset(false);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function setCaptain(round: string, playerId: string) {
    setError(null);
    setPicking(playerId);
    try {
      setData(await api.setCaptain(round, playerId));
      setCaptainRound(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPicking(null);
    }
  }
  async function playChip(chip: string, round: string | null) {
    setError(null);
    setPlayingChip(true);
    try {
      setData(await api.playChip(chip, round));
      setChipOpen(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPlayingChip(false);
    }
  }
  async function transfer(dropId: string, addId: string) {
    setError(null);
    setPicking(addId);
    try {
      setData(await api.transfer(dropId, addId));
      setDropTarget(null);
      setSearch("");
    } catch (e: any) {
      setError(e.message);
      await refresh();
    } finally {
      setPicking(null);
    }
  }

  if (data.status === "pending") {
    return (
      <div className="animate-rise space-y-5">
        <Header status="Not started" tone="neutral" />
        <div className="space-y-3 rounded-lg border border-edge bg-panel p-6 text-center">
          <p className="text-sm text-bone/75">
            Waiting for the commissioner to start the player draft. Each manager builds a squad of{" "}
            <b className="text-bone">
              {data.squad.GK} GK · {data.squad.DEF} DEF · {data.squad.MID} MID · {data.squad.FWD} FWD
            </b>{" "}
            and they score real fantasy points.
          </p>
          {session?.isCommissioner && (
            <Button onClick={start} variant="gold">
              Start player draft
            </Button>
          )}
          {error && <p className="font-mono text-xs text-flag">{error}</p>}
          <Link to="/league" className="block font-mono text-[11px] uppercase tracking-wider text-bone-dim hover:text-bone">
            ← Back to league
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-5">
      <Header
        status={data.status === "done" ? "Complete" : "Live"}
        tone={data.status === "done" ? "gold" : "lime"}
        right={<Updated at={lastUpdated} />}
      />

      {session?.isCommissioner && (
        <div className="flex items-center justify-end gap-2">
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="font-mono text-[11px] uppercase tracking-wider text-bone-dim transition-colors hover:text-flag"
            >
              ↺ Reset draft
            </button>
          ) : (
            <>
              <span className="font-mono text-[11px] uppercase tracking-wide text-flag">
                Wipe all squads &amp; re-draft?
              </span>
              <button onClick={() => setConfirmReset(false)} className="font-mono text-[11px] uppercase tracking-wider text-bone-dim">
                Cancel
              </button>
              <button onClick={reset} className="rounded-md bg-flag px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink">
                Confirm reset
              </button>
            </>
          )}
        </div>
      )}

      {data.status === "active" && (
        <div className={cx("flex items-center gap-4 rounded-lg border p-4", myTurn ? "border-lime bg-lime/10" : "border-edge bg-panel")}>
          <span className="font-display text-4xl tabular-nums text-bone-dim">
            {String(data.currentPickNumber).padStart(2, "0")}
          </span>
          <div>
            <Kicker>
              Pick {data.currentPickNumber} of {data.totalPicks} · on the clock
            </Kicker>
            <p className={cx("font-display text-2xl uppercase leading-none tracking-tight", myTurn && "text-lime")}>
              {myTurn ? "You're up!" : (onClock?.name ?? "—")}
            </p>
          </div>
          {data.deadline != null && (
            <div className="ml-auto text-right">
              {onClockAuto ? (
                <>
                  <div className="font-display text-2xl uppercase leading-none text-bone-dim">AUTO</div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-bone-dim">on autopick</div>
                </>
              ) : (
                <>
                  <div
                    className={cx(
                      "font-display text-3xl tabular-nums leading-none",
                      data.deadline - nowTs <= 0
                        ? "text-flag"
                        : data.deadline - nowTs < 10000
                          ? "animate-pulse text-flag"
                          : "text-bone"
                    )}
                  >
                    {data.deadline - nowTs <= 0 ? "—" : fmtRemaining(data.deadline - nowTs)}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-bone-dim">
                    {data.deadline - nowTs <= 0 ? "autopicking…" : "auto-pick in"}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {myAuto && data.status === "active" && (
        <div className="flex items-center gap-3 rounded-lg border border-gold/40 bg-gold/10 p-3">
          <span className="text-base">🤖</span>
          <span className="flex-1 text-sm text-bone/85">
            You're on <b className="text-gold">autopick</b> — your turns fill automatically from the
            board.
          </span>
          <Button onClick={resume} variant="gold">
            Take control
          </Button>
        </div>
      )}

      {error && <p className="font-mono text-xs text-flag">{error}</p>}

      <div className="flex gap-1.5">
        {([
          ["draft", data.status === "done" ? "My squad" : "The Draft"],
          ["rosters", "Rosters"],
          ["board", "Board"],
          ...(data.status === "done" ? [["transfers", "Transfers"] as const] : []),
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={cx(
              "flex-1 rounded-md py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
              view === k ? "bg-bone text-ink" : "border border-edge text-bone-dim hover:text-bone"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "board" && <DraftBoard data={data} me={me} teamById={teamById} />}

      {view === "rosters" && <Rosters data={data} me={me} teamById={teamById} />}

      {view === "transfers" && <TransferLog />}

      {view === "draft" && me && (
        <section>
          <SectionLabel
            right={
              data.status === "done" ? (
                <span className={transfersLeft > 0 ? "text-lime" : "text-bone-dim"}>
                  {transfersLeft} transfer{transfersLeft !== 1 ? "s" : ""} left
                </span>
              ) : (
                `${myPicks.length}/${squadSize}`
              )
            }
          >
            Your squad
          </SectionLabel>

          {data.status === "done" && myStanding && (
            <div className="mb-3 flex items-center gap-4 rounded-lg border border-edge bg-panel px-4 py-3">
              <div>
                <div className="font-display text-3xl leading-none tabular-nums text-lime">
                  {myStanding.points}
                </div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-bone-dim">
                  total pts
                </div>
              </div>
              {myRank && (
                <div className="border-l border-edge pl-4">
                  <div className="font-display text-2xl leading-none tabular-nums text-bone">#{myRank}</div>
                  <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-bone-dim">
                    of {standings!.length}
                  </div>
                </div>
              )}
              <div className="ml-auto text-right">
                <div
                  className={cx(
                    "font-display text-2xl leading-none tabular-nums",
                    transfersLeft > 0 ? "text-lime" : "text-bone-dim"
                  )}
                >
                  {transfersLeft}
                </div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-bone-dim">
                  transfers
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {POSITIONS.map((pos) => (
              <div key={pos} className="rounded-lg border border-edge bg-panel p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-bone-dim">
                    {pos}
                  </span>
                  <span className={cx("font-mono text-[10px]", needAt(pos) > 0 ? "text-lime" : "text-bone-dim/50")}>
                    {countAt(pos)}/{data.squad[pos]}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {myPicks
                    .filter((p) => p.position === pos)
                    .map((p) => {
                      const line = lineByPlayer.get(p.playerId);
                      const canDrop =
                        data.status === "done" && transfersLeft > 0 && !lockedTeams.has(p.teamId);
                      const out = !!line?.eliminated;
                      return (
                        <li
                          key={p.playerId}
                          className={cx(
                            "flex items-center gap-2 rounded px-1 py-0.5 text-xs",
                            dropTarget?.playerId === p.playerId && "bg-flag/15"
                          )}
                        >
                          <button
                            onClick={() => openPlayer(p.playerId)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left transition-opacity hover:opacity-70"
                          >
                            <Flag
                              team={teamById.get(p.teamId) ?? { id: p.teamId, name: p.country, abbr: p.country }}
                              size={14}
                            />
                            {out && <span className="shrink-0" title="team eliminated">🪦</span>}
                            <span className={cx("truncate", out ? "text-bone-dim/50 line-through" : "text-bone/85")}>
                              {p.playerName}
                            </span>
                          </button>
                          {line && (
                            <span
                              className={cx(
                                "shrink-0 font-mono text-xs font-bold tabular-nums",
                                out ? "text-bone-dim/50" : "text-lime"
                              )}
                            >
                              {line.points}
                            </span>
                          )}
                          {canDrop && (
                            <button
                              onClick={() =>
                                setDropTarget({
                                  playerId: p.playerId,
                                  playerName: p.playerName,
                                  position: p.position,
                                })
                              }
                              title="Transfer this player out"
                              className="shrink-0 rounded px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-flag/60 transition-colors hover:bg-flag/15 hover:text-flag"
                            >
                              drop
                            </button>
                          )}
                        </li>
                      );
                    })}
                  {Array.from({ length: Math.max(0, needAt(pos)) }).map((_, i) => (
                    <li key={`e${i}`} className="px-1 font-mono text-[10px] text-bone-dim/40">
                      — open —
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {view === "draft" && data.status === "done" && (data.captainRounds.length > 0 || data.chips.length > 0) && (
        <section>
          <SectionLabel>Manage your squad</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {/* Captain — only the rounds you can still act on */}
            {data.captainRounds.length > 0 && (
              <div className="rounded-lg border border-edge bg-panel p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-bone-dim">
                    © Captain
                  </span>
                  <span className="font-mono text-[9px] text-bone-dim/50">scores 2×</span>
                </div>
                {(() => {
                  const active = data.captainRounds.filter((cr) => !cr.locked);
                  if (active.length === 0)
                    return (
                      <p className="font-mono text-[10px] text-bone-dim/50">Every round has kicked off.</p>
                    );
                  return (
                    <div className="space-y-1">
                      {active.map((cr) => {
                        const cap = myPicks.find((p) => p.playerId === cr.captainPlayerId);
                        const open = captainRound === cr.round;
                        return (
                          <div key={cr.round} className="rounded-md border border-edge/60 bg-black/20">
                            <button
                              onClick={() => setCaptainRound(open ? null : cr.round)}
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
                            >
                              <span className="w-8 shrink-0 font-mono text-[9px] font-bold uppercase text-bone-dim">
                                {cr.round}
                              </span>
                              {cap ? (
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="text-gold">©</span>
                                  <Flag team={teamById.get(cap.teamId) ?? { id: cap.teamId, name: cap.country, abbr: cap.country }} size={12} />
                                  <span className="truncate text-bone/85">{cap.playerName}</span>
                                </span>
                              ) : (
                                <span className="font-mono text-[10px] uppercase tracking-wide text-lime/70">pick ©</span>
                              )}
                              <span className="ml-auto shrink-0 font-mono text-[9px] text-lime">
                                {open ? "▾" : "▸"}
                              </span>
                            </button>
                            {open && (
                              <div className="grid grid-cols-2 gap-1 border-t border-edge/60 p-1.5">
                                {myPicks.map((p) => (
                                  <button
                                    key={p.playerId}
                                    disabled={picking != null}
                                    onClick={() => setCaptain(cr.round, p.playerId)}
                                    className={cx(
                                      "flex items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] transition-colors",
                                      p.playerId === cr.captainPlayerId
                                        ? "bg-gold/20 text-gold"
                                        : "text-bone/80 hover:bg-white/5",
                                      picking === p.playerId && "opacity-40"
                                    )}
                                  >
                                    <span className="font-mono text-[8px] text-bone-dim">{p.position}</span>
                                    <span className="truncate">{p.playerName}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Chip */}
            {data.chips.length > 0 &&
              data.chips.map((ch) => {
                const meta = CHIPS.find((c) => c.id === ch.chip)!;
                const open = chipOpen === ch.chip;
                const roundLabel = ch.round;
                return (
                  <div key={ch.chip} className="rounded-lg border border-edge bg-panel p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-bone-dim">
                        {meta.emoji} {meta.name}
                      </span>
                      <span className="font-mono text-[9px] text-bone-dim/50">one use</span>
                    </div>
                    <button
                      disabled={ch.committed}
                      onClick={() => setChipOpen(open ? null : ch.chip)}
                      className={cx(
                        "flex w-full items-center gap-2 rounded-md border border-edge/60 bg-black/20 px-2 py-1.5 text-left text-xs",
                        ch.committed && "opacity-60"
                      )}
                    >
                      <span className="min-w-0 truncate text-bone/75">{meta.blurb}</span>
                      <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider">
                        {ch.round ? (
                          ch.committed ? (
                            <span className="text-gold">🔒 {roundLabel}</span>
                          ) : (
                            <span className="text-lime">{roundLabel} ▾</span>
                          )
                        ) : (
                          <span className="text-lime">{open ? "▾" : "play ▸"}</span>
                        )}
                      </span>
                    </button>
                    {open && !ch.committed && (
                      <div className="mt-1.5">
                        <div className="flex flex-wrap gap-1">
                          {data.captainRounds
                            .filter((cr) => !cr.locked || ch.round === cr.round)
                            .map((cr) => {
                              const isMine = ch.round === cr.round;
                              const disabled = cr.locked || playingChip;
                              return (
                                <button
                                  key={cr.round}
                                  disabled={disabled && !isMine}
                                  onClick={() => playChip(ch.chip, isMine ? null : cr.round)}
                                  className={cx(
                                    "rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors",
                                    isMine ? "bg-gold/20 text-gold" : "text-bone/80 hover:bg-white/5",
                                    disabled && !isMine && "cursor-not-allowed opacity-30"
                                  )}
                                >
                                  {cr.round}
                                </button>
                              );
                            })}
                        </div>
                        <p className="mt-1.5 text-[10px] leading-snug text-bone-dim/60">
                          {ch.round ? "Tap the lit round to cancel. " : ""}
                          Fires on the round you pick; locks when it kicks off.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Transfers — slim status bar (the swap itself happens by tapping a squad player above) */}
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge bg-panel/60 px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-bone">
              🔄 Transfers
            </span>
            <span
              className={cx(
                "font-mono text-[10px] font-bold uppercase tracking-wider",
                transfersLeft > 0 ? "text-lime" : "text-bone-dim"
              )}
            >
              {transfersLeft > 0
                ? `${transfersLeft} available`
                : data.completedRounds === 0
                  ? "opens after R32"
                  : "none left"}
            </span>
            <span className="ml-auto truncate text-[11px] text-bone-dim/70">
              {roundInPlay
                ? "round in play — only players who haven't kicked off yet"
                : transfersLeft > 0
                  ? "tap a squad player to swap"
                  : data.completedRounds === 0
                    ? "unlock after the first round"
                    : `+${data.transfersPerRound} next round`}
            </span>
          </div>
        </section>
      )}

      {view === "draft" && data.status === "done" && dropTarget && (
        <section>
          <SectionLabel
            right={
              <button onClick={() => setDropTarget(null)} className="text-bone-dim hover:text-bone">
                cancel
              </button>
            }
          >
            Replace {dropTarget.playerName} → pick a {dropTarget.position}
          </SectionLabel>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${dropTarget.position}s…`}
            className="mb-2 w-full rounded-md border border-edge bg-black/30 px-3 py-2 text-sm text-bone outline-none placeholder:text-bone-dim/50 focus:border-lime"
          />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {available
              .filter((p) => p.position === dropTarget.position && !lockedTeams.has(p.team.id))
              .slice(0, 40)
              .map((p) => (
                <button
                  key={p.id}
                  disabled={picking != null}
                  onClick={() => transfer(dropTarget.playerId, p.id)}
                  className={cx(
                    "flex items-center gap-2 rounded-md border border-edge bg-panel px-2.5 py-2 text-left text-sm transition-colors hover:border-lime hover:bg-lime/10",
                    picking === p.id && "opacity-40"
                  )}
                >
                  <Tier tier={p.tier} />
                  <Flag team={p.team} size={16} />
                  <span className="truncate">{p.name}</span>
                  {p.projMatches != null && (
                    <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-bone-dim">
                      {p.projMatches.toFixed(1)}<span className="text-bone-dim/40">×</span>
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[9px] uppercase text-bone-dim/70">
                    {p.team.abbr}
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}
      {view === "draft" && data.status !== "done" && (
        <section>
          <SectionLabel right={`${available.length} available`}>Player pool</SectionLabel>
          {myTurn && (
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-lime">
              You still need:{" "}
              {POSITIONS.filter((pos) => needAt(pos) > 0)
                .map((pos) => `${needAt(pos)} ${pos}`)
                .join(" · ") || "nothing — squad full"}
            </p>
          )}
          <div className="mb-2 flex gap-1.5">
            {(["ALL", ...POSITIONS] as const).map((f) => (
              <button
                key={f}
                onClick={() => setPosFilter(f as Position | "ALL")}
                className={cx(
                  "flex-1 rounded-md py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                  posFilter === f ? "bg-lime text-ink" : "border border-edge text-bone-dim hover:text-bone"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-bone-dim/60">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={cx(
                  "rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                  sort === s.key ? "bg-gold text-ink" : "border border-edge text-bone-dim hover:text-bone"
                )}
              >
                {s.label}
              </button>
            ))}
            {sort === "proj" && (
              <span className="ml-auto font-mono text-[9px] uppercase tracking-wide text-bone-dim/50">
                ● tier · proj games
              </span>
            )}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player or country…"
            className="mb-2 w-full rounded-md border border-edge bg-black/30 px-3 py-2 text-sm text-bone outline-none placeholder:text-bone-dim/50 focus:border-lime"
          />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {available.slice(0, 60).map((p) => {
              const canPick = myTurn && needAt(p.position) > 0 && picking == null;
              return (
                <button
                  key={p.id}
                  disabled={!canPick}
                  onClick={() => pick(p.id)}
                  title={myTurn && needAt(p.position) <= 0 ? `Your ${p.position} slots are full` : undefined}
                  className={cx(
                    "flex items-center gap-2 rounded-md border border-edge bg-panel px-2.5 py-2 text-left text-sm transition-colors",
                    canPick ? "hover:border-lime hover:bg-lime/10" : "cursor-not-allowed opacity-50",
                    picking === p.id && "opacity-40"
                  )}
                >
                  <span className="grid h-5 w-8 shrink-0 place-items-center rounded-sm bg-black/40 font-mono text-[9px] font-bold text-bone-dim">
                    {p.position}
                  </span>
                  <Tier tier={p.tier} />
                  <Flag team={p.team} size={16} />
                  <span className="truncate">{p.name}</span>
                  {p.projMatches != null && (
                    <span
                      className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-bone-dim"
                      title="Projected remaining matches their team plays"
                    >
                      {p.projMatches.toFixed(1)}<span className="text-bone-dim/40">×</span>
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[9px] uppercase text-bone-dim/70">{p.team.abbr}</span>
                </button>
              );
            })}
          </div>
          {available.length > 60 && (
            <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wide text-bone-dim">
              +{available.length - 60} more — refine with search or position
            </p>
          )}
          {!myTurn && data.status === "active" && (
            <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-wide text-bone-dim">
              waiting for {onClock?.name} to pick…
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Header({
  status,
  tone,
  right,
}: {
  status: string;
  tone: "neutral" | "lime" | "gold";
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="font-display text-3xl uppercase leading-none tracking-tight sm:text-4xl">
        The Draft
      </h1>
      <div className="flex items-center gap-3">
        {right}
        <Pill tone={tone}>{status}</Pill>
      </div>
    </div>
  );
}
