import { Link } from "react-router-dom";
import { Kicker } from "../components/bits";

export default function HowToPlay() {
  return (
    <div className="animate-rise mx-auto max-w-2xl space-y-8 pb-8">
      <header>
        <Kicker>The rules</Kicker>
        <h1 className="font-display text-5xl uppercase leading-[0.9] tracking-tight sm:text-6xl">
          How to <span className="text-lime">play</span>
        </h1>
        <p className="mt-3 text-bone/75">
          Three games, one World Cup knockout. Predict, draft, and out-call your friends — all scored
          automatically from real results.
        </p>
      </header>

      <Step n="01" title="Join your league">
        No passwords. Your commissioner shares a 5-letter code (or a link) — open it, type a name,
        you're in. Grab your personal <b className="text-bone">login link</b> on your Profile to sign
        in on any device.
      </Step>

      <Game emoji="🟢" title="The Draft" tag="fantasy · the deep one">
        <p>
          The draft has the most to it, so it's worth a read. Each manager{" "}
          <b className="text-bone">snake-drafts</b> a squad of 11 from the 32 knockout teams — pick
          order runs 1→N, then flips N→1 each round, so no one's stuck picking last every time. Every
          player is owned by <b className="text-bone">one</b> manager and earns real fantasy points
          all tournament. Your whole squad scores — and each knockout round you name a{" "}
          <b className="text-bone">captain</b> whose points that round count <b className="text-bone">double</b>.
        </p>
        <p>
          <b className="text-bone">Opting in:</b> the draft is opt-in — tap “drafting” on the league
          page before it starts (not into it? skip it and still play the other two). The commissioner
          sets the <b className="text-bone">formation</b> everyone drafts (default 4-4-2) and,
          optionally, a <b className="text-bone">pick clock</b> that auto-picks the best available if
          you stall.
        </p>
        <p className="rounded-md border border-gold/30 bg-gold/[0.06] p-3 text-bone/85">
          <b className="text-gold">The one big idea:</b> it's a knockout, so a player only scores
          while their team is alive. A striker whose team exits in the Round of 32 plays once; a
          defender on the finalist plays up to seven times. Draft for <b className="text-bone">
          survival</b>, not just star power — and spread across teams so you've still got eleven
          players standing in the semis. (The board's projection ranks players on exactly this.)
        </p>
        <Scoring
          items={[
            "Appearance +1 · goal: FWD 4 · MID 5 · DEF/GK 6 · assist 3",
            "Clean sheet: DEF/GK 4 · MID 1 — team concedes 0 & you play 60+ min",
            "GK save 1 per 3 · −1 per 2 conceded",
            "Yellow −1 · red −3 · own goal −2",
            "© Captain — your pick's points that round count 2×",
            "Giant-killer — points in a round your player's team won as an underdog get boosted",
          ]}
        />
        <p className="text-bone-dim">
          <b className="text-bone/70">Transfers:</b> once the draft's done you get 2 swaps per
          completed round — drop a player for a free agent of the same position (the dropped player's
          points bank at the moment you let them go).
        </p>
        <p className="text-bone-dim">
          <b className="text-bone/70">Chip:</b> one one-time power-up —{" "}
          <b className="text-bone/70">🔥 Triple Captain</b>, played once all tournament on a round you
          choose: your captain scores ×3 that round instead of ×2. It locks in when the round kicks
          off, so it's all timing — gamble it early, or save it for the final?
        </p>
        <p className="text-bone-dim">
          <b className="text-bone/70">Two tables:</b> total points, plus a{" "}
          <b className="text-bone/70">head-to-head</b> record — each round you're scored against every
          other manager on that round's points (win 3, draw 1), so there's always a rival to beat.
        </p>
      </Game>

      <Game emoji="🏆" title="The Bracket" tag="predict the whole tree">
        <p>
          Fill out the bracket — pick the winner of every match, Round of 32 to the Final. Picks lock
          at each match's kickoff and finished matches fill in automatically. Classic commit-and-bust:
          a busted line stays busted, so be bold early.
        </p>
        <Scoring
          items={[
            "Correct winner — R32 10 · R16 20 · QF 40 · SF 80 · Final 160",
            "× an upset bonus: chalk earns full value, correctly calling an underdog up to 3×",
          ]}
        />
      </Game>

      <Game emoji="🎯" title="Matchday Predictions" tag="a quick slate every match">
        <p>
          Before each kickoff, call the game: who advances, the exact score, over/under goals, both
          teams to score, and whether it goes to extra time or penalties. Your <b className="text-bone">
          winner and exact score must agree</b> — a decisive score sets the winner; a tie lets you call
          the shootout. Locks at kickoff; everyone's picks reveal once it starts.
        </p>
        <Scoring
          items={[
            "Winner (upset-weighted) · exact score 50 · goals O/U 15 · BTTS 15 · extra-time/pens 20",
            "Exact score is all-or-nothing — nail it for the full 50, otherwise 0",
            "Winner is upset-weighted: calling a favorite pays less, an underdog more (up to 3×)",
          ]}
        />
      </Game>

      <Game emoji="📈" title="Why “beat the odds”?" tag="no bias — just the market">
        <p>
          Every result is weighted by the betting line frozen at kickoff, so the skill is spotting
          what the market underrates — not just picking favorites. We don't decide who's strong; the
          closing odds do (and they already price in injuries, lineups, and form).
        </p>
      </Game>

      <div className="rounded-lg border border-lime/30 bg-lime/[0.05] p-4 text-center text-sm text-bone/80">
        Three separate leaderboards on{" "}
        <Link to="/standings" className="font-semibold text-lime underline">
          the Table
        </Link>{" "}
        — Draft, Bracket, Predictions. Win one, win them all, or just talk a big game.
      </div>

      <div className="text-center">
        <Link
          to="/"
          className="font-mono text-[11px] uppercase tracking-wider text-bone-dim hover:text-bone"
        >
          ← Back to scores
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="font-display text-3xl leading-none text-lime">{n}</span>
      <div>
        <h2 className="font-display text-xl uppercase tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-bone/75">{children}</p>
      </div>
    </div>
  );
}

function Game({
  emoji,
  title,
  tag,
  children,
}: {
  emoji: string;
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-edge bg-panel p-5">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-display text-2xl uppercase tracking-tight">
          <span className="mr-1.5">{emoji}</span>
          {title}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-bone-dim">{tag}</span>
      </div>
      <div className="space-y-3 text-sm text-bone/85">{children}</div>
    </section>
  );
}

function Scoring({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 rounded-md border border-edge bg-black/20 p-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 font-mono text-[11px] text-bone/80">
          <span className="text-lime">▸</span>
          {it}
        </li>
      ))}
    </ul>
  );
}
