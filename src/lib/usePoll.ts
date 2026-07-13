import { useCallback, useEffect, useRef, useState } from "react";

// Polls `fn` every intervalMs. Re-runs when any dep changes. Returns data plus
// a manual refresh(). This is how the "real-time" updates work on a serverless
// backend: the browser quietly re-asks the Worker, which serves fresh-or-cached
// ESPN data.
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await fnRef.current();
        if (alive) {
          setData(d);
          setError(null);
          setLastUpdated(Date.now());
        }
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Something went wrong");
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(tick, intervalMs);
        }
      }
    };
    setLoading(true);
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    }
  }, []);

  return { data, error, loading, lastUpdated, refresh, setData };
}
