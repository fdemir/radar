import { useState } from "react";
import { Link } from "react-router";
import { authClient } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="auth-page">
      <div className="auth-sky sky" />
      <section className="card auth-card settings-card">
        <h1>Reset password</h1>
        {sent ? (
          <p>If the account exists, a reset link is on its way.</p>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");

              try {
                const result = await authClient.requestPasswordReset({
                  email,
                  redirectTo: `${window.location.origin}/reset-password`,
                });

                if (result.error)
                  throw new Error(result.error.message || "Unable to send reset email.");

                setSent(true);
              } catch (error) {
                setError(error instanceof Error ? error.message : "Unable to send email.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="button primary full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        <Link className="text-button" to="/login">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
