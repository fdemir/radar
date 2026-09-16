import { cn } from "@radar/ui/lib/utils";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import AuthLayout from "@/components/auth-layout";
import { Button, buttonVariants } from "@radar/ui/components/button";
import { useState } from "react";
import { Link } from "react-router";
import { authClient } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  return (
    <AuthLayout>
      <h1 className="text-[28px]">Reset password</h1>
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
          <Label className="mb-5 flex-col items-stretch gap-2">
            Email
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Label>
          {error && (
            <p role="alert" className="mb-4 text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <Link to="/login" className={cn(buttonVariants({ variant: "link" }))}>
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
