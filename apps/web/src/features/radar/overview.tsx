import { useState } from "react";
import { ArrowRight, Clock3, Plus, Search } from "lucide-react";
import { Link } from "react-router";
import { useWorkspace } from "./context";
import { CategoryIcon, Empty, FindingCard, FindingModal, Status } from "./components";
import { formatDate, type Finding } from "./model";

export default function Overview() {
  const { state, toggle } = useWorkspace();
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Finding | null>(null);
  const tasks = state.tasks.filter(
    (t) =>
      (filter === "All" || t.status === filter.toLowerCase()) &&
      `${t.title} ${t.brief}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="sky workspace-hero">
        <div className="container">
          <h1>Your tasks</h1>
          <p>
            {state.tasks.filter((t) => t.status === "active").length} active <span>·</span>{" "}
            {state.findings.filter((f) => !f.read).length} unread
          </p>
          <Link className="button primary" to="/tasks/new">
            <Plus size={17} />
            New task
          </Link>
        </div>
      </section>
      <main className="container workspace-main">
        <div className="toolbar">
          <div className="tabs">
            {["All", "Active", "Paused", "Draft"].map((f) => (
              <button
                key={f}
                className={filter === f ? "selected" : ""}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
                {f === "All" && <span>{state.tasks.length}</span>}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="task-grid">
          {tasks.map((task) => {
            const latest = state.runs.find((r) => r.taskId === task.id);
            const count = state.findings.filter((f) => f.taskId === task.id && !f.read).length;
            const path = task.status === "draft" ? `/tasks/${task.id}/edit` : `/tasks/${task.id}`;
            return (
              <article className="task-card card" key={task.id}>
                <div className="row between">
                  <span className="category">
                    <CategoryIcon category={task.category} />
                    {task.category}
                  </span>
                  <Status status={latest?.status === "running" ? "running" : task.status} />
                </div>
                <Link to={path} className="task-link">
                  <h2>{task.title}</h2>
                  <p>{task.brief}</p>
                </Link>
                <div className="schedule">
                  <Clock3 size={15} />
                  <span>
                    {task.frequency}
                    {task.frequency !== "Hourly" && ` · ${task.time}`}
                  </span>
                  {count > 0 && <span className="finding-count">{count} new</span>}
                </div>
                <div className="task-footer">
                  <span>
                    {latest ? `Last check: ${formatDate(latest.started)}` : "Not checked yet"}
                    {task.status === "active" && task.nextRunAt && <><br />Next: {formatDate(task.nextRunAt, state.preferences.timezone)}</>}
                  </span>
                  <div className="row">
                    {task.status !== "draft" && (
                      <button className="text-button" onClick={() => toggle(task.id)}>
                        {task.status === "active" ? "Pause" : "Resume"}
                      </button>
                    )}
                    <Link to={path} className="circle-button" aria-label={`Open ${task.title}`}>
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {!tasks.length && (
          <Empty
            action={
              <Link to="/tasks/new" className="button primary">
                New task
              </Link>
            }
          >
            No tasks found.
          </Empty>
        )}
        <section className="recent">
          <div className="section-row">
            <h2>Latest findings</h2>
            <Link className="text-button" to="/discoveries">
              View all <ArrowRight size={16} />
            </Link>
          </div>
          <div className="finding-grid">
            {state.findings.slice(0, 3).map((f) => (
              <FindingCard key={f.id} item={f} open={setSelected} />
            ))}
          </div>
          {!state.findings.length && <Empty>No findings yet.</Empty>}
        </section>
      </main>
      {selected && <FindingModal item={selected} close={() => setSelected(null)} />}
    </>
  );
}
