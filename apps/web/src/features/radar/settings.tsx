import { useEffect, useState } from "react";
import { Check, Copy, LogOut, Mail, MessageCircle, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "./context";
import { Modal, PageTitle, Toggle } from "./components";
import type { Preferences } from "./model";
export default function Settings() {
  const { state, preferences, reset } = useWorkspace();
  const prefs = state.preferences;
  const [modal, setModal] = useState<"connect" | "disconnect" | "verify" | "reset" | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(600);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (modal !== "connect" || seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [modal, seconds]);
  function connect() {
    setCode(`RADAR-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
    setSeconds(600);
    setModal("connect");
  }
  async function logout() {
    setSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      navigate("/login", { replace: true });
    } catch {
      toast.error("Unable to sign out. Try again.");
      setSigningOut(false);
    }
  }
  return (
    <main className="container workspace-main">
      <PageTitle title="Settings" />
      <div className="settings-grid">
        <AccountForm
          key={[prefs.name, prefs.email, prefs.language, prefs.timezone].join("|")}
          prefs={prefs}
          preferences={preferences}
          verify={() => setModal("verify")}
        />
        <section className="card settings-card">
          <h2>Notifications</h2>
          <div className="channel-row">
            <Mail className="blue-icon" size={21} />
            <div>
              <h3>Email</h3>
              <p>New findings only</p>
            </div>
            <Toggle
              label="Email notifications"
              checked={prefs.emailEnabled}
              change={(emailEnabled) => preferences({ emailEnabled })}
            />
          </div>
          <div className="channel-row">
            <MessageCircle className="blue-icon" size={21} />
            <div>
              <h3>Discord</h3>
              <p>{prefs.discord ?? "Not connected"}</p>
            </div>
            {prefs.discord && <Check size={18} className="blue-icon" />}
          </div>
          <button
            className="button secondary"
            onClick={() => (prefs.discord ? setModal("disconnect") : connect())}
          >
            {prefs.discord ? "Disconnect Discord" : "Connect Discord"}
          </button>
          <div className="usage">
            <h2>Usage</h2>
            <div className="row between">
              <span>Active tasks</span>
              <strong>{state.tasks.filter((t) => t.status === "active").length} / 5</strong>
            </div>
            <progress
              aria-label="Active task usage"
              max={5}
              value={state.tasks.filter((t) => t.status === "active").length}
            />
            <div className="row between">
              <span>Checks today</span>
              <strong>{state.checks} / 30</strong>
            </div>
            <progress aria-label="Daily check usage" max={30} value={state.checks} />
          </div>
        </section>
      </div>
      <div className="settings-bottom">
        <button className="text-button" onClick={() => setModal("reset")}>
          <RotateCcw size={16} />
          Reset sample data
        </button>
        <button className="button secondary" disabled={signingOut} onClick={logout}>
          <LogOut size={16} />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {modal === "connect" && (
        <Modal title="Connect Discord" close={() => setModal(null)}>
          <p>Send this command to the Radar bot:</p>
          <div className="connection-code">
            <code>/connect {code}</code>
            <button
              className="icon-button"
              aria-label="Copy command"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`/connect ${code}`);
                  toast("Command copied");
                } catch {
                  toast.error("Select and copy the command manually.");
                }
              }}
            >
              <Copy size={17} />
            </button>
          </div>
          <p className="caption">
            {seconds
              ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : "Code expired"}
          </p>
          <p className="caption">Sample connection. No Discord message is sent.</p>
          <button
            className="button primary"
            disabled={!seconds}
            onClick={() => {
              preferences({ discord: `${prefs.name}.radar` });
              setModal(null);
              toast("Sample Discord account connected");
            }}
          >
            Connect sample account
          </button>
          {!seconds && (
            <button className="button secondary" onClick={connect}>
              Get a new code
            </button>
          )}
        </Modal>
      )}
      {modal === "disconnect" && (
        <Modal title="Disconnect Discord?" close={() => setModal(null)}>
          <p>Discord notifications will turn off for all tasks.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                preferences({ discord: null });
                setModal(null);
              }}
            >
              Disconnect
            </button>
          </div>
        </Modal>
      )}
      {modal === "verify" && (
        <Modal title="Verify notification email" close={() => setModal(null)}>
          <p>{prefs.email}</p>
          <p className="caption">Sample verification. No email is sent.</p>
          <button
            className="button primary"
            onClick={() => {
              preferences({ verified: true });
              setModal(null);
              toast("Email marked verified");
            }}
          >
            Complete sample verification
          </button>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="Reset sample data?" close={() => setModal(null)}>
          <p>Your tasks, findings and preferences will return to the initial sample data.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                reset();
                setModal(null);
              }}
            >
              Reset
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function AccountForm({
  prefs,
  preferences,
  verify,
}: {
  prefs: Preferences;
  preferences: (patch: Partial<Preferences>) => void;
  verify: () => void;
}) {
  const [form, setForm] = useState(prefs);
  return (
    <section className="card settings-card">
      <h2>Account</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return;
          const changed = form.email !== prefs.email;
          preferences({
            name: form.name.trim(),
            email: form.email.trim(),
            timezone: form.timezone,
            language: form.language,
            ...(changed ? { verified: false } : {}),
          });
          toast(changed ? "Saved. Verify your notification email." : "Preferences saved");
        }}
      >
        <label>
          Display name
          <input
            required
            minLength={2}
            maxLength={40}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label>
          Notification email
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </label>
        <div className="verification">
          {prefs.verified ? (
            <>
              <Check size={15} />
              Verified
            </>
          ) : (
            <>
              <span>Not verified</span>
              <button type="button" className="text-button" onClick={verify}>
                Verify email
              </button>
            </>
          )}
        </div>
        <label>
          Timezone
          <select
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          >
            {[
              "Europe/Istanbul",
              "Europe/London",
              "Europe/Berlin",
              "America/New_York",
              "America/Los_Angeles",
              "Asia/Tokyo",
              "UTC",
            ].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label>
          Default result language
          <select
            value={form.language}
            onChange={(e) =>
              setForm((f) => ({ ...f, language: e.target.value as Preferences["language"] }))
            }
          >
            <option>English</option>
            <option>Türkçe</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          Save preferences
        </button>
      </form>
    </section>
  );
}
