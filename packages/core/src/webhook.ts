import z from "zod";

// Use public DNS names over HTTPS only. Workers' public fetch provides the
// network boundary; redirects must remain disabled in the delivery adapter.
export const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();

      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.port &&
        host.includes(".") &&
        !host.endsWith(".") &&
        !host.includes(":") &&
        !/^\d+(\.\d+)*$/.test(host) &&
        !/(^|\.)(localhost|local|internal|test|invalid|example|home|lan)$/.test(host)
      );
    } catch {
      return false;
    }
  }, "Enter a public HTTPS URL without credentials, a fragment, or a custom port.");

export const webhookStatusSchema = z.object({
  connection: z
    .object({
      url: z.string(),
      enabled: z.boolean(),
      verified: z.boolean(),
      lastDelivery: z
        .object({
          status: z.enum(["pending", "sending", "sent", "failed", "cancelled"]),
          attempts: z.number(),
          error: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
});

export type WebhookStatus = z.infer<typeof webhookStatusSchema>;
