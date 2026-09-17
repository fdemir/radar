import { inlineEmphasis, plainText } from "@radar/core/emphasis";

type Finding = { title: string; summary: string; url: string };

export function findingSubject(findings: Finding[]) {
  return `${plainText(findings[0]!.title)}${findings.length > 1 ? ` (+${findings.length - 1})` : ""}`;
}

export function discordFindings(findings: Finding[], taskUrl: string, language: string) {
  const footer = `[${language === "Türkçe" ? "Radar’da göz at" : "Take a look in Radar"}](${taskUrl})`;
  // Reserve space for the footer and overflow count; never cut a sentence or URL.
  const budget = 2000 - footer.length - 80;
  const blocks: string[] = [];

  for (const finding of findings) {
    const title = `**${plainText(finding.title)}**`;
    const block = `${title}\n${finding.summary}\n${finding.url}`;

    if ([...blocks, block].join("\n\n").length > budget) {
      if (!blocks.length) {
        const headline = `${title}\n${finding.url}`;

        blocks.push(headline.length <= budget ? headline : title);
      }

      break;
    }

    blocks.push(block);
  }

  const remaining = findings.length - blocks.length;
  const more = remaining
    ? language === "Türkçe"
      ? `${remaining} sonuç daha Radar’da.\n`
      : `${remaining} more in Radar.\n`
    : "";

  return `${blocks.join("\n\n")}\n\n${more}${footer}`;
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function emphasisHtml(text: string) {
  return inlineEmphasis(text)
    .map((part) =>
      part.bold ? `<strong>${escapeHtml(part.text)}</strong>` : escapeHtml(part.text),
    )
    .join("");
}

function linkHtml(url: string, label: string) {
  // Legacy records are not assumed to have passed today's URL validation.
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return escapeHtml(label);

  return `<a href="${escapeHtml(url)}" style="color:#2563eb">${escapeHtml(label)}</a>`;
}

export function emailFindings(findings: Finding[], taskUrl: string, language: string) {
  const sourceLabel = language === "Türkçe" ? "Kaynağa bak" : "View source";
  const radarLabel = language === "Türkçe" ? "Radar’da göz at" : "Take a look in Radar";
  const text =
    findings
      .map(
        (finding) => `${plainText(finding.title)}\n${plainText(finding.summary)}\n${finding.url}`,
      )
      .join("\n\n") + `\n\n${radarLabel}: ${taskUrl}`;
  const body = findings
    .map(
      (finding) =>
        `<section style="margin-bottom:24px"><h2 style="font-size:20px;line-height:1.4;margin:0 0 8px">${escapeHtml(plainText(finding.title))}</h2><p style="margin:0 0 12px;white-space:pre-line">${emphasisHtml(finding.summary)}</p>${linkHtml(finding.url, sourceLabel)}</section>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#ffffff;color:#18181b;font-family:Arial,sans-serif;font-size:16px;line-height:1.6"><main style="max-width:600px;margin:0 auto">${body}<p style="margin:24px 0 0">${linkHtml(taskUrl, radarLabel)}</p></main></body></html>`;

  return { text, html };
}
