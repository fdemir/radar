import { expect, it, vi } from "vitest";
import { inlineEmphasis, plainText } from "@radar/core/emphasis";
import { createEmail } from "@radar/notifications";
import {
  discordFindings,
  emailFindings,
  findingSubject,
} from "../../../packages/notifications/src/finding-message";

const finding = {
  title: "WARDOGS: 318,139 concurrent players",
  summary: "17 September 2026. 24-hour peak: 326,850.",
  url: "https://steamdb.info/app/1867240/charts/",
};
const taskUrl = "https://radar.example.com/tasks/wardogs";

it("sends both HTML and plain text to the email provider", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

  try {
    const email = createEmail({ RESEND_API_KEY: "test-key", EMAIL_FROM: "radar@example.com" });
    const { text, html } = emailFindings([finding], taskUrl, "English");

    await email.send("reader@example.com", finding.title, text, "delivery-id", html);
    expect(request).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: JSON.stringify({
          from: "radar@example.com",
          to: ["reader@example.com"],
          subject: finding.title,
          text,
          html,
        }),
      }),
    );
  } finally {
    request.mockRestore();
  }
});

it("renders the same emphasis in Discord and email with a clean plain-text alternative", () => {
  const result = { ...finding, summary: "24-hour peak: **326,850 players**." };
  const email = emailFindings([result], taskUrl, "English");

  expect(discordFindings([result], taskUrl, "English")).toContain("**326,850 players**");
  expect(email.html).toContain("<strong>326,850 players</strong>");
  expect(email.html).toContain(`href="${finding.url}"`);
  expect(email.html).toContain(`href="${taskUrl}"`);
  expect(email.text).toContain("24-hour peak: 326,850 players.");
  expect(email.text).not.toContain("**");
  expect(email.html).not.toContain("**");
});

it("treats page-supplied HTML as text and refuses executable email links", () => {
  const result = {
    title: '<img src=x onerror="alert(1)">',
    summary: '**<script>alert("x")</script>** & available',
    url: "javascript:alert(1)",
  };
  const { html } = emailFindings([result], taskUrl, "Türkçe");

  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("javascript:");
  expect(html).toContain("<strong>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</strong>");
  expect(html).toContain("&amp; available");
  expect(html).toContain("Radar’da göz at");
});

it("escapes quoted URL attributes and preserves query parameters", () => {
  const { html } = emailFindings(
    [{ ...finding, url: 'https://example.com/?q="quoted"&page=2' }],
    taskUrl,
    "English",
  );

  expect(html).toContain('href="https://example.com/?q=&quot;quoted&quot;&amp;page=2"');
});

it("keeps unsupported formatting literal and shares inline emphasis with the web UI", () => {
  expect(inlineEmphasis("Price: **€49**; **in stock**.")).toEqual([
    { text: "Price: ", bold: false },
    { text: "€49", bold: true },
    { text: "; ", bold: false },
    { text: "in stock", bold: true },
    { text: ".", bold: false },
  ]);
  expect(plainText("Unclosed **bold and <b>HTML</b>")).toBe("Unclosed **bold and <b>HTML</b>");
});

it("leads with the result and keeps the source and Radar links", () => {
  expect(discordFindings([finding], taskUrl, "English")).toBe(
    `**${finding.title}**\n${finding.summary}\n${finding.url}\n\n[Take a look in Radar](${taskUrl})`,
  );
  expect(findingSubject([finding])).toBe(finding.title);
  expect(findingSubject([finding, finding])).toBe(`${finding.title} (+1)`);
});

it("preserves a complete summary longer than the old 160-character cutoff", () => {
  const summary =
    "Current players: 318,139. The 24-hour peak was 326,850. The all-time peak was 428,666 players on 13 September 2026. These measurements were recorded on 17 September 2026.";

  expect(summary.length).toBeGreaterThan(160);
  expect(discordFindings([{ ...finding, summary }], taskUrl, "English")).toContain(summary);
});

it.each([
  ["English", "3 more in Radar."],
  ["Türkçe", "3 sonuç daha Radar’da."],
])("keeps complete findings within the Discord limit in %s", (language, more) => {
  const findings = Array.from({ length: 5 }, (_, index) => ({
    ...finding,
    title: `Result ${index + 1}`,
    summary: "A complete sentence. ".repeat(30).trim(),
    url: `https://example.com/result/${index + 1}`,
  }));
  const message = discordFindings(findings, taskUrl, language);

  expect(message.length).toBeLessThanOrEqual(2000);
  expect(message).toContain(findings[0]!.summary);
  expect(message).toContain(findings[1]!.url);
  expect(message).not.toContain("Result 3");
  expect(message).toContain(more);
  expect(message.endsWith(`](${taskUrl})`)).toBe(true);
});

it("falls back to the headline and source when a legacy finding cannot fit", () => {
  const result = { ...finding, summary: "A long legacy summary. ".repeat(100) };

  expect(discordFindings([result], taskUrl, "English")).toBe(
    `**${finding.title}**\n${finding.url}\n\n[Take a look in Radar](${taskUrl})`,
  );
});

it("leaves oversized source URLs in Radar without sending a broken link", () => {
  const url = `https://example.com/${"a".repeat(2100)}`;

  expect(discordFindings([{ ...finding, url }], taskUrl, "English")).toBe(
    `**${finding.title}**\n\n[Take a look in Radar](${taskUrl})`,
  );
});
