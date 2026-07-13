import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, SectionLabel, Kicker } from "../components/bits";

export default function ProfilePage() {
  const { session, setSession } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState(session?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!session) return null;
  const loginLink = `${window.location.origin}/login?t=${session.token}`;

  async function save() {
    if (!name.trim() || name.trim() === session!.name) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api.rename(name.trim());
      setSession(r.session);
      setMsg("Name updated.");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(loginLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="animate-rise mx-auto max-w-lg space-y-6">
      <div>
        <Kicker>Your profile</Kicker>
        <h1 className="font-display text-3xl uppercase leading-none tracking-tight sm:text-4xl">
          {session.name}
        </h1>
      </div>

      <section className="rounded-lg border border-edge bg-panel p-4">
        <SectionLabel>Display name</SectionLabel>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            className="flex-1 rounded-md border border-edge bg-black/30 px-3 py-2.5 text-sm text-bone outline-none focus:border-lime"
          />
          <Button onClick={save} disabled={busy || !name.trim() || name.trim() === session.name}>
            Save
          </Button>
        </div>
        {msg && <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-lime">{msg}</p>}
        {err && <p className="mt-2 font-mono text-[11px] text-flag">{err}</p>}
      </section>

      <section className="rounded-lg border border-lime/30 bg-lime/[0.05] p-4">
        <SectionLabel right={copied ? <span className="text-lime">copied!</span> : undefined}>
          Your login link
        </SectionLabel>
        <p className="mb-2.5 text-sm text-bone/80">
          No passwords here. Bookmark this link or send it to your other devices to sign in as{" "}
          <b className="text-bone">{session.name}</b> anywhere.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={loginLink}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-md border border-edge bg-black/30 px-3 py-2 font-mono text-[11px] text-bone-dim outline-none"
          />
          <Button variant="ghost" onClick={copy}>
            Copy
          </Button>
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-flag/80">
          ⚠ Treat this like a password — anyone with it can sign in as you.
        </p>
      </section>

      <div className="flex items-center justify-between">
        <Link to="/league" className="font-mono text-[11px] uppercase tracking-wider text-lime">
          ← Your league
        </Link>
        <button
          onClick={() => {
            setSession(null);
            navigate("/");
          }}
          className="font-mono text-[11px] uppercase tracking-wider text-bone-dim hover:text-flag"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
