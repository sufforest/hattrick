import type { Match, RoundCode } from "../../shared/types";

export function kickoff(dateIso: string): string {
  const d = new Date(dateIso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortTime(dateIso: string): string {
  return new Date(dateIso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function isToday(dateIso: string): boolean {
  const d = new Date(dateIso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

export function statusLabel(m: Match): string {
  if (m.state === "in") return m.statusDetail || m.clock || "LIVE";
  if (m.state === "post") return m.statusDetail || "FT";
  return kickoff(m.date);
}

export const ROUND_ORDER: RoundCode[] = ["R32", "R16", "QF", "SF", "F", "3RD"];

export const ROUND_LABEL: Record<RoundCode, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarterfinals",
  SF: "Semifinals",
  F: "Final",
  "3RD": "Third place",
};
