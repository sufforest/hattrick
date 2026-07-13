import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { cx } from "./bits";

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cx(
          "whitespace-nowrap rounded-sm px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
          isActive ? "bg-lime text-ink" : "text-bone-dim hover:bg-panel-2 hover:text-bone"
        )
      }
    >
      {label}
    </NavLink>
  );
}

export default function Layout() {
  const { session, setSession } = useSession();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b-2 border-bone/10 bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <button onClick={() => navigate("/")} className="flex items-center gap-2.5 text-left">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-sm text-ink">
              ⚽
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-xl tracking-tight sm:text-2xl">
                HAT<span className="text-lime">TRICK</span>
              </span>
              <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-bone-dim">
                2026 · Knockouts
              </span>
            </span>
          </button>

          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            <Tab to="/" label="Scores" />
            {session && <Tab to="/draft" label="Draft" />}
            {session && <Tab to="/bracket" label="Bracket" />}
            {session && <Tab to="/standings" label="Table" />}
            {session ? (
              <Tab to="/league" label={session.name} />
            ) : (
              <NavLink
                to="/start"
                className="ml-1 whitespace-nowrap rounded-md bg-lime px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink"
              >
                Join
              </NavLink>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-edge px-4 py-5 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-bone-dim">
          Hattrick ·{" "}
          <Link
            to="/how"
            className="underline decoration-bone-dim/40 underline-offset-2 hover:text-bone"
          >
            how to play
          </Link>{" "}
          · data via ESPN
          {session && (
            <>
              {" · "}
              <button
                className="underline decoration-bone-dim/40 underline-offset-2 hover:text-bone"
                onClick={() => {
                  setSession(null);
                  navigate("/");
                }}
              >
                sign out
              </button>
            </>
          )}
        </p>
      </footer>
    </div>
  );
}
