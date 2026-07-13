import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Spinner } from "../components/bits";

// Magic-link login: /login?t=<token> signs you in as that member on any device.
export default function LoginPage() {
  const [params] = useSearchParams();
  const token = params.get("t");
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      navigate("/start", { replace: true });
      return;
    }
    api
      .loginWithToken(token)
      .then((s) => {
        setSession(s);
        navigate("/profile", { replace: true });
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err)
    return (
      <div className="mx-auto max-w-md space-y-3 py-12 text-center">
        <p className="font-mono text-xs text-flag">{err}</p>
        <a href="/start" className="font-mono text-[11px] uppercase tracking-wider text-lime">
          Go to start →
        </a>
      </div>
    );
  return <Spinner label="Signing you in…" />;
}
