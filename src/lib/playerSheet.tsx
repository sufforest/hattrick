import { createContext, useContext, useState, type ReactNode } from "react";
import PlayerCardSheet from "../components/PlayerCardSheet";

// App-wide player detail sheet: any component calls usePlayerSheet()(playerId) to pop the
// stats card. The sheet is rendered once here (portaled to <body>), so wiring a name
// anywhere in the app is a one-liner and there's only ever one card open.
const Ctx = createContext<(playerId: string) => void>(() => {});

export const usePlayerSheet = () => useContext(Ctx);

export function PlayerSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Ctx.Provider value={setOpen}>
      {children}
      {open && <PlayerCardSheet playerId={open} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  );
}
