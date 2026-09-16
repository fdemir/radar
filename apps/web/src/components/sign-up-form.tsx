import { Button } from "@radar/ui/components/button";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import z from "zod";

import { authClient } from "@/lib/auth-client";

export default function SignUpForm({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      username: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      try {
        const { error } = await authClient.signUp.email({
          username: value.username.trim(),
          password: value.password,
          email: value.email.trim(),
          name: value.username.trim(),
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
        username: z
          .string()
          .trim()
          .min(3, "Use at least 3 characters")
          .max(30, "Use at most 30 characters")
          .regex(/^[a-zA-Z0-9_.]+$/, "Use letters, numbers, underscores or dots"),
        email: z.email("Invalid email address"),
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(128, "Use at most 128 characters"),
      }),
    },
  });

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">Create Account</h1>

      <p className="mb-6 text-sm text-muted-foreground">
        You’ll use your username and password to sign in to Radar.
      </p>

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
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Email</Label>
                <Input
                  id={field.name}
                  required
                  autoComplete="email"
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${field.name}-errors`}
                  name={field.name}
                  type="email"
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
                  autoComplete="new-password"
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
              {isSubmitting ? "Submitting..." : "Sign Up"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-4 text-center">
        <Button variant="link" onClick={onSwitchToSignIn} className="">
          Already have an account? Sign In
        </Button>
      </div>
    </div>
  );
}
