export type DiscordConfig = {
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_REDIRECT_URI?: string;
};

export class DiscordError extends Error {
  constructor(
    public readonly reason: "no_mutual_guild" | "dm_closed" | "unavailable" | "uncertain",
    public readonly retryAfter?: number,
  ) {
    super("Discord request failed.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const base = "https://discord.com/api/v10";

export function createDiscord(config: DiscordConfig) {
  const available = Boolean(
    config.DISCORD_CLIENT_ID &&
    config.DISCORD_CLIENT_SECRET &&
    config.DISCORD_BOT_TOKEN &&
    config.DISCORD_REDIRECT_URI,
  );

  async function request(path: string, init: RequestInit, sending = false) {
    let response: Response;

    try {
      response = await fetch(base + path, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // A lost response to a message POST may mean the message was already delivered.
      throw new DiscordError(sending ? "uncertain" : "unavailable", sending ? undefined : 60_000);
    }

    const data: unknown = await response.json().catch(() => null);
    const body = isRecord(data) ? data : {};

    if (!response.ok) {
      if (body?.code === 50278) throw new DiscordError("no_mutual_guild");

      if (body?.code === 50007) throw new DiscordError("dm_closed");

      if (response.status === 429) {
        const seconds = Number(body?.retry_after ?? response.headers.get("Retry-After"));

        throw new DiscordError(
          "unavailable",
          Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60_000,
        );
      }

      if (response.status >= 500)
        throw new DiscordError(sending ? "uncertain" : "unavailable", sending ? undefined : 60_000);

      throw new DiscordError("unavailable");
    }

    return body;
  }

  function id(value: unknown, sending = false): string {
    if (typeof value !== "string" || !/^\d{1,20}$/.test(value))
      throw new DiscordError(sending ? "uncertain" : "unavailable");

    return value;
  }

  const botHeaders = {
    Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };

  return {
    available,
    canSend: Boolean(config.DISCORD_BOT_TOKEN),
    authorizationUrl(state: string) {
      if (!available) throw new DiscordError("unavailable");

      const url = new URL("https://discord.com/oauth2/authorize");

      url.search = new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID!,
        redirect_uri: config.DISCORD_REDIRECT_URI!,
        response_type: "code",
        scope: "identify applications.commands",
        integration_type: "1",
        prompt: "consent",
        state,
      }).toString();

      return url.href;
    },
    async identify(code: string) {
      if (!available) throw new DiscordError("unavailable");

      const token = await request("/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.DISCORD_CLIENT_ID!,
          client_secret: config.DISCORD_CLIENT_SECRET!,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.DISCORD_REDIRECT_URI!,
        }),
      });

      if (typeof token?.access_token !== "string") throw new DiscordError("unavailable");

      const scopes = typeof token.scope === "string" ? token.scope.split(" ") : [];

      if (!scopes.includes("identify") || !scopes.includes("applications.commands"))
        throw new DiscordError("unavailable");

      const profile = await request("/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });

      if (typeof profile?.username !== "string") throw new DiscordError("unavailable");

      // OAuth tokens are used only for this lookup; they are not persisted or logged.
      return { id: id(profile.id), username: profile.username.slice(0, 100) };
    },
    async openDm(userId: string) {
      const channel = await request("/users/@me/channels", {
        method: "POST",
        headers: botHeaders,
        body: JSON.stringify({ recipient_id: userId }),
      });

      return id(channel?.id);
    },
    async send(channelId: string, content: string, nonce: string) {
      const message = await request(
        `/channels/${id(channelId)}/messages`,
        {
          method: "POST",
          headers: botHeaders,
          body: JSON.stringify({
            content: content.slice(0, 2000),
            allowed_mentions: { parse: [] },
            nonce,
            enforce_nonce: true,
          }),
        },
        true,
      );

      return id(message?.id, true);
    },
  };
}

export type Discord = ReturnType<typeof createDiscord>;
