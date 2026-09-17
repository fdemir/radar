import { useState } from "react";
import { Check, Circle, Pencil, SlidersHorizontal } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@radar/ui/components/accordion";
import { Button } from "@radar/ui/components/button";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@radar/ui/components/native-select";
import { Switch } from "@radar/ui/components/switch";
import { Textarea } from "@radar/ui/components/textarea";
import {
  categorySchema,
  frequencies,
  languageSchema,
  taskInputSchema,
  type Task,
} from "@radar/core";

type Field = "title" | "brief" | "category" | "schedule" | "language" | "email";

export function TaskSetupSummary({
  task,
  timezone,
  disabled,
  onChange,
}: {
  task: Task;
  timezone: string;
  disabled: boolean;
  onChange: (task: Task) => void;
}) {
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState(task);
  const [error, setError] = useState("");
  const fields: { key: Field; label: string; value: string; complete: boolean }[] = [
    { key: "title", label: "Title", value: task.title, complete: Boolean(task.title.trim()) },
    { key: "brief", label: "Brief", value: task.brief, complete: task.brief.trim().length >= 10 },
    { key: "category", label: "Interest", value: task.category, complete: true },
    {
      key: "schedule",
      label: "Schedule",
      value: `${task.frequency}${task.frequency === "Hourly" ? "" : ` at ${task.time}`} · ${timezone}`,
      complete: true,
    },
    { key: "language", label: "Results in", value: task.language, complete: true },
    {
      key: "email",
      label: "Email notifications",
      value: task.email ? "Email on" : "Email off",
      complete: true,
    },
  ];

  function edit(field: Field) {
    setDraft(task);
    setError("");
    setEditing(field);
  }

  function save() {
    const parsed = taskInputSchema.safeParse({ ...draft, status: "draft" });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check this field.");

      return;
    }

    onChange({ ...draft, ...parsed.data, status: task.status });
    setEditing(null);
  }

  return (
    <Accordion
      defaultValue={["details"]}
      className="max-w-xl rounded-2xl border border-dashed bg-background"
    >
      <AccordionItem value="details" className="border-0">
        <AccordionTrigger className="items-center px-5 py-4 hover:no-underline">
          <span className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4 text-sky-accent" />
            Task details
          </span>
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {fields.filter((field) => field.complete).length}/{fields.length}
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-2">
          <div className="divide-y">
            {fields.map((field) => (
              <div className="py-3" key={field.key}>
                <div className="flex items-start gap-3">
                  {field.complete ? (
                    <Check className="mt-1 size-4 shrink-0 text-sky-accent" />
                  ) : (
                    <Circle className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{field.label}</p>
                    {editing !== field.key && (
                      <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                        {field.value || "Not set"}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${field.label.toLowerCase()}`}
                    disabled={disabled}
                    onClick={() => edit(field.key)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
                {editing === field.key && (
                  <div className="mt-3 ml-7 space-y-3">
                    {field.key === "title" && (
                      <Input
                        autoFocus
                        aria-label="Title"
                        maxLength={90}
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      />
                    )}
                    {field.key === "brief" && (
                      <Textarea
                        autoFocus
                        aria-label="Brief"
                        rows={4}
                        maxLength={6000}
                        value={draft.brief}
                        onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
                      />
                    )}
                    {field.key === "category" && (
                      <NativeSelect
                        aria-label="Interest"
                        value={draft.category}
                        onChange={(event) =>
                          setDraft({ ...draft, category: categorySchema.parse(event.target.value) })
                        }
                      >
                        {categorySchema.options.map((category) => (
                          <NativeSelectOption key={category}>{category}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                    {field.key === "language" && (
                      <NativeSelect
                        aria-label="Results in"
                        value={draft.language}
                        onChange={(event) =>
                          setDraft({ ...draft, language: languageSchema.parse(event.target.value) })
                        }
                      >
                        {languageSchema.options.map((language) => (
                          <NativeSelectOption key={language}>{language}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                    {field.key === "schedule" && (
                      <div className="flex flex-wrap gap-3">
                        <Label className="flex-col items-start">
                          Frequency
                          <NativeSelect
                            value={draft.frequency}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                frequency: taskInputSchema.shape.frequency.parse(
                                  event.target.value,
                                ),
                              })
                            }
                          >
                            {frequencies.map((frequency) => (
                              <NativeSelectOption key={frequency}>{frequency}</NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </Label>
                        <Label className="flex-col items-start">
                          Time
                          <Input
                            type="time"
                            disabled={draft.frequency === "Hourly"}
                            value={draft.time}
                            onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                          />
                        </Label>
                      </div>
                    )}
                    {field.key === "email" && (
                      <Label>
                        Email
                        <Switch
                          aria-label="Task email notifications"
                          checked={draft.email}
                          onCheckedChange={(email) => setDraft({ ...draft, email })}
                        />
                      </Label>
                    )}
                    {error && (
                      <p className="text-xs text-destructive" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" disabled={disabled} onClick={save}>
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
