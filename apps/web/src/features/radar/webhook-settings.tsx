import { useCallback, useEffect, useState } from "react";
import { Webhook } from "lucide-react";
import { toast } from "sonner";
import z from "zod";
import { Button } from "@radar/ui/components/button";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import { Switch } from "@radar/ui/components/switch";
import { webhookStatusSchema, type WebhookStatus } from "@radar/core/webhook";
import { api } from "./api";

export function WebhookSettings() {
  const [state, setState] = useState<WebhookStatus | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingError, setLoadingError] = useState(false);
  const refresh = useCallback(
    () =>
      api("/webhook")
        .then((value) => {
          setState(webhookStatusSchema.parse(value));
          setLoadingError(false);
        })
        .catch(() => setLoadingError(true)),
    [],
  );
  const connection = state?.connection;
  const delivery = connection?.lastDelivery;
  const waiting = delivery?.status === "pending" || delivery?.status === "sending";

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!waiting) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [waiting, refresh]);

  async function action(kind: "save" | "test" | "disconnect" | "toggle", enabled?: boolean) {
    setBusy(true);

    try {
      if (kind === "save") {
        const saved = webhookStatusSchema
          .extend({ secret: z.string() })
          .parse(await api("/webhook", "PUT", { url }));

        setState(saved);
        setSecret(saved.secret);
        setUrl("");
        toast("Webhook saved. Copy your signing key, then send a test.");
      }

      if (kind === "test") {
        const tested = webhookStatusSchema
          .extend({ deliveryStatus: z.string().nullable() })
          .parse(await api("/webhook/test", "POST"));

        setState(tested);

        if (tested.deliveryStatus === "sent") toast("Test delivered. Your webhook is ready.");
        else if (tested.deliveryStatus === "failed")
          toast.error("Test failed. Check the endpoint and try again.");
        else toast("Test queued. We'll retry automatically.");
      }

      if (kind === "toggle") await api("/webhook", "PATCH", { enabled });

      if (kind === "disconnect") {
        await api("/webhook", "DELETE");
        setSecret(null);
      }

      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update webhook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-7 border-t pt-7">
      <div className="flex items-center gap-4">
        <Webhook className="text-sky-accent" size={21} />
        <div className="flex-1">
          <h3 className="text-sm tracking-normal">Webhook</h3>
          <p className="mt-1 text-xs">Send new findings to your app or automation</p>
        </div>
        {connection && (
          <Switch
            aria-label="Webhook notifications"
            checked={connection.enabled}
            disabled={busy || !connection.verified}
            onCheckedChange={(enabled) => void action("toggle", enabled)}
          />
        )}
      </div>
      <div className="mt-4 space-y-3" aria-live="polite">
        {loadingError ? (
          <>
            <p className="text-xs">Unable to load webhook settings.</p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          </>
        ) : !state ? (
          <p className="text-xs">Loading webhook…</p>
        ) : (
          <>
            {connection && (
              <>
                <p className="break-all text-xs">{connection.url}</p>
                <p className="text-xs text-muted-foreground">
                  {!connection.verified
                    ? "Send a successful test to start receiving findings."
                    : connection.enabled
                      ? "New findings from all active tasks will be sent here."
                      : "Webhook notifications are paused."}
                </p>
                {delivery && (
                  <p className="text-xs">
                    {delivery.status === "sent"
                      ? "Last delivery succeeded."
                      : delivery.status === "failed"
                        ? `Delivery failed: ${delivery.error}.`
                        : waiting
                          ? "Delivery pending. Retrying automatically if needed."
                          : "Last delivery cancelled."}
                  </p>
                )}
              </>
            )}
            {secret && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="webhook-secret">Signing key — shown only now</Label>
                <Input
                  id="webhook-secret"
                  readOnly
                  value={secret}
                  className="font-mono text-xs"
                  onFocus={(event) => event.target.select()}
                />
                <p className="text-xs text-muted-foreground">
                  Save this key in your receiving app before testing. Saving a URL again replaces
                  the key and cancels pending deliveries.
                </p>
              </div>
            )}
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void action("save");
              }}
            >
              <Label htmlFor="webhook-url">
                {connection ? "Replace endpoint URL" : "Endpoint URL"}
              </Label>
              <Input
                id="webhook-url"
                type="url"
                required
                maxLength={2048}
                placeholder="https://your-app.com/webhooks/radar"
                value={url}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
              />
              <Button type="submit" variant="outline" size="sm" disabled={busy || !url.trim()}>
                {connection ? "Replace webhook" : "Save webhook"}
              </Button>
            </form>
            {connection && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || waiting}
                  onClick={() => void action("test")}
                >
                  Send test
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
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Payload and verification</summary>
              <p className="mt-2">
                Receives JSON POST requests with type findings.created, data.task, data.runId, and
                data.findings. Tests use webhook.test. Return a 2xx response within 10 seconds.
              </p>
              <p className="mt-2">
                Verify Webhook-Signature (v1=…) with HMAC-SHA256 of Webhook-Timestamp + "." + the
                raw request body, using your signing key as text. Reject timestamps older than 5
                minutes and deduplicate using Webhook-Id. Temporary failures retry up to 5 attempts.
              </p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
