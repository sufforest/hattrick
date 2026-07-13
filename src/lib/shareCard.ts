// Client-side "broadcast card" generator: draws the manager's standing to a canvas and
// hands it to the native share sheet (→ group chat) with a download fallback. No server
// image rendering needed — perfect for a Workers app.

const C = {
  ink: "#0a0b0a",
  panel: "#121412",
  edge: "#2b322c",
  bone: "#f1eee2",
  boneDim: "#a8a89c",
  lime: "#b8ff2e",
  gold: "#ffc83d",
  flag: "#ff453a",
};

export interface CardData {
  league: string;
  manager: string;
  rank: number;
  totalManagers: number;
  points: number;
  alive: number;
  squadSize: number;
  top: { pos: string; name: string; country: string; points: number }[];
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const ord = (n: number) => {
  const v = n % 100;
  const s = ["th", "st", "nd", "rd"];
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function draw(data: CardData): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d")!;
  const PAD = 80;

  // background + frame
  x.fillStyle = C.ink;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = C.edge;
  x.lineWidth = 2;
  x.strokeRect(28, 28, W - 56, H - 56);
  x.fillStyle = C.lime;
  x.fillRect(28, 28, 10, H - 56); // signature lime spine

  // wordmark
  x.textBaseline = "alphabetic";
  x.font = `800 64px ${SANS}`;
  x.fillStyle = C.bone;
  x.fillText("HAT", PAD, 150);
  const hatW = x.measureText("HAT").width;
  x.fillStyle = C.lime;
  x.fillText("TRICK", PAD + hatW, 150);
  x.font = `600 24px ${MONO}`;
  x.fillStyle = C.boneDim;
  x.fillText(`2026 WORLD CUP · ${data.league.toUpperCase()}`, PAD, 192);

  // manager + rank
  x.font = `800 84px ${SANS}`;
  x.fillStyle = C.bone;
  x.fillText(truncate(x, data.manager, W - PAD * 2), PAD, 320);
  x.font = `700 30px ${MONO}`;
  x.fillStyle = data.rank === 1 ? C.gold : C.lime;
  x.fillText(
    `${data.rank === 1 ? "🏆 " : ""}${ord(data.rank)} of ${data.totalManagers}  ·  ${data.alive}/${data.squadSize} ALIVE`,
    PAD,
    372
  );

  // big points
  x.font = `900 280px ${SANS}`;
  x.fillStyle = C.lime;
  x.fillText(String(data.points), PAD - 6, 660);
  const ptsW = x.measureText(String(data.points)).width;
  x.font = `700 40px ${MONO}`;
  x.fillStyle = C.boneDim;
  x.fillText("PTS", PAD + ptsW + 24, 660);

  // top players
  let y = 770;
  x.font = `700 26px ${MONO}`;
  x.fillStyle = C.boneDim;
  x.fillText("TOP SCORERS", PAD, y);
  y += 18;
  x.strokeStyle = C.edge;
  x.beginPath();
  x.moveTo(PAD, y);
  x.lineTo(W - PAD, y);
  x.stroke();
  y += 52;
  for (const p of data.top.slice(0, 5)) {
    x.font = `700 26px ${MONO}`;
    x.fillStyle = posColor(p.pos);
    x.fillText(p.pos.padEnd(4), PAD, y);
    x.font = `600 40px ${SANS}`;
    x.fillStyle = C.bone;
    x.fillText(truncate(x, p.name, 560), PAD + 110, y);
    x.font = `700 40px ${SANS}`;
    x.fillStyle = C.lime;
    const v = String(p.points);
    x.fillText(v, W - PAD - x.measureText(v).width, y);
    x.font = `500 24px ${MONO}`;
    x.fillStyle = C.boneDim;
    x.fillText(p.country.toUpperCase(), PAD + 110, y + 26);
    y += 84;
  }

  // footer
  x.font = `600 24px ${MONO}`;
  x.fillStyle = C.boneDim;
  x.fillText(location.host, PAD, H - 54);
  x.fillStyle = C.lime;
  x.fillText("⚽", W - PAD - 36, H - 50);

  return cv;
}

function posColor(pos: string): string {
  return pos === "GK" ? C.gold : pos === "FWD" ? C.flag : pos === "MID" ? C.lime : C.boneDim;
}

function truncate(x: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (x.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && x.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function toBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) =>
    cv.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png")
  );
}

// Build the card and share it; returns "shared" | "downloaded".
export async function shareCard(data: CardData): Promise<"shared" | "downloaded"> {
  const blob = await toBlob(draw(data));
  const file = new File([blob], `hattrick-${data.manager.replace(/\s+/g, "-")}.png`, {
    type: "image/png",
  });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: "Hattrick",
        text: `${data.manager} — ${data.points} pts (${ord(data.rank)}) in ${data.league}`,
      });
      return "shared";
    } catch {
      // user cancelled or share failed → fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
