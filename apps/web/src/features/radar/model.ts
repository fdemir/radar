export type {
  Task,
  Finding,
  Run,
  Notice,
  Preferences,
  Workspace,
  Frequency,
  Category,
  Message,
  Outcome,
} from "@radar/core";

export { frequencies } from "@radar/core";

export const stages = [
  "Queued",
  "Searching",
  "Reading sources",
  "Comparing results",
  "Preparing findings",
];

export function stageLabel(stage: number) {
  return stage === 6 ? "Checking additional sources" : (stages[stage] ?? "Checking");
}

export const examples = [
  "Find new open-source AI tools I can run locally. Check every day.",
  "Find live jazz shows in Istanbul this weekend.",
  "Track direct return flights from Istanbul to Tokyo under €650.",
];

export const samples = [
  {
    category: "Technology" as const,
    title: "Ollama: run models locally",
    summary: "A local model runner with an open-source repository and a simple setup.",
    reason: "Open source, runs locally, and needs no cloud account.",
    source: "ollama.com",
    url: "https://ollama.com",
    trTitle: "Ollama: modelleri yerelde çalıştır",
    trSummary: "Açık kaynaklı, kolay kurulan ve bilgisayarında çalışan bir model aracı.",
  },
  {
    category: "Technology" as const,
    title: "Open WebUI: a local AI workspace",
    summary: "A self-hosted interface for local models, documents, and conversations.",
    reason: "Self-hosted and compatible with local models.",
    source: "openwebui.com",
    url: "https://openwebui.com",
    trTitle: "Open WebUI: yerel yapay zekâ çalışma alanı",
    trSummary: "Yerel modeller, belgeler ve sohbetler için kendi sunucunda çalışan bir arayüz.",
  },
  {
    category: "Events" as const,
    title: "A jazz quartet at Nardis",
    summary: "An intimate evening set in Galata. Sample event: Saturday, 21:30.",
    reason: "A live jazz performance in Istanbul this weekend.",
    source: "nardisjazz.com",
    url: "https://www.nardisjazz.com",
    trTitle: "Nardis’te caz dörtlüsü",
    trSummary: "Galata’da bir akşam konseri. Örnek etkinlik: Cumartesi, 21.30.",
  },
  {
    category: "Events" as const,
    title: "Live music at Salon İKSV",
    summary: "A small-venue performance in Şişhane. Sample event: Friday, 20:30.",
    reason: "An Istanbul venue with a weekend live performance.",
    source: "saloniksv.com",
    url: "https://www.saloniksv.com",
    trTitle: "Salon İKSV’de canlı müzik",
    trSummary: "Şişhane’de küçük bir sahne. Örnek etkinlik: Cuma, 20.30.",
  },
  {
    category: "Travel" as const,
    title: "Istanbul → Tokyo · €628",
    summary: "A sample direct return fare for flexible dates in November.",
    reason: "Direct route and a return price below €650.",
    source: "turkishairlines.com",
    url: "https://www.turkishairlines.com",
    trTitle: "İstanbul → Tokyo · 628 €",
    trSummary: "Kasım ayında esnek tarihler için örnek direkt gidiş-dönüş fiyatı.",
  },
  {
    category: "Other" as const,
    title: "A matching source",
    summary: "A sample finding for your task. Live research is not connected.",
    reason: "Example result based on your task brief.",
    source: "example.com",
    url: "https://example.com",
    trTitle: "Görevin için örnek bir kaynak",
    trSummary: "Görev metnine göre hazırlanmış örnek bulgu. Canlı araştırma bağlı değil.",
  },
];

export function formatDate(date: string | number, timezone?: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
