import { Button } from "@radar/ui/components/button";
import { Card } from "@radar/ui/components/card";
import { Input } from "@radar/ui/components/input";
import { Label } from "@radar/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@radar/ui/components/native-select";
import { Switch } from "@radar/ui/components/switch";
import { Textarea } from "@radar/ui/components/textarea";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, MessageSquare, Plus } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { taskInputSchema } from "@radar/core";
import { api } from "./api";
import { useWorkspace } from "./context";
import { Empty, PageTitle, TaskMessages, WorkspacePage } from "./components";
import { examples, frequencies, type Category, type Frequency, type Task } from "./model";

export default function Editor() {
  const { state, save, pending } = useWorkspace();
  const { taskId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const existing = state.tasks.find((t) => t.id === taskId);
  const prompt = params.get("prompt") ?? "";
  const [task, setTask] = useState<Task>(() =>
    existing
      ? structuredClone(existing)
      : {
          id: crypto.randomUUID(),
          title: "",
          category: "Other",
          frequency: "Daily",
          revision: 0,
          brief: "",
          status: "draft",
          time: "09:00",
          language: /türkçe|turkish/i.test(prompt) ? "Türkçe" : state.preferences.language,
          email: state.preferences.emailEnabled,
          failures: 0,
          nextRunAt: null,
          messages: [],
        },
  );
  const [input, setInput] = useState(prompt);
  const [thinking, setThinking] = useState(false);
  const chat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [task.messages.length, thinking]);

  async function send(text = input) {
    const content = text.trim();

    if (!content || thinking) return;

    setThinking(true);

    try {
      const result = taskInputSchema.parse(
        await api("/tasks/compose", "POST", {
          task: taskInputSchema.parse({ ...task, status: "draft" }),
          message: content,
        }),
      );

      setTask((current) => ({ ...current, ...result, status: current.status }));
      setInput("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the brief.");
    } finally {
      setThinking(false);
    }
  }

  const ready =
    task.title.trim().length > 0 &&
    task.brief.trim().length >= 10 &&
    (task.frequency === "Hourly" || Boolean(task.time));

  async function submit(active: boolean) {
    if (active && !ready) return;

    const next: Task = {
      ...task,
      title: task.title.trim() || "Untitled task",
      status: active ? "active" : "draft",
      failures: 0,
    };
    const id = await save(next);

    if (id) {
      toast(active ? "Task saved" : "Draft saved");
      navigate(active ? `/tasks/${id}` : "/tasks");
    }
  }

  if (taskId && !existing)
    return (
      <WorkspacePage>
        <Empty action={<Link to="/tasks">Back to tasks</Link>}>Task not found.</Empty>
      </WorkspacePage>
    );

  return (
    <WorkspacePage>
      <PageTitle
        title={existing ? "Edit task" : "New task"}
        back={existing ? `/tasks/${existing.id}` : "/tasks"}
      />
      <div className="grid items-start gap-7 md:grid-cols-2">
        <Card className="gap-0 py-0 md:sticky md:top-27">
          <div className="flex items-center gap-2.5 border-b p-6">
            <MessageSquare size={19} className="text-sky-accent" />
            <h2 className="text-lg">Task setup</h2>
          </div>
          <div className="h-80 overflow-y-auto p-5 md:h-110 md:p-7" ref={chat} aria-live="polite">
            {task.messages.length ? (
              <TaskMessages messages={task.messages} />
            ) : (
              <div className="pt-7 text-center md:pt-15">
                <MessageSquare
                  size={27}
                  strokeWidth={1.4}
                  className="mx-auto mb-5 text-sky-accent"
                />
                <h3>What should Radar follow?</h3>
                <div className="mx-auto mt-6 grid max-w-75 gap-2.5">
                  {examples.map((e, i) => (
                    <Button
                      variant="outline"
                      className="justify-between rounded-xl text-[13px] font-normal"
                      key={e}
                      disabled={thinking || pending}
                      onClick={() => send(e)}
                    >
                      {["Open-source AI tools", "Concerts in Istanbul", "Flights to Tokyo"][i]}
                      <Plus size={16} />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {thinking && <p className="text-xs">Updating task…</p>}
          </div>
          <form
            className="m-5 mt-0 flex items-end rounded-2xl border p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Textarea
              aria-label="Message to Radar"
              className="min-h-17 flex-1 resize-none border-0 p-2 text-[13px]"
              disabled={thinking || pending}
              placeholder="Describe what to look for…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={!input.trim() || thinking || pending}
            >
              <ArrowUp size={20} />
            </Button>
          </form>
        </Card>
        <Card className="gap-0 p-6 lg:p-9">
          <h2 className="mb-7 text-2xl">Details</h2>
          <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
            Title
            <Input
              disabled={thinking || pending}
              value={task.title}
              maxLength={90}
              onChange={(e) => setTask((t) => ({ ...t, title: e.target.value }))}
            />
          </Label>
          <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
            Brief
            <Textarea
              disabled={thinking || pending}
              value={task.brief}
              rows={4}
              maxLength={6000}
              onChange={(e) => setTask((t) => ({ ...t, brief: e.target.value }))}
              placeholder="What qualifies as a useful result?"
            />
          </Label>
          <div className="grid grid-cols-2 gap-4">
            <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
              Interest
              <NativeSelect
                disabled={thinking || pending}
                value={task.category}
                onChange={(e) => setTask((t) => ({ ...t, category: e.target.value as Category }))}
              >
                {["Technology", "Events", "Travel", "Other"].map((c) => (
                  <NativeSelectOption key={c}>{c}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
            <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
              Results in
              <NativeSelect
                disabled={thinking || pending}
                value={task.language}
                onChange={(e) =>
                  setTask((t) => ({ ...t, language: e.target.value as Task["language"] }))
                }
              >
                <NativeSelectOption>English</NativeSelectOption>
                <NativeSelectOption>Türkçe</NativeSelectOption>
              </NativeSelect>
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
              Frequency
              <NativeSelect
                disabled={thinking || pending}
                value={task.frequency}
                onChange={(e) => setTask((t) => ({ ...t, frequency: e.target.value as Frequency }))}
              >
                {frequencies.map((f) => (
                  <NativeSelectOption key={f}>{f}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
            <Label className="mb-5 flex-col items-stretch gap-2 text-[13px]">
              Time
              <Input
                type="time"
                value={task.time}
                disabled={task.frequency === "Hourly" || thinking || pending}
                onChange={(e) => setTask((t) => ({ ...t, time: e.target.value }))}
              />
            </Label>
          </div>
          <p className="text-xs [&_a]:underline [&_a]:underline-offset-3">
            {state.preferences.timezone} · <Link to="/settings">Change</Link>
          </p>
          <div className="my-7 border-t pt-6">
            <h3 className="mb-4 text-sm tracking-normal">Notify me via</h3>
            <div className="flex items-center justify-between gap-3">
              <span>
                Email
                {!state.preferences.verified && (
                  <small className="block text-[11px] text-muted-foreground">
                    Verify in Settings
                  </small>
                )}
              </span>
              <Switch
                aria-label="Task email notifications"
                disabled={thinking || pending}
                checked={task.email}
                onCheckedChange={(email) => setTask((t) => ({ ...t, email }))}
              />
            </div>
          </div>
          <Button
            className="w-full"
            disabled={!ready || thinking || pending}
            onClick={() => submit(true)}
          >
            {existing ? <Check size={17} /> : <ArrowUpRight size={17} />}
            {existing ? "Save & run" : "Activate & run"}
          </Button>
          <Button
            variant="link"
            className="mt-2 w-full"
            disabled={thinking || pending}
            onClick={() => submit(false)}
          >
            Save draft
          </Button>
        </Card>
      </div>
    </WorkspacePage>
  );
}
