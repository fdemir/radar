import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  LoaderCircle,
  Mail,
  Pause,
  Pencil,
  Play,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useWorkspace } from "./context";
import { Empty, FindingCard, FindingModal, Modal, PageTitle, Status } from "./components";
import { formatDate, stages, type Finding } from "./model";

export default function Detail() {
  const { state, run, toggle, remove, pending } = useWorkspace();
  const { taskId } = useParams();
  const navigate = useNavigate();
  const task = state.tasks.find((t) => t.id === taskId);
  const runs = state.runs.filter((r) => r.taskId === taskId);
  const running = runs.find((r) => r.status === "running");
  const findings = state.findings.filter((f) => f.taskId === taskId);
  const [tab, setTab] = useState("Findings");
  const [selected, setSelected] = useState<Finding | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const cooldown = runs[0] ? Math.max(0, Math.ceil((runs[0].started + 10000 - now) / 1000)) : 0;
  if (!task)
    return (
      <main className="container">
        <Empty
          action={
            <Link className="button primary" to="/tasks">
              Back to tasks
            </Link>
          }
        >
          Task not found.
        </Empty>
      </main>
    );
  return (
    <main className="container workspace-main">
      <PageTitle
        title={task.title}
        back="/tasks"
        action={
          <div className="row">
            <Link className="button secondary" to={`/tasks/${task.id}/edit`}>
              <Pencil size={16} />
              Edit
            </Link>
            <button
              className="icon-button"
              aria-label="Delete task"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={18} />
            </button>
          </div>
        }
      />
      <section className="card task-summary">
        <div className="row between">
          <Status status={running ? "running" : task.status} />
          <span className="caption">
            <Clock3 size={14} />
            {task.frequency}
            {task.frequency !== "Hourly" && ` at ${task.time}`} · {state.preferences.timezone}
          </span>
        </div>
        <p className="brief-text">{task.brief}</p>
        <div className="row between">
          <span className="caption">
            <Mail size={15} />
            {task.email ? "Email" : "In-app only"} · {task.language}
          </span>
          <div className="row">
            {task.status !== "draft" && (
              <button className="button secondary" onClick={() => toggle(task.id)}>
                {task.status === "active" ? <Pause size={16} /> : <Play size={16} />}
                {task.status === "active" ? "Pause" : "Resume"}
              </button>
            )}
            <button
              className="button primary"
              disabled={
                pending ||
                task.status !== "active" ||
                Boolean(running) ||
                cooldown > 0 ||
                state.checks >= 30
              }
              onClick={() => run(task.id)}
            >
              {running ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              {running
                ? "Checking…"
                : cooldown
                  ? `Wait ${cooldown}s`
                  : state.checks >= 30
                    ? "Daily limit reached"
                    : "Run now"}
            </button>
          </div>
        </div>
      </section>
      {task.failures >= 3 && (
        <div className="notice">
          <TriangleAlert size={20} />
          <span>Paused after 3 failed checks. Resume to try again.</span>
        </div>
      )}
      {running && (
        <section className="run-progress card" aria-live="polite">
          {stages.map((stage, i) => (
            <span key={stage} className={i <= running.stage ? "reached" : ""}>
              {i < running.stage ? (
                <Check size={18} />
              ) : i === running.stage ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Circle size={18} />
              )}
              {stage}
            </span>
          ))}
        </section>
      )}
      <div className="toolbar detail-toolbar">
        <div className="tabs">
          {["Findings", "Run history", "Conversation"].map((t) => (
            <button
              key={t}
              className={t === tab ? "selected" : ""}
              aria-pressed={t === tab}
              onClick={() => setTab(t)}
            >
              {t}
              <span>
                {t === "Findings"
                  ? findings.length
                  : t === "Run history"
                    ? runs.length
                    : task.messages.length}
              </span>
            </button>
          ))}
        </div>
      </div>
      {tab === "Findings" ? (
        <>
          <div className="finding-grid">
            {findings.map((f) => (
              <FindingCard key={f.id} item={f} open={setSelected} />
            ))}
          </div>
          {!findings.length && <Empty>Run a check to find your first result.</Empty>}
          {!running && runs[0] && <p className="result-summary">Last check: {runs[0].summary}</p>}
        </>
      ) : tab === "Run history" ? (
        <div className="card history">
          {runs.map((r) => (
            <details key={r.id}>
              <summary>
                <span className="run-status-icon">
                  {r.status === "failed" ? (
                    <TriangleAlert size={19} />
                  ) : r.status === "running" ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : r.status === "cancelled" ? (
                    <Pause size={19} />
                  ) : (
                    <Check size={19} />
                  )}
                </span>
                <span>
                  <strong>{r.status === "running" ? stages[r.stage] : r.summary}</strong>
                  <small>
                    {formatDate(r.started)} ·{" "}
                    {r.status === "running"
                      ? "In progress"
                      : r.status === "cancelled"
                        ? "Cancelled"
                        : `${Math.max(0, Math.round(((r.finished ?? r.started) - r.started) / 1000))} sec`}{" "}
                    · {r.sources.length} sources
                  </small>
                </span>
                <ChevronDown size={18} />
              </summary>
              <div className="history-details">
                <p>{r.findings} new findings</p>
                {r.sources.map((source) => (
                  <a key={source} href={source} target="_blank" rel="noreferrer">
                    {new URL(source).hostname}
                    <ArrowUpRight size={14} />
                  </a>
                ))}
                {r.status === "failed" && <p>No results saved. Retry from Run now.</p>}
              </div>
            </details>
          ))}
          {!runs.length && <Empty>No checks yet.</Empty>}
        </div>
      ) : (
        <div className="card conversation">
          {task.messages.map((m, i) => (
            <div className={`message ${m.role}`} key={i}>
              <span>{m.role === "user" ? "You" : "Radar"}</span>
              <p>{m.text}</p>
            </div>
          ))}
          {!task.messages.length && <Empty>No setup conversation.</Empty>}
          <Link className="button secondary" to={`/tasks/${task.id}/edit`}>
            Edit task <Pencil size={15} />
          </Link>
        </div>
      )}
      {selected && <FindingModal item={selected} close={() => setSelected(null)} />}
      {deleting && (
        <Modal title="Delete task?" close={() => setDeleting(false)}>
          <p>“{task.title}” and its findings, history and notifications will be removed.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={pending}
              onClick={async () => {
                if (await remove(task.id)) navigate("/tasks");
              }}
            >
              Delete task
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
