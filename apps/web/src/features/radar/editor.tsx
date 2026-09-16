import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, MessageSquare, Plus } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { taskInputSchema } from "@radar/core";
import { api } from "./api";
import { useWorkspace } from "./context";
import { Empty, PageTitle, Toggle } from "./components";
import {
  examples,
  frequencies,
  type Category,
  type Frequency,
  type Task,
} from "./model";

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
          title: "", category: "Other", frequency: "Daily", revision: 0,
          brief: "",
          status: "draft",
          time: "09:00",
          language: /türkçe|turkish/i.test(prompt) ? "Türkçe" : state.preferences.language,
          email: state.preferences.emailEnabled,
          failures: 0, nextRunAt: null,
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
      const result = taskInputSchema.parse(await api("/tasks/compose", "POST", { task: taskInputSchema.parse({ ...task, status: "draft" }), message: content }));
      setTask((current) => ({ ...current, ...result, status: current.status }));
      setInput("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the brief."); }
    finally { setThinking(false); }
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
      <main className="container">
        <Empty action={<Link to="/tasks">Back to tasks</Link>}>Task not found.</Empty>
      </main>
    );
  return (
    <main className="container workspace-main">
      <PageTitle
        title={existing ? "Edit task" : "New task"}
        back={existing ? `/tasks/${existing.id}` : "/tasks"}
      />
      <div className="editor-grid">
        <section className="card chat-card">
          <div className="panel-heading">
            <MessageSquare size={19} className="blue-icon" />
            <h2>Task setup</h2>
          </div>
          <div className="chat-messages" ref={chat} aria-live="polite">
            {task.messages.length ? (
              task.messages.map((m, i) => (
                <div className={`message ${m.role}`} key={i}>
                  <span>{m.role === "user" ? "You" : "Radar"}</span>
                  <p>{m.text}</p>
                </div>
              ))
            ) : (
              <div className="chat-empty">
                <MessageSquare size={27} strokeWidth={1.4} />
                <h3>What should Radar follow?</h3>
                <div className="suggestions">
                  {examples.map((e, i) => (
                    <button key={e} disabled={thinking || pending} onClick={() => send(e)}>
                      {["Open-source AI tools", "Concerts in Istanbul", "Flights to Tokyo"][i]}
                      <Plus size={16} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {thinking && <p className="thinking">Updating task…</p>}
          </div>
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              aria-label="Message to Radar"
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
            <button
              className="circle-button dark"
              aria-label="Send message"
              disabled={!input.trim() || thinking || pending}
            >
              <ArrowUp size={20} />
            </button>
          </form>
        </section>
        <section className="card setup-card">
          <h2>Details</h2>
          <label>
            Title
            <input
              disabled={thinking || pending}
              value={task.title}
              maxLength={90}
              onChange={(e) => setTask((t) => ({ ...t, title: e.target.value }))}
            />
          </label>
          <label>
            Brief
            <textarea
              disabled={thinking || pending}
              value={task.brief}
              rows={4}
              maxLength={6000}
              onChange={(e) => setTask((t) => ({ ...t, brief: e.target.value }))}
              placeholder="What qualifies as a useful result?"
            />
          </label>
          <div className="field-row">
            <label>
              Interest
              <select
                disabled={thinking || pending}
              value={task.category}
                onChange={(e) => setTask((t) => ({ ...t, category: e.target.value as Category }))}
              >
                {["Technology", "Events", "Travel", "Other"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Results in
              <select
                disabled={thinking || pending}
              value={task.language}
                onChange={(e) =>
                  setTask((t) => ({ ...t, language: e.target.value as Task["language"] }))
                }
              >
                <option>English</option>
                <option>Türkçe</option>
              </select>
            </label>
          </div>
          <div className="field-row">
            <label>
              Frequency
              <select
                disabled={thinking || pending}
              value={task.frequency}
                onChange={(e) => setTask((t) => ({ ...t, frequency: e.target.value as Frequency }))}
              >
                {frequencies.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              Time
              <input
                type="time"
                value={task.time}
                disabled={task.frequency === "Hourly" || thinking || pending}
                onChange={(e) => setTask((t) => ({ ...t, time: e.target.value }))}
              />
            </label>
          </div>
          <p className="caption">
            {state.preferences.timezone} · <Link to="/settings">Change</Link>
          </p>
          <div className="notification-options">
            <h3>Notify me via</h3>
            <div className="row between">
              <span>Email{!state.preferences.verified && <small>Verify in Settings</small>}</span>
              <Toggle
                label="Task email notifications"
                disabled={thinking || pending}
                checked={task.email}
                change={(email) => setTask((t) => ({ ...t, email }))}
              />
            </div>
          </div>
          <button
            className="button primary full"
            disabled={!ready || thinking || pending}
            onClick={() => submit(true)}
          >
            {existing ? <Check size={17} /> : <ArrowUpRight size={17} />}
            {existing ? "Save & run" : "Activate & run"}
          </button>
          <button className="text-button full" disabled={thinking || pending} onClick={() => submit(false)}>
            Save draft
          </button>
        </section>
      </div>
    </main>
  );
}
