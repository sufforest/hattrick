import { createContext, useContext, useState, type ReactNode } from "react";
import type { Session } from "../../shared/types";
import { clearSession, loadSession, saveSession } from "./api";

interface Ctx {
  session: Session | null;
  setSession: (s: Session | null) => void;
}

const SessionContext = createContext<Ctx>({ session: null, setSession: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setS] = useState<Session | null>(() => loadSession());
  const setSession = (s: Session | null) => {
    if (s) saveSession(s);
    else clearSession();
    setS(s);
  };
  return (
    <SessionContext.Provider value={{ session, setSession }}>{children}</SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
