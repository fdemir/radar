import { DiscordSettings } from "./discord-settings";
import { WebhookSettings } from "./webhook-settings";
import { Button } from "@radar/ui/components/button";
import { Card } from "@radar/ui/components/card";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@radar/ui/components/native-select";
import { Progress } from "@radar/ui/components/progress";
import { Switch } from "@radar/ui/components/switch";
import { useState } from "react";
import { Check, LogOut, Mail } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "./context";
import { PageTitle, WorkspacePage } from "./components";
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
    <WorkspacePage>
      <PageTitle title="Settings" />
      <div className="grid items-start gap-7 md:grid-cols-2">
        <AccountForm
          key={[prefs.name, prefs.email, prefs.language, prefs.timezone, prefs.verified].join("|")}
          prefs={prefs}
          preferences={preferences}
          pending={pending}
          verify={verify}
          verifying={verifying}
          emailAvailable={state.emailAvailable}
        />
        <Card className="gap-0 p-6 lg:p-9">
          <h2 className="mb-7 text-2xl">Notifications</h2>
          <div className="mb-5 flex items-center gap-4 [&>div]:flex-1">
            <Mail className="text-sky-accent" size={21} />
            <div>
              <h3 className="text-sm tracking-normal">Email</h3>
              <p className="mt-1 text-xs">New findings only</p>
            </div>
            <Switch
              aria-label="Email notifications"
              checked={prefs.emailEnabled}
              disabled={pending}
              onCheckedChange={(emailEnabled) => preferences({ emailEnabled })}
            />
          </div>
          {!state.emailAvailable && <p className="text-xs">Email is not available yet.</p>}
          <DiscordSettings />
          <WebhookSettings />
          <div className="mt-8 space-y-5 border-t pt-8">
            <h2 className="mb-7 text-2xl">Usage</h2>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>Active tasks</span>
              <strong>{state.tasks.filter((t) => t.status === "active").length} / 5</strong>
            </div>
            <Progress
              aria-label="Active task usage"
              max={5}
              value={state.tasks.filter((t) => t.status === "active").length}
            />
            <div className="flex items-center justify-between gap-3 text-xs">
              <span title="Resets at 00:00 UTC">Checks today</span>
              <strong>{state.checks} / 30</strong>
            </div>
            <Progress aria-label="Daily check usage" max={30} value={state.checks} />
          </div>
        </Card>
      </div>
      <div className="mt-8 flex justify-end">
        <Button variant="outline" disabled={signingOut} onClick={logout}>
          <LogOut size={16} />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </WorkspacePage>
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
    <Card className="gap-0 p-6 lg:p-9">
      <h2 className="mb-7 text-2xl">Account</h2>
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
        <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
          Display name
          <Input
            required
            minLength={2}
            maxLength={40}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Label>
        <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
          Email
          <Input type="email" value={prefs.email} readOnly />
        </Label>
        <div className="-mt-2 mb-6 flex items-center gap-3 text-xs text-muted-foreground">
          {prefs.verified ? (
            <>
              <Check size={15} />
              Verified
            </>
          ) : (
            <>
              <span>Not verified</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={verifying || !emailAvailable}
                onClick={verify}
              >
                {verifying ? "Sending…" : "Verify email"}
              </Button>
            </>
          )}
        </div>
        <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
          Timezone
          <NativeSelect
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
              <NativeSelectOption key={zone}>{zone}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
          Default result language
          <NativeSelect
            value={form.language}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                language: event.target.value as Preferences["language"],
              }))
            }
          >
            <NativeSelectOption>English</NativeSelectOption>
            <NativeSelectOption>Türkçe</NativeSelectOption>
          </NativeSelect>
        </Label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </form>
    </Card>
  );
}
