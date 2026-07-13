import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, ErrorNote, Kicker, cx } from "../components/bits";

export default function StartPage() {
  const { session, setSession } = useSession();
  const navigate = useNavigate();
  const prefillCode = new URLSearchParams(window.location.search).get("code") ?? "";
  const [mode, setMode] = useState<"create" | "join">(prefillCode ? "join" : "create");

  const [leagueName, setLeagueName] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(prefillCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/league" replace />;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "create"
          ? await api.createLeague(leagueName.trim(), name.trim())
          : await api.joinLeague(code.trim(), name.trim());
      setSession(res.session);
      navigate("/league");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = name.trim() && (mode === "create" ? leagueName.trim() : code.trim());

  return (
    <div className="mx-auto max-w-md animate-rise space-y-6 py-4">
      <div>
        <Kicker>No password — just a name</Kicker>
        <h1 className="font-display text-4xl leading-[0.9] tracking-tight sm:text-5xl">
          PLAY WITH<br />
          YOUR <span className="text-lime">FRIENDS</span>
        </h1>
      </div>

      <div className="flex border border-edge">
        {(["create", "join"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cx(
              "flex-1 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
              mode === m ? "bg-lime text-ink" : "text-bone-dim hover:text-bone"
            )}
          >
            {m === "create" ? "Create league" : "Join league"}
          </button>
        ))}
      </div>

      <div className="space-y-4 rounded-lg border border-edge bg-panel p-5">
        {mode === "create" ? (
          <Field label="League name" value={leagueName} onChange={setLeagueName} placeholder="The Office Cup" />
        ) : (
          <Field
            label="League code"
            value={code}
            onChange={(v) => setCode(v.toUpperCase())}
            placeholder="ABCDE"
            mono
          />
        )}
        <Field label="Your name" value={name} onChange={setName} placeholder="e.g. Alex" />
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={submit} disabled={busy || !canSubmit} className="w-full py-3">
          {busy ? "…" : mode === "create" ? "Create & get a code" : "Join league"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-bone-dim">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(
          "w-full rounded-md border border-edge bg-black/30 px-3 py-2.5 text-sm text-bone outline-none transition-colors placeholder:text-bone-dim/50 focus:border-lime",
          mono && "font-mono uppercase tracking-[0.3em]"
        )}
      />
    </label>
  );
}
