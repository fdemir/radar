import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authClient } from "@/lib/auth-client";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="auth-page">
      <div className="auth-sky sky" />
      <section className="card auth-card settings-card">
        <h1>Choose a password</h1>
        {!token || params.has("error") ? (
          <>
            <p>This link is invalid or has expired.</p>
            <Link to="/forgot-password" className="button primary">
              Get a new link
            </Link>
          </>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");

              if (password !== confirmation) {
                setError("Passwords do not match.");

                return;
              }

              setBusy(true);

              try {
                const result = await authClient.resetPassword({ token, newPassword: password });

                if (result.error)
                  throw new Error(result.error.message || "Unable to reset password.");

                window.location.assign("/login");
              } catch (error) {
                setError(error instanceof Error ? error.message : "Unable to reset password.");
                setBusy(false);
              }
            }}
          >
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="button primary full" disabled={busy}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
