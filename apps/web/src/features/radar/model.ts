export type Frequency = "Hourly" | "Daily" | "Every 3 days" | "Weekly";
export type Category = "Technology" | "Events" | "Travel" | "Other";
export type Message = { role: "user" | "assistant"; text: string };
export type Task = {
  id: string;
  title: string;
  brief: string;
  category: Category;
  status: "active" | "paused" | "draft";
  frequency: Frequency;
  time: string;
  language: "English" | "Türkçe";
  email: boolean;
  discord: boolean;
  messages: Message[];
  failures: number;
};
export type Finding = {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  reason: string;
  source: string;
  url: string;
  category: Category;
  date: string;
  read: boolean;
  saved: boolean;
};
export type Outcome = "new" | "unchanged" | "error";
export type Run = {
  id: string;
  taskId: string;
  started: number;
  stage: number;
  status: "running" | "completed" | "failed" | "cancelled";
  outcome: Outcome;
  summary: string;
  findings: number;
  sources: string[];
};
export type Notice = {
  id: string;
  taskId: string;
  findingId: string;
  channel: "Email" | "Discord";
  date: string;
  read: boolean;
};
export type Preferences = {
  name: string;
  email: string;
  verified: boolean;
  emailEnabled: boolean;
  discord: string | null;
  timezone: string;
  language: "English" | "Türkçe";
};
export type Workspace = {
  tasks: Task[];
  findings: Finding[];
  runs: Run[];
  notices: Notice[];
  preferences: Preferences;
  checks: number;
  day: string;
};
export const frequencies: Frequency[] = ["Hourly", "Daily", "Every 3 days", "Weekly"];
export const stages = [
  "Queued",
  "Searching",
  "Reading sources",
  "Comparing results",
  "Preparing findings",
];
export const examples = [
  "Find new open-source AI tools I can run locally. Check every day.",
  "Find live jazz shows in Istanbul this weekend.",
  "Track direct return flights from Istanbul to Tokyo under €650.",
];
const base = {
  frequency: "Daily" as const,
  time: "09:00",
  language: "English" as const,
  email: true,
  discord: false,
  messages: [],
  failures: 0,
};
export const sampleTasks: Task[] = [
  {
    ...base,
    id: "ai-tools",
    title: "Open-source AI tools",
    brief: examples[0]!,
    category: "Technology",
    status: "active",
    discord: true,
  },
  {
    ...base,
    id: "istanbul",
    title: "Live music in Istanbul",
    brief: examples[1]!,
    category: "Events",
    status: "active",
    frequency: "Every 3 days",
  },
  {
    ...base,
    id: "tokyo",
    title: "Flights to Tokyo",
    brief: examples[2]!,
    category: "Travel",
    status: "paused",
    frequency: "Weekly",
  },
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
export function dayKey(timezone: string) {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}
export function seedWorkspace(name: string, email: string): Workspace {
  const now = Date.now();
  const findings: Finding[] = [samples[0]!, samples[2]!, samples[4]!].map((s, i) => ({
    ...s,
    id: `finding-${i}`,
    taskId: sampleTasks[i]!.id,
    date: new Date(now - (i + 1) * 3600000).toISOString(),
    read: i === 2,
    saved: false,
  }));
  return {
    tasks: structuredClone(sampleTasks),
    findings,
    runs: findings.map((f, i) => ({
      id: `run-${i}`,
      taskId: f.taskId,
      started: new Date(f.date).getTime(),
      stage: 5,
      status: "completed",
      outcome: "new",
      summary: "1 new finding.",
      findings: 1,
      sources: [f.url],
    })),
    notices: findings
      .slice(0, 2)
      .map((f, i) => ({
        id: `notice-${i}`,
        findingId: f.id,
        taskId: f.taskId,
        date: f.date,
        read: false,
        channel: i === 0 ? "Discord" : "Email",
      })),
    preferences: {
      name,
      email,
      verified: true,
      emailEnabled: true,
      discord: `${name}.radar`,
      timezone: "Europe/Istanbul",
      language: "English",
    },
    checks: 3,
    day: dayKey("Europe/Istanbul"),
  };
}
export function inferBrief(text: string) {
  const category: Category = /flight|uçuş|tokyo|travel/i.test(text)
    ? "Travel"
    : /music|jazz|concert|konser|caz|müzik/i.test(text)
      ? "Events"
      : /ai|model|agent|tool|açık kaynak/i.test(text)
        ? "Technology"
        : "Other";
  const frequency: Frequency = /hour|saat/i.test(text)
    ? "Hourly"
    : /weekly|her hafta|haftalık/i.test(text)
      ? "Weekly"
      : /3 days|3 gün/i.test(text)
        ? "Every 3 days"
        : "Daily";
  return {
    category,
    frequency,
    title:
      category === "Travel"
        ? "Flights to Tokyo"
        : category === "Events"
          ? "Live music in Istanbul"
          : category === "Technology"
            ? "Open-source AI tools"
            : text.slice(0, 65),
  };
}
export function advanceRuns(state: Workspace, now: number): Workspace {
  if (!state.runs.some((r) => r.status === "running")) return state;
  const next = structuredClone(state);
  next.runs = next.runs.map((run) => {
    if (run.status !== "running") return run;
    const stage = Math.min(5, Math.floor((now - run.started) / 1000));
    if (stage < 5) return { ...run, stage };
    const task = next.tasks.find((t) => t.id === run.taskId);
    if (!task || task.status !== "active")
      return { ...run, status: "cancelled", summary: "Task stopped." };
    task.failures = run.outcome === "error" ? task.failures + 1 : 0;
    if (task.failures >= 3) task.status = "paused";
    if (run.outcome === "error")
      return {
        ...run,
        stage: 2,
        status: "failed",
        summary: "Source unavailable. Try again.",
        sources: [],
      };
    const sample = samples.find(
      (s) =>
        s.category === task.category &&
        !next.findings.some((f) => f.taskId === task.id && f.url === s.url),
    );
    if (run.outcome === "unchanged" || !sample)
      return {
        ...run,
        stage,
        status: "completed",
        summary: "No new matches. No notification sent.",
        findings: 0,
        sources: samples.filter((s) => s.category === task.category).map((s) => s.url),
      };
    const finding: Finding = {
      ...sample,
      id: `finding-${run.id}`,
      taskId: task.id,
      title: task.language === "Türkçe" ? sample.trTitle : sample.title,
      summary: task.language === "Türkçe" ? sample.trSummary : sample.summary,
      reason:
        task.language === "Türkçe"
          ? `“${task.brief}” göreviyle eşleşen örnek sonuç.`
          : sample.reason,
      date: new Date(now).toISOString(),
      read: false,
      saved: false,
    };
    next.findings.unshift(finding);
    const channels: Notice["channel"][] = [];
    if (task.email && next.preferences.emailEnabled && next.preferences.verified)
      channels.push("Email");
    if (task.discord && next.preferences.discord) channels.push("Discord");
    channels.forEach((channel) =>
      next.notices.unshift({
        id: `${run.id}-${channel}`,
        taskId: task.id,
        findingId: finding.id,
        channel,
        read: false,
        date: finding.date,
      }),
    );
    return {
      ...run,
      stage,
      status: "completed",
      summary: "1 new finding.",
      sources: [sample.url],
      findings: 1,
    };
  });
  return next;
}
export function formatDate(date: string | number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
