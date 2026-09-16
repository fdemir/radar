import { useState } from "react";
import { Check, LogOut, Mail } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "./context";
import { PageTitle, Toggle } from "./components";
import type { Preferences, PreferencesInput } from "@radar/core";
export default function Settings() {
  const { state, preferences, pending } = useWorkspace();
  const prefs = state.preferences;
  const [verifying, setVerifying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  async function verify() {
    setVerifying(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: prefs.email,
        callbackURL: `${window.location.origin}/settings`,
      });
      if (error) throw new Error(error.message || "Unable to send verification email.");
      toast("Check your email for the verification link.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send email.");
    } finally {
      setVerifying(false);
    }
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
          key={[prefs.name, prefs.email, prefs.language, prefs.timezone, prefs.verified].join("|")}
          prefs={prefs}
          preferences={preferences}
          pending={pending}
          verify={verify}
          verifying={verifying}
          emailAvailable={state.emailAvailable}
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
              disabled={pending}
              change={(emailEnabled) => preferences({ emailEnabled })}
            />
          </div>
          {!state.emailAvailable && <p className="caption">Email is not available yet.</p>}
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
              <span title="Resets at 00:00 UTC">Checks today</span>
              <strong>{state.checks} / 30</strong>
            </div>
            <progress aria-label="Daily check usage" max={30} value={state.checks} />
          </div>
        </section>
      </div>
      <div className="settings-bottom">
        <button className="button secondary" disabled={signingOut} onClick={logout}>
          <LogOut size={16} />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </main>
  );
}
function AccountForm({
  prefs,
  preferences,
  verify,
  pending,
  verifying,
  emailAvailable,
}: {
  prefs: Preferences;
  preferences: (patch: PreferencesInput) => Promise<boolean>;
  verify: () => Promise<void>;
  pending: boolean;
  verifying: boolean;
  emailAvailable: boolean;
}) {
  const [form, setForm] = useState(prefs);
  return (
    <section className="card settings-card">
      <h2>Account</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            await preferences({
              name: form.name.trim(),
              timezone: form.timezone,
              language: form.language,
            })
          )
            toast("Preferences saved");
        }}
      >
        <label>
          Display name
          <input
            required
            minLength={2}
            maxLength={40}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Email
          <input type="email" value={prefs.email} readOnly />
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
              <button
                type="button"
                className="text-button"
                disabled={verifying || !emailAvailable}
                onClick={verify}
              >
                {verifying ? "Sending…" : "Verify email"}
              </button>
            </>
          )}
        </div>
        <label>
          Timezone
          <select
            value={form.timezone}
            onChange={(event) =>
              setForm((current) => ({ ...current, timezone: event.target.value }))
            }
          >
            {[
              ...new Set([
                prefs.timezone,
                "Europe/Istanbul",
                "Europe/London",
                "Europe/Berlin",
                "America/New_York",
                "America/Los_Angeles",
                "Asia/Tokyo",
                "UTC",
              ]),
            ].map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </select>
        </label>
        <label>
          Default result language
          <select
            value={form.language}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                language: event.target.value as Preferences["language"],
              }))
            }
          >
            <option>English</option>
            <option>Türkçe</option>
          </select>
        </label>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </button>
      </form>
    </section>
  );
}
