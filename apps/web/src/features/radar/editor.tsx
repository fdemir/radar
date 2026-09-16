import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, MessageSquare, Plus } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useWorkspace } from "./context";
import { Empty, PageTitle, Toggle } from "./components";
import {
  examples,
  frequencies,
  inferBrief,
  type Category,
  type Frequency,
  type Task,
} from "./model";

export default function Editor() {
  const { state, save } = useWorkspace();
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
          ...inferBrief(prompt),
          brief: prompt,
          status: "draft",
          time: "09:00",
          language: /türkçe|turkish/i.test(prompt) ? "Türkçe" : state.preferences.language,
          email: state.preferences.emailEnabled,
          discord: false,
          failures: 0,
          messages: prompt
            ? [
                { role: "user", text: prompt },
                { role: "assistant", text: "Review the details, then activate your task." },
              ]
            : [],
        },
  );
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chat = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );
  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [task.messages.length, thinking]);
  function send(text = input) {
    const content = text.trim();
    if (!content || thinking) return;
    setInput("");
    setThinking(true);
    setTask((t) => ({ ...t, messages: [...t.messages, { role: "user", text: content }] }));
    timeout.current = setTimeout(() => {
      setTask((t) => {
        const inferred = inferBrief(content);
        const changeFrequency =
          /hour|saat|weekly|daily|every day|her gün|haftalık|her hafta|3 days|3 gün/i.test(content);
        return {
          ...t,
          title: t.title || inferred.title,
          brief: t.brief ? `${t.brief}\n${content}` : content,
          category: t.brief ? t.category : inferred.category,
          frequency: changeFrequency ? inferred.frequency : t.frequency,
          language: /türkçe|turkish/i.test(content) ? "Türkçe" : t.language,
          messages: [
            ...t.messages,
            {
              role: "assistant",
              text: t.brief
                ? "Brief updated. Review the details before saving."
                : `Set to ${inferred.frequency.toLowerCase()}. Any location, budget, or source preferences?`,
            },
          ],
        };
      });
      setThinking(false);
    }, 700);
  }
  const ready =
    task.title.trim().length > 0 &&
    task.brief.trim().length >= 10 &&
    (task.frequency === "Hourly" || Boolean(task.time));
  function submit(active: boolean) {
    if (active && !ready) return;
    const next: Task = {
      ...task,
      title: task.title.trim() || "Untitled task",
      status: active ? "active" : "draft",
      failures: 0,
    };
    if (save(next)) {
      toast(active ? "Task saved" : "Draft saved");
      navigate(active ? `/tasks/${task.id}?run=1` : "/tasks");
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
            <span className="caption">Sample assistant</span>
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
                    <button key={e} onClick={() => send(e)}>
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
              disabled={!input.trim() || thinking}
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
              value={task.title}
              maxLength={90}
              onChange={(e) => setTask((t) => ({ ...t, title: e.target.value }))}
            />
          </label>
          <label>
            Brief
            <textarea
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
                disabled={task.frequency === "Hourly"}
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
                checked={task.email}
                change={(email) => setTask((t) => ({ ...t, email }))}
              />
            </div>
            <div className="row between">
              <span>Discord{!state.preferences.discord && <small>Connect in Settings</small>}</span>
              <Toggle
                label="Task Discord notifications"
                checked={task.discord && Boolean(state.preferences.discord)}
                disabled={!state.preferences.discord}
                change={(discord) => setTask((t) => ({ ...t, discord }))}
              />
            </div>
          </div>
          <button
            className="button primary full"
            disabled={!ready || thinking}
            onClick={() => submit(true)}
          >
            {existing ? <Check size={17} /> : <ArrowUpRight size={17} />}
            {existing ? "Save & run" : "Activate & run"}
          </button>
          <button className="text-button full" disabled={thinking} onClick={() => submit(false)}>
            Save draft
          </button>
        </section>
      </div>
    </main>
  );
}
