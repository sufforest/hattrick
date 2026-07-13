# ⚽ Hattrick — World Cup Fantasy, Bracket & Predictions

Play **three games** with your friends through the 2026 World Cup knockout stage, all scored
automatically from real results:

- **🟢 Fantasy Draft** — snake-draft a squad of 11 players; they earn FPL-style points all tournament.
- **🏆 Bracket** — predict the whole knockout tree (Round of 32 → Final).
- **🎯 Matchday Predictions** — call each match before kickoff (winner, score, goals, cards, pens…).

Plus **live scores**, tap-in **play-by-play** with clickable player stats, and **lineups**. No
passwords — create a league, share a 5-letter code, friends join with a name (and a personal
magic-link to stay signed in on any device). Hosted entirely on Cloudflare's **free** tier.

---

## How it's played

1. **Create a league** (you're the commissioner) → share the code / invite link. Friends join with a
   name; grab your personal **login link** on your Profile to sign in on any device.
2. **Draft** *(do it together, like a draft night)* — commissioner hits **Start**; take turns (snake
   order) picking players to fill your squad: **1 GK · 4 DEF · 4 MID · 2 FWD**. Locked once complete.
   (Commissioner can **Reset** to re-draft, e.g. if friends arrive late.)
3. **Bracket** — everyone fills the knockout tree. Each pick **locks at that match's kickoff**;
   finished matches fill in automatically.
4. **Predictions** — before each match, open it and fill the prop slate. **Locks at kickoff**;
   everyone's picks reveal once it starts.
5. **Watch** — live scores + play-by-play update on their own; standings recompute as results land.

### How each game scores — and how they interact

A single real result feeds **all three** games, but each keeps its **own leaderboard** — there's no
combined total, so missing one game never tanks your others:

| A real result… | Fantasy Draft | Bracket | Predictions |
|---|---|---|---|
| **Brazil 2–0 Japan** | your Brazil players bank goal / clean-sheet / etc. points | your "Brazil advances" pick scores | your "Brazil win / under 2.5 / 2–0" props resolve |

### Scoring

**Fantasy Draft (per player):** goal — FWD 4 / MID 5 / DEF·GK 6 · assist 3 · clean sheet (DEF/GK) 4,
MID 1 · save 1 per 3 · −1 per 2 conceded · appearance +1 · yellow −1 · red −3 · own goal −2.
A **clean sheet** requires the player's team to concede 0 **and** the player to be on the pitch
for **60+ minutes** (FPL rule) — so late subs and early-subbed starters don't earn one.

**Bracket:** correct winner — R32 10 / R16 20 / QF 40 / SF 80 / Final 160, **× upset bonus** (correctly
calling an underdog scores up to 3×; chalk keeps full value).

**Predictions:** winner 20 (upset-weighted) · exact score 50 · over/under goals 15 · both teams to
score 15 · extra-time/pens 20.

The Bracket & Predictions "upset" weighting comes from the match's **closing betting line** (favorites
pay less, underdogs more) — so it rewards beating the market, not just picking favorites. Tune any
number in `worker/fantasy.ts` (draft) and `worker/scoring.ts` (bracket/predictions).

---

## How it stays fresh (it's serverless)

There's no always-on server. Data stays current three ways, all scaling to **$0** when idle:

1. **Lazy fetch + cache** — when someone opens the app, the Worker fetches ESPN server-side and
   caches it in D1 for ~10–15s; the browser polls every ~15s so scores tick live.
2. **Cron trigger** (every 2 min) — re-warms the cache (scores, odds, player pool, fantasy stats) with
   no visitors, so standings are correct even if nobody's looking.
3. *(Upgrade path)* Durable Objects + WebSockets for true push.

Nothing from ESPN (scores, odds, squads, player stats, lineups) is stored as our own data — it's
fetched and cached. D1 only holds **your** league state (members, draft picks, bracket picks,
predictions).

---

## Run locally

```bash
npm install
npm run db:local      # create the local D1 tables (one time)
npm run dev           # http://localhost:5173
```

## Deploy to Cloudflare (free)

```bash
npx wrangler login
npx wrangler d1 create hattrick-db          # paste the printed database_id into wrangler.jsonc
npm run db:remote                           # create the tables on the real DB
npm run deploy                              # build + deploy (frontend + Worker + cron)
```

Future updates: just `npm run deploy` again. The cron trigger and D1 are both on the free plan.

> Schema changes: `npm run db:remote` re-runs `schema.sql` (which uses `IF NOT EXISTS`); for new
> columns on an existing DB, run an `ALTER TABLE … ADD COLUMN` via `wrangler d1 execute`.

---

## Project layout

```
worker/              Cloudflare Worker (Hono API)
  index.ts           routes: leagues/auth, draft, bracket, predictions, leaderboards, cron
  espn.ts            ESPN client + D1 cache; matches, summaries, odds, player pool, player stats
  fantasy.ts         player-fantasy (FPL) scoring + standings
  bracket.ts         builds the bracket tree from ESPN placeholders
  predictions.ts     matchday prop slate config + grading
  scoring.ts         bracket scoring + the shared upset multiplier
shared/types.ts      types shared by Worker + frontend
src/                 React + Vite + Tailwind frontend
  pages/             Home, Match (tabbed), Draft, Bracket, Standings, League, Profile, Login, HowToPlay
  components/        MatchCard, PredictionSlate, Lineups, PlayerSheet, Collapsible, bits, …
schema.sql           D1 schema
wrangler.jsonc       Cloudflare config (D1, assets, cron)
```

---

## Security & privacy notes

- **No server secrets.** The app needs no API keys — ESPN's endpoints are public and read-only, and
  there's no payment/email integration. Nothing sensitive lives in this repo or its history.
- **Auth is a bearer token, no passwords.** Joining mints a random token stored in `localStorage`
  and sent as `Authorization: Bearer`. The magic-link (`/login?t=<token>`) puts that token in a URL
  so you can sign in on another device — convenient for a friends league, but URL tokens can leak via
  browser history / referrer headers, so treat the link like a password (the app says as much on your
  Profile). If you self-host for a wider audience, consider a real auth flow.
- **Your league data stays in your D1.** Members, picks and predictions live only in *your* database —
  they're never committed here. The `database_id` in `wrangler.jsonc` is just an identifier (not a
  credential); `wrangler d1 create` prints your own to paste in.

## License

[MIT](./LICENSE) © sufforest. Provided as-is, for fun.

Data comes from ESPN's free, unofficial API and can change or break without notice. Not affiliated
with, endorsed by, or sponsored by ESPN or FIFA.
