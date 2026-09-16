import { cn } from "@radar/ui/lib/utils";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import AuthLayout from "@/components/auth-layout";
import { Button, buttonVariants } from "@radar/ui/components/button";
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
    <AuthLayout>
      <h1 className="text-[28px]">Choose a password</h1>
      {!token || params.has("error") ? (
        <>
          <p>This link is invalid or has expired.</p>
          <Link to="/forgot-password" className={cn(buttonVariants())}>
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
          <Label className="mb-5 flex-col items-stretch gap-2">
            New password
            <Input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Label>
          <Label className="mb-5 flex-col items-stretch gap-2">
            Confirm password
            <Input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Label>
          {error && (
            <p role="alert" className="mb-4 text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Reset password"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
