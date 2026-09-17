import z from "zod";

export const discordStatusSchema = z.object({
  available: z.boolean(),
  connection: z
    .object({
      username: z.string(),
      status: z.enum(["pending", "ready", "blocked", "failed"]),
      enabled: z.boolean(),
      error: z.enum(["no_mutual_guild", "dm_closed", "unavailable", "uncertain"]).nullable(),
    })
    .nullable(),
});

export type DiscordStatus = z.infer<typeof discordStatusSchema>;
