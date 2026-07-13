import type { ReactNode } from "react";
import type { LineupPlayer } from "../../shared/types";

// Commentary text drops accents that the roster keeps (e.g. "Eustaquio" vs
// "Eustáquio"), so we fold both sides to plain lowercase ASCII for matching
// while preserving character positions (1:1) to slice the original text back.
const ACCENTS: Record<string, string> = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a", ā: "a",
  é: "e", è: "e", ê: "e", ë: "e", ē: "e",
  í: "i", ì: "i", î: "i", ï: "i", ī: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o", ø: "o", ō: "o",
  ú: "u", ù: "u", û: "u", ü: "u", ū: "u",
  ñ: "n", ç: "c", ý: "y", ÿ: "y",
  š: "s", ś: "s", ž: "z", ź: "z", ż: "z", č: "c", ć: "c", č̌: "c",
  đ: "d", ð: "d", ř: "r", ł: "l", ğ: "g", ş: "s", ț: "t", ş̧: "s",
};

function foldLower(s: string): string {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    const f = ACCENTS[low] ?? low;
    out += f.length === 1 ? f : ch;
  }
  return out;
}

const isAlpha = (c: string | undefined) => !!c && /[a-z]/.test(c);

// Returns the commentary text split into plain strings + clickable player spans.
export function linkifyPlayers(
  text: string,
  players: LineupPlayer[],
  onSelect: (p: LineupPlayer) => void
): ReactNode[] {
  if (!players.length || !text) return [text];
  const ft = foldLower(text);
  const cands = players
    .map((p) => ({ p, fn: foldLower(p.name) }))
    .filter((c) => c.fn.length >= 4)
    .sort((a, b) => b.fn.length - a.fn.length);

  const taken = new Array(text.length).fill(false);
  const ranges: { start: number; end: number; p: LineupPlayer }[] = [];
  for (const c of cands) {
    let from = 0;
    let idx: number;
    while ((idx = ft.indexOf(c.fn, from)) !== -1) {
      const end = idx + c.fn.length;
      const boundaryBefore = idx === 0 || !isAlpha(ft[idx - 1]);
      const boundaryAfter = end >= ft.length || !isAlpha(ft[end]);
      let free = true;
      for (let i = idx; i < end; i++) if (taken[i]) free = false;
      if (boundaryBefore && boundaryAfter && free) {
        ranges.push({ start: idx, end, p: c.p });
        for (let i = idx; i < end; i++) taken[i] = true;
      }
      from = idx + 1;
    }
  }

  if (ranges.length === 0) return [text];
  ranges.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start > pos) nodes.push(text.slice(pos, r.start));
    nodes.push(
      <button
        key={i}
        onClick={() => onSelect(r.p)}
        className="font-semibold text-lime/90 underline decoration-dotted underline-offset-2 hover:text-lime"
      >
        {text.slice(r.start, r.end)}
      </button>
    );
    pos = r.end;
  });
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}
