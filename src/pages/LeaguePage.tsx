import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import type { League } from "../../shared/types";
import { FORMATIONS, PICK_CLOCKS, squadFromFormation } from "../../shared/types";

const CLOCK_LABEL: Record<number, string> = { 0: "Off", 60: "1 min", 600: "10 min", 3600: "1 hour" };
import { useSession } from "../lib/session";
import { Button, SectionLabel, Pill, Kicker, Spinner, cx } from "../components/bits";
import Feed from "../components/Feed";

export default function LeaguePage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const { data: league, loading, refresh } = usePoll<League>(api.league, 10000);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (loading && !league) return <Spinner label="Loading your league…" />;
  if (!league) return <p className="font-mono text-xs text-flag">{error ?? "League not found."}</p>;

  const isCommish = session?.isCommissioner;
  const inDraftCount = league.members.filter((m) => m.inDraft).length;
  const joinLink = `${window.location.origin}/start?code=${league.code}`;

  async function copy() {
    await navigator.clipboard.writeText(joinLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function startDraft() {
    setError(null);
    setBusy(true);
    try {
      await api.startDraft();
      navigate("/draft");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleLock() {
    setBusy(true);
    try {
      await api.lockBracket(!league!.bracketLocked);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function removeMember(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.removeMember(id);
      setConfirmRemove(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleDraft(id: string, inDraft: boolean) {
    setError(null);
    setBusy(true);
    try {
      await api.draftOptIn(inDraft, id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function chooseFormation(f: string) {
    setError(null);
    setBusy(true);
    try {
      await api.setFormation(f);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function chooseClock(seconds: number) {
    setError(null);
    setBusy(true);
    try {
      await api.setClock(seconds);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const statusTone =
    league.draftStatus === "active" ? "lime" : league.draftStatus === "done" ? "gold" : "neutral";
  const statusText =
    league.draftStatus === "pending"
      ? "Draft not started"
      : league.draftStatus === "active"
        ? "Draft live"
        : "Draft complete";

  return (
    <div className="animate-rise space-y-6">
      <div>
        <Kicker>League</Kicker>
        <h1 className="font-display text-3xl uppercase leading-none tracking-tight sm:text-4xl">
          {league.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone={statusTone as any}>{statusText}</Pill>
          <Pill>
            {league.members.length} player{league.members.length !== 1 ? "s" : ""}
          </Pill>
          <Pill>⚽ {league.formation}</Pill>
          {league.bracketLocked && <Pill tone="gold">🔒 bracket locked</Pill>}
        </div>
      </div>

      <Link
        to="/profile"
        className="inline-flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-bone-dim transition-colors hover:border-lime/50 hover:text-bone"
      >
        ⚙ Your profile & login link →
      </Link>

      <section className="rounded-lg border border-lime/30 bg-lime/[0.05] p-4">
        <SectionLabel right={copied ? <span className="text-lime">copied!</span> : undefined}>
          Invite friends
        </SectionLabel>
        <div className="flex items-center gap-3">
          <span className="font-display text-5xl tracking-[0.15em] text-lime">{league.code}</span>
          <Button variant="ghost" onClick={copy} className="ml-auto">
            Copy link
          </Button>
        </div>
        <p className="mt-2 break-all font-mono text-[11px] text-bone-dim">{joinLink}</p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NavCard to="/draft" n="01" title="Draft" subtitle="Build a squad" />
        <NavCard to="/bracket" n="02" title="Bracket" subtitle="Fill the tree" />
        <NavCard to="/" n="03" title="Predict" subtitle="Call each match" />
        <NavCard to="/standings" n="04" title="Table" subtitle="Standings" />
      </div>

      {isCommish && (
        <section className="rounded-lg border border-edge bg-panel p-4">
          <SectionLabel>Commissioner</SectionLabel>
          {error && <p className="mb-2 font-mono text-xs text-flag">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {league.draftStatus === "pending" && (
              <Button onClick={startDraft} disabled={busy || inDraftCount < 2} variant="gold">
                {inDraftCount < 2 ? "Need ≥2 in draft" : `Start snake draft (${inDraftCount})`}
              </Button>
            )}
            <Button onClick={toggleLock} disabled={busy} variant="ghost">
              {league.bracketLocked ? "Unlock bracket" : "Lock bracket"}
            </Button>
          </div>
          {league.draftStatus === "pending" && (
            <div className="mt-3">
              {(() => {
                const sq = squadFromFormation(league.formation);
                return (
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-bone-dim">
                    Formation · everyone drafts{" "}
                    <b className="text-bone">
                      {sq.GK} GK · {sq.DEF} DEF · {sq.MID} MID · {sq.FWD} FWD
                    </b>
                  </p>
                );
              })()}
              <div className="flex flex-wrap gap-1.5">
                {FORMATIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => chooseFormation(f)}
                    disabled={busy}
                    className={cx(
                      "rounded-md px-2.5 py-1.5 font-mono text-[11px] font-bold tracking-wider transition-colors",
                      league.formation === f
                        ? "bg-lime text-ink"
                        : "border border-edge text-bone-dim hover:text-bone"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <p className="mb-1.5 mt-3 font-mono text-[10px] uppercase tracking-wide text-bone-dim">
                Pick clock ·{" "}
                <b className="text-bone">
                  {league.pickClockSeconds ? "autopick after " + CLOCK_LABEL[league.pickClockSeconds] : "off"}
                </b>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PICK_CLOCKS.map((s) => (
                  <button
                    key={s}
                    onClick={() => chooseClock(s)}
                    disabled={busy}
                    className={cx(
                      "rounded-md px-2.5 py-1.5 font-mono text-[11px] font-bold tracking-wider transition-colors",
                      league.pickClockSeconds === s
                        ? "bg-lime text-ink"
                        : "border border-edge text-bone-dim hover:text-bone"
                    )}
                  >
                    {CLOCK_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2.5 font-mono text-[10px] uppercase tracking-wide text-bone-dim">
            Only players who opted in get drafted · bracket &amp; predictions are open to all
          </p>
        </section>
      )}

      <section>
        <SectionLabel
          right={
            league.draftStatus === "pending" ? (
              <span className={inDraftCount >= 2 ? "text-lime" : "text-bone-dim/60"}>
                {inDraftCount} of {league.members.length} in draft
              </span>
            ) : undefined
          }
        >
          Players
        </SectionLabel>
        <div className="overflow-hidden rounded-lg border border-edge">
          {league.members
            .slice()
            .sort((a, b) => (a.draftPosition ?? 99) - (b.draftPosition ?? 99))
            .map((m, i) => {
              const canRemove =
                isCommish &&
                league.draftStatus === "pending" &&
                m.id !== session?.memberId &&
                !m.isCommissioner;
              const canToggleDraft =
                league.draftStatus === "pending" && (isCommish || m.id === session?.memberId);
              return (
                <div
                  key={m.id}
                  className={cx(
                    "flex items-center gap-3 px-3 py-2.5",
                    i > 0 && "border-t border-edge",
                    m.id === session?.memberId ? "bg-lime/[0.06]" : "bg-panel"
                  )}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-sm bg-black/40 font-mono text-[11px] font-bold tabular-nums text-bone-dim">
                    {m.draftPosition ?? i + 1}
                  </span>
                  <span
                    className={cx(
                      "text-sm font-semibold",
                      m.id === session?.memberId && "text-lime"
                    )}
                  >
                    {m.name}
                  </span>
                  {m.isCommissioner && <Pill tone="gold">commish</Pill>}
                  <div className="ml-auto flex items-center gap-2">
                    {league.draftStatus === "pending" ? (
                      <button
                        disabled={!canToggleDraft || busy}
                        onClick={() => canToggleDraft && toggleDraft(m.id, !m.inDraft)}
                        title={canToggleDraft ? "Toggle draft participation" : undefined}
                        className={cx(
                          "rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider transition-colors",
                          m.inDraft ? "bg-lime/20 text-lime" : "border border-edge text-bone-dim/60",
                          canToggleDraft && !busy ? "hover:opacity-80" : "cursor-default"
                        )}
                      >
                        {m.inDraft ? "✓ drafting" : "not in draft"}
                      </button>
                    ) : (
                      !m.inDraft && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-bone-dim/50">
                          bracket only
                        </span>
                      )
                    )}
                    {canRemove &&
                      (confirmRemove === m.id ? (
                        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                          <span className="text-flag">remove?</span>
                          <button
                            onClick={() => removeMember(m.id)}
                            disabled={busy}
                            className="font-bold text-flag hover:underline disabled:opacity-50"
                          >
                            yes
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="text-bone-dim hover:text-bone"
                          >
                            no
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(m.id)}
                          title={`Remove ${m.name}`}
                          className="font-mono text-sm text-bone-dim transition-colors hover:text-flag"
                        >
                          ✕
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
        </div>
        {isCommish && league.draftStatus !== "pending" && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-bone-dim/60">
            Players are locked in once the draft starts.
          </p>
        )}
      </section>

      <Feed />
    </div>
  );
}

function NavCard({ to, n, title, subtitle }: { to: string; n: string; title: string; subtitle: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-edge bg-panel p-3 transition-colors hover:border-lime/50 hover:bg-panel-2"
    >
      <span className="font-mono text-[10px] text-bone-dim">{n}</span>
      <p className="font-display text-lg uppercase leading-none tracking-tight group-hover:text-lime">
        {title}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-bone-dim">{subtitle}</p>
    </Link>
  );
}
