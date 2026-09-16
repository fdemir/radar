export type EmailConfig = { RESEND_API_KEY: string; EMAIL_FROM: string };
export function createEmail(config: EmailConfig) {
  const available = Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
  return {
    available,
    async send(to: string, subject: string, text: string, key: string) {
      if (!available) throw new Error("Email is not available yet.");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ from: config.EMAIL_FROM, to: [to], subject, text }),
        signal: AbortSignal.timeout(20_000),
        redirect: "manual",
      });
      if (!response.ok) throw new Error("Email could not be sent. Try again later.");
    },
  };
}
