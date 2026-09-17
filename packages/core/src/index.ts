import z from "zod";

export const frequencies = ["Hourly", "Daily", "Every 3 days", "Weekly"] as const;

export const categorySchema = z.enum(["Technology", "Events", "Travel", "Other"]);

export const languageSchema = z.enum(["English", "Türkçe"]);

export const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(4000),
});

export const taskInputSchema = z
  .object({
    title: z.string().trim().max(90),
    brief: z.string().trim().max(6000),
    category: categorySchema,
    status: z.enum(["active", "paused", "draft"]),
    frequency: z.enum(frequencies),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time."),
    language: languageSchema,
    email: z.boolean(),
    messages: z.array(messageSchema).max(80),
    revision: z.number().int().nonnegative().default(0),
  })
  .refine((task) => task.status === "draft" || (task.title.length > 0 && task.brief.length >= 10), {
    message: "Add a title and at least 10 characters in the brief.",
  });

export const taskSchema = taskInputSchema.safeExtend({
  id: z.string(),
  failures: z.number().int().nonnegative(),
  nextRunAt: z.number().nullable().default(null),
});

export const timezoneSchema = z
  .string()
  .max(100)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });

      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone.");

export const preferencesInputSchema = z
  .object({
    name: z.string().trim().min(2).max(40).optional(),
    emailEnabled: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    language: languageSchema.optional(),
  })
  .strict();

export const preferencesSchema = z.object({
  name: z.string(),
  email: z.string(),
  verified: z.boolean(),
  emailEnabled: z.boolean(),
  timezone: timezoneSchema,
  language: languageSchema,
});

export const findingSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string(),
  summary: z.string(),
  reason: z.string(),
  source: z.string(),
  url: z.url(),
  category: categorySchema,
  date: z.iso.datetime(),
  read: z.boolean(),
  saved: z.boolean(),
});

export const runSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  started: z.number(),
  finished: z.number().nullable(),
  stage: z.number().int(),
  retryAt: z.number().nullable().default(null),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  outcome: z.enum(["new", "unchanged", "error"]),
  coverage: z.enum(["complete", "limited"]).default("complete"),
  summary: z.string(),
  findings: z.number().int(),
  sources: z.array(z.url()),
});

export const noticeSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  findingId: z.string(),
  channel: z.literal("Email"),
  date: z.iso.datetime(),
  read: z.boolean(),
});

export const workspaceSchema = z.object({
  emailAvailable: z.boolean().default(false),
  researchAvailable: z.boolean().default(false),
  tasks: z.array(taskSchema),
  findings: z.array(findingSchema),
  runs: z.array(runSchema),
  notices: z.array(noticeSchema),
  preferences: preferencesSchema,
  checks: z.number(),
  day: z.string(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export type Task = z.infer<typeof taskSchema>;

export type Frequency = Task["frequency"];

export type Category = Task["category"];

export type Message = z.infer<typeof messageSchema>;

export type PreferencesInput = z.infer<typeof preferencesInputSchema>;

export type Preferences = z.infer<typeof preferencesSchema>;

export type Finding = z.infer<typeof findingSchema>;

export type Run = z.infer<typeof runSchema>;

export type Notice = z.infer<typeof noticeSchema>;

export type Workspace = z.infer<typeof workspaceSchema>;

export type Outcome = Run["outcome"];

export function dayKey(timezone: string, now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}
