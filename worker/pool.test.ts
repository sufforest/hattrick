import { describe, it, expect, afterEach, vi } from "vitest";
import { getPlayerPool } from "./espn";
import type { Env } from "./espn";

// The pool is built by fetching every knockout nation's roster from ESPN. The bug this pins:
// firing all 32 fetches at once trips ESPN's rate limit, the failed nations are silently
// skipped, and the *partial* pool used to be cached for six hours — so entire squads (Spain,
// mid-tournament, in the Final) vanished from the draftable pool, projections, and the
// leaderboard, where their scorers rendered as bare numeric ids.

const HOUR = 60 * 60 * 1000;

// A fake D1 cache backed by a Map — just enough for cacheGet/cacheSet's two statements.
function fakeEnv() {
  const store = new Map<string, { value: string; expires_at: number }>();
  const DB = {
    prepare(sql: string) {
      const stmt = {
        args: [] as any[],
        bind(...a: any[]) {
          stmt.args = a;
          return stmt;
        },
        async first<T>() {
          return (store.get(stmt.args[0]) as T) ?? null;
        },
        async run() {
          const [key, value, expires_at] = stmt.args;
          store.set(key, { value, expires_at });
          return { success: true };
        },
      };
      void sql;
      return stmt;
    },
  };
  return { env: { DB } as unknown as Env, store };
}

// Pre-seed the knockout matches so getTeams() needs no network — only rosters are fetched.
function seedTeams(store: Map<string, { value: string; expires_at: number }>, n: number) {
  const teams = Array.from({ length: n }, (_, i) => {
    const id = `T${String(i + 1).padStart(2, "0")}`;
    return { id, name: id, abbr: id };
  });
  const matches = [];
  for (let i = 0; i < n; i += 2) {
    matches.push({ round: "R32", home: teams[i], away: teams[i + 1] });
  }
  store.set("espn:knockout", { value: JSON.stringify(matches), expires_at: Date.now() + 1e12 });
  return teams;
}

const roster = (teamId: string) => ({
  athletes: [
    {
      items: [
        { id: `${teamId}-1`, displayName: `${teamId} Keeper`, position: { abbreviation: "G" } },
        { id: `${teamId}-2`, displayName: `${teamId} Striker`, position: { abbreviation: "F" } },
      ],
    },
  ],
});

const teamIdFromUrl = (url: string) => /\/teams\/([^/]+)\/roster/.exec(String(url))?.[1] ?? "";
const remainingMs = (store: Map<string, { expires_at: number }>) =>
  (store.get("espn:playerpool")?.expires_at ?? 0) - Date.now();

afterEach(() => vi.unstubAllGlobals());

describe("getPlayerPool — partial pools must not poison the cache", () => {
  it("caches a COMPLETE pool for the long window", async () => {
    const { env, store } = fakeEnv();
    seedTeams(store, 8);
    vi.stubGlobal("fetch", async (url: string) => ({
      ok: true,
      json: async () => roster(teamIdFromUrl(url)),
    }));

    const pool = await getPlayerPool(env);
    expect(new Set(pool.map((p) => p.team.id)).size).toBe(8); // every nation present
    expect(pool).toHaveLength(16);
    expect(remainingMs(store)).toBeGreaterThan(HOUR); // 6h, not a self-heal window
  });

  it("caches a PARTIAL pool only briefly, so the next request self-heals", async () => {
    const { env, store } = fakeEnv();
    seedTeams(store, 8);
    const down = new Set(["T07", "T08"]); // two nations ESPN rate-limited
    vi.stubGlobal("fetch", async (url: string) => {
      const id = teamIdFromUrl(url);
      if (down.has(id)) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, json: async () => roster(id) };
    });

    const pool = await getPlayerPool(env);
    const covered = new Set(pool.map((p) => p.team.id));
    expect(covered.has("T07")).toBe(false); // the rate-limited nations are missing...
    expect(covered.size).toBe(6);
    const rem = remainingMs(store);
    expect(rem).toBeGreaterThan(0);
    expect(rem).toBeLessThanOrEqual(5 * 60 * 1000); // ...but only cached for a minute, not 6h
  });

  it("a single retry rescues a nation that blips on the first attempt", async () => {
    const { env, store } = fakeEnv();
    seedTeams(store, 8);
    const attempts = new Map<string, number>();
    vi.stubGlobal("fetch", async (url: string) => {
      const id = teamIdFromUrl(url);
      const n = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, n);
      if (id === "T05" && n === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => roster(id) };
    });

    const pool = await getPlayerPool(env);
    expect(new Set(pool.map((p) => p.team.id)).size).toBe(8); // T05 rescued on retry
    expect(attempts.get("T05")).toBe(2);
    expect(remainingMs(store)).toBeGreaterThan(HOUR); // complete again → long cache
  });
});
