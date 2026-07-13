import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import MatchPage from "./pages/MatchPage";
import StartPage from "./pages/StartPage";
import LeaguePage from "./pages/LeaguePage";
import DraftPage from "./pages/DraftPage";
import BracketPage from "./pages/BracketPage";
import StandingsPage from "./pages/StandingsPage";
import ProfilePage from "./pages/ProfilePage";
import LoginPage from "./pages/LoginPage";
import HowToPlay from "./pages/HowToPlay";
import { useSession } from "./lib/session";
import { PlayerSheetProvider } from "./lib/playerSheet";
import type { ReactNode } from "react";

function RequireLeague({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return session ? <>{children}</> : <Navigate to="/start" replace />;
}

export default function App() {
  return (
    <PlayerSheetProvider>
      <Routes>
        <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/match/:id" element={<MatchPage />} />
        <Route path="/start" element={<StartPage />} />
        <Route path="/league" element={<RequireLeague><LeaguePage /></RequireLeague>} />
        <Route path="/draft" element={<RequireLeague><DraftPage /></RequireLeague>} />
        <Route path="/bracket" element={<RequireLeague><BracketPage /></RequireLeague>} />
        <Route path="/standings" element={<RequireLeague><StandingsPage /></RequireLeague>} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile" element={<RequireLeague><ProfilePage /></RequireLeague>} />
        <Route path="/how" element={<HowToPlay />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </PlayerSheetProvider>
  );
}
