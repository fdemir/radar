import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import z from "zod";
import { Button } from "@radar/ui/components/button";
import { Switch } from "@radar/ui/components/switch";
import { discordStatusSchema, type DiscordStatus } from "@radar/core/discord";
import { api } from "./api";

const callbackMessages: Record<string, string> = {
  "session-expired": "Sign in again, then reconnect Discord.",
  expired: "This connection link expired. Please try again.",
  cancelled: "Discord connection was cancelled.",
  unavailable: "Discord is not available yet.",
  conflict: "This Discord account is already linked, or the connection attempt expired.",
  failed: "Discord could not be connected. Please try again.",
};

export function DiscordSettings() {
  const [state, setState] = useState<DiscordStatus | null>(null);
  const [loadingError, setLoadingError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const result = params.get("discord");
  const refresh = useCallback(
    () =>
      api("/discord")
        .then((value) => {
          setState(discordStatusSchema.parse(value));
          setLoadingError(false);
        })
        .catch(() => setLoadingError(true)),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!result) return;

    if (callbackMessages[result]) toast.error(callbackMessages[result]);

    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        next.delete("discord");

        return next;
      },
      { replace: true },
    );
  }, [result, setParams]);
  useEffect(() => {
    if (state?.connection?.status !== "pending") return;

    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [state?.connection?.status, refresh]);

  async function action(kind: "connect" | "disconnect" | "test" | "toggle", enabled?: boolean) {
    setBusy(true);

    try {
      if (kind === "connect") {
        const { url } = z.object({ url: z.url() }).parse(await api("/discord/connect", "POST"));
        const target = new URL(url);

        if (target.origin !== "https://discord.com" || target.pathname !== "/oauth2/authorize")
          throw new Error("Invalid Discord connection link.");

        window.location.assign(url);

        return;
      }

      if (kind === "disconnect") await api("/discord", "DELETE");

      if (kind === "toggle") await api("/discord", "PATCH", { enabled });

      if (kind === "test") {
        const tested = discordStatusSchema
          .extend({ deliveryStatus: z.string().nullable() })
          .parse(await api("/discord/test", "POST"));

        setState(tested);

        if (tested.deliveryStatus === "sent") toast("Test message sent. Check your Discord DMs.");
      }

      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update Discord.");
    } finally {
      setBusy(false);
    }
  }

  const connection = state?.connection;
  const problem =
    connection?.error === "no_mutual_guild"
      ? "Your account is linked, but Discord requires a shared server to deliver this DM. Personal DM notifications are unavailable for this connection."
      : connection?.error === "dm_closed"
        ? "Your account is linked, but Discord blocked the DM. Check your privacy settings and whether Radar is blocked, then send a test message."
        : connection?.error === "uncertain"
          ? "We couldn't confirm the last message arrived. Check your Discord DMs, then send a test message to resume notifications."
          : connection?.status === "failed"
            ? "Discord delivery is unavailable. Send a test message to try again."
            : null;

  return (
    <div className="mt-7 border-t pt-7">
      <div className="flex items-center gap-4">
        <MessageCircle className="text-sky-accent" size={21} />
        <div className="flex-1">
          <h3 className="text-sm tracking-normal">Discord</h3>
          <p className="mt-1 text-xs">
            {connection ? `Connected as @${connection.username}` : "New findings in your DMs"}
          </p>
        </div>
        {connection && (
          <Switch
            aria-label="Discord notifications"
            checked={connection.enabled && connection.status === "ready"}
            disabled={busy || connection.status !== "ready" || !state?.available}
            onCheckedChange={(enabled) => void action("toggle", enabled)}
          />
        )}
      </div>
      <div className="mt-4 space-y-3" aria-live="polite">
        {loadingError ? (
          <>
            <p className="text-xs">Unable to load Discord settings.</p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          </>
        ) : !state ? (
          <p className="text-xs">Loading Discord…</p>
        ) : !connection ? (
          <>
            <p className="text-xs text-muted-foreground">
              Connect your personal Discord account. We'll send a welcome DM to check delivery
              before enabling notifications.
            </p>
            <Button
              variant="outline"
              disabled={busy || !state.available}
              onClick={() => void action("connect")}
            >
              {busy ? "Connecting…" : "Connect to Discord"}
            </Button>
          </>
        ) : (
          <>
            {connection.status === "pending" && (
              <p className="text-xs">
                Account linked. Your welcome DM is waiting to be sent; notifications will start
                after it arrives.
              </p>
            )}
            {connection.status === "ready" && (
              <p className="text-xs text-muted-foreground">
                {connection.enabled
                  ? "DM delivery confirmed. New findings from all active tasks will arrive here."
                  : "Discord notifications are paused."}
              </p>
            )}
            {problem && <p className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !state.available || connection.status === "pending"}
                onClick={() => void action("test")}
              >
                Send test message
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void action("disconnect")}
              >
                Disconnect
              </Button>
            </div>
          </>
        )}
        {state && !state.available && (
          <p className="text-xs text-muted-foreground">Discord is not available yet.</p>
        )}
      </div>
    </div>
  );
}
