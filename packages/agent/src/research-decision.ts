import z from "zod";
import { candidateSchema, researchResultSchema, publicUrl } from "@radar/core/research";
import { plainText } from "@radar/core/emphasis";
import { ResearchError, type ResearchState, type ResearchToolCall } from "./research-state";

export const decisionSchema = researchResultSchema.extend({
  findings: z
    .array(candidateSchema.extend({ evidence: z.string().trim().max(600).default("") }))
    .max(5),
  needsMoreEvidence: z.boolean(),
});

export type ModelDecision =
  | { kind: "tools"; text: string; calls: ResearchToolCall[] }
  | { kind: "final"; text: string; result: z.output<typeof decisionSchema> }
  | { kind: "invalid"; text: string };

export function finalizeDecision(
  decision: z.output<typeof decisionSchema>,
  evidence: Pick<ResearchState, "sources" | "searched" | "candidates" | "limited">,
) {
  const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
  let unverifiedQuotes = false;
  const findings = decision.findings.map((item) => {
    const source = evidence.sources.find((source) => source.url === publicUrl(item.url));

    if (!source) throw new ResearchError("A finding had an invalid source. Try again.");

    const quote = normalize(item.evidence);
    const verified = quote.length >= 12 && normalize(source.content).includes(quote);

    unverifiedQuotes ||= Boolean(item.evidence && !verified);

    return {
      ...item,
      title: plainText(item.title),
      reason: plainText(item.reason),
      url: source.url,
      evidence: verified ? quote : "",
      eventKey: item.eventKey.trim().toLowerCase(),
      version: item.version.trim().toLowerCase(),
    };
  });

  return {
    result: { summary: plainText(decision.summary), findings },
    limited:
      evidence.limited ||
      decision.needsMoreEvidence ||
      unverifiedQuotes ||
      !evidence.searched.length ||
      (evidence.candidates.length > 0 && !evidence.sources.length),
  };
}
