import { Button } from "@radar/ui/components/button";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { Link } from "react-router";
import { useState } from "react";
import z from "zod";

import { authClient } from "@/lib/auth-client";

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      username: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        const { error } = await authClient.signIn.username({
          username: value.username.trim(),
          password: value.password,
        });
        if (error) {
          setSubmitError(
            error.status === 429
              ? "Too many attempts. Please wait a minute and try again."
              : error.message || "Unable to continue. Please try again.",
          );
          return;
        }
      } catch {
        setSubmitError("Unable to connect. Please try again.");
      }
    },
    validators: {
      onSubmit: z.object({
        username: z.string().trim().min(1, "Enter your username"),
        password: z.string().min(1, "Enter your password"),
      }),
    },
  });

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">Welcome Back</h1>

      {submitError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {submitError}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <div>
          <form.Field name="username">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Username</Label>
                <Input
                  id={field.name}
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="username"
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${field.name}-errors`}
                  name={field.name}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <div id={`${field.name}-errors`} aria-live="polite">
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className="text-red-500">
                      {error?.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Password</Label>
                <Input
                  id={field.name}
                  required
                  autoComplete="current-password"
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${field.name}-errors`}
                  name={field.name}
                  type="password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <div id={`${field.name}-errors`} aria-live="polite">
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className="text-red-500">
                      {error?.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Submitting..." : "Sign In"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-4 text-center">
        <Link className="text-button" to="/forgot-password">
          Forgot password?
        </Link>
        <Button variant="link" onClick={onSwitchToSignUp} className="">
          Need an account? Sign Up
        </Button>
      </div>
    </div>
  );
}
