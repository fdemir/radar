import { useState } from "react";
import { CheckCheck, Search } from "lucide-react";
import { useWorkspace } from "./context";
import { Empty, FindingCard, FindingModal, PageTitle } from "./components";
import type { Finding } from "./model";

export default function Discoveries() {
  const { state, readFindings } = useWorkspace();
  const [tab, setTab] = useState("All");
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const findings = state.findings.filter(
    (f) =>
      (tab === "All" || (tab === "Saved" ? f.saved : !f.read)) &&
      (task === "all" || f.taskId === task) &&
      `${f.title} ${f.summary} ${f.source}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className="container workspace-main">
      <PageTitle
        title="Discoveries"
        action={
          <button className="button secondary" onClick={readFindings}>
            <CheckCheck size={17} />
            Mark all read
          </button>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {["All", "Unread", "Saved"].map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
              <span>
                {
                  state.findings.filter((f) => t === "All" || (t === "Saved" ? f.saved : !f.read))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="row">
          <select
            aria-label="Filter by task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
          >
            <option value="all">All tasks</option>
            {state.tasks.map((t) => (
              <option value={t.id} key={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search findings"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="finding-grid">
        {findings.map((f) => (
          <FindingCard key={f.id} item={f} open={setSelected} />
        ))}
      </div>
      {!findings.length && <Empty>No findings match your filters.</Empty>}
      {selected && <FindingModal item={selected} close={() => setSelected(null)} />}
    </main>
  );
}
