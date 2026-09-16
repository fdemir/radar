import { WorkspaceContext } from "./context";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  advanceRuns,
  dayKey,
  seedWorkspace,
  type Finding,
  type Outcome,
  type Preferences,
  type Task,
  type Workspace,
} from "./model";

function useStore(accountId: string, name: string, email: string) {
  const key = `radar-letters-v1:${accountId}`;
  const [state, setState] = useState<Workspace>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) {
        const saved = JSON.parse(raw) as Workspace;
        if (
          Array.isArray(saved.tasks) &&
          Array.isArray(saved.findings) &&
          Array.isArray(saved.runs) &&
          Array.isArray(saved.notices) &&
          saved.preferences &&
          typeof saved.checks === "number"
        )
          return saved;
      }
    } catch {
      /* Use sample data if browser storage is unavailable. */
    }
    return seedWorkspace(name, email);
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      toast.error("Browser storage is unavailable. Changes will not survive a reload.", {
        id: "storage",
      });
    }
  }, [state, key]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setState((current) => {
          const today = dayKey(current.preferences.timezone);
          return advanceRuns(
            current.day === today ? current : { ...current, day: today, checks: 0 },
            Date.now(),
          );
        }),
      500,
    );
    return () => clearInterval(timer);
  }, []);
  function save(task: Task) {
    if (task.status === "active" && (!task.title.trim() || task.brief.trim().length < 10)) {
      toast.error("Add a title and at least 10 characters in the brief.");
      return false;
    }
    if (
      task.status === "active" &&
      state.tasks.filter((t) => t.status === "active" && t.id !== task.id).length >= 5
    ) {
      toast.error("5 active tasks maximum. Pause a task first.");
      return false;
    }
    setState((s) => ({
      ...s,
      tasks: s.tasks.some((t) => t.id === task.id)
        ? s.tasks.map((t) => (t.id === task.id ? task : t))
        : [task, ...s.tasks],
      runs: s.runs.map((r) =>
        r.taskId === task.id && r.status === "running"
          ? { ...r, status: "cancelled", summary: "Task changed." }
          : r,
      ),
    }));
    return true;
  }
  function toggle(id: string) {
    const task = state.tasks.find((t) => t.id === id);
    if (
      task &&
      save({ ...task, status: task.status === "active" ? "paused" : "active", failures: 0 })
    )
      toast(task.status === "active" ? "Task paused" : "Task resumed");
  }
  function run(id: string, outcome: Outcome = "new") {
    const task = state.tasks.find((t) => t.id === id);
    if (
      !task ||
      task.status !== "active" ||
      state.runs.some((r) => r.taskId === id && r.status === "running")
    )
      return false;
    if (state.day === dayKey(state.preferences.timezone) && state.checks >= 30) {
      toast.error("Daily limit reached: 30 checks.");
      return false;
    }
    if (state.runs.some((r) => r.taskId === id && Date.now() - r.started < 10000)) {
      toast("Wait 10 seconds between checks.");
      return false;
    }
    setState((s) => ({
      ...s,
      checks: s.day === dayKey(s.preferences.timezone) ? s.checks + 1 : 1,
      day: dayKey(s.preferences.timezone),
      runs: [
        {
          id: crypto.randomUUID(),
          taskId: id,
          started: Date.now(),
          stage: 0,
          status: "running",
          outcome,
          summary: "Research in progress.",
          findings: 0,
          sources: [],
        },
        ...s.runs,
      ],
    }));
    return true;
  }
  function remove(id: string) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.filter((t) => t.id !== id),
      findings: s.findings.filter((f) => f.taskId !== id),
      runs: s.runs.filter((r) => r.taskId !== id),
      notices: s.notices.filter((n) => n.taskId !== id),
    }));
    toast("Task deleted");
  }
  function finding(id: string, patch: Partial<Pick<Finding, "saved" | "read">>) {
    setState((s) => ({
      ...s,
      findings: s.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }
  function preferences(patch: Partial<Preferences>) {
    setState((s) => ({
      ...s,
      preferences: { ...s.preferences, ...patch },
      tasks: patch.discord === null ? s.tasks.map((t) => ({ ...t, discord: false })) : s.tasks,
    }));
  }
  return {
    state,
    save,
    run,
    toggle,
    remove,
    finding,
    preferences,
    readNotices: (id?: string) =>
      setState((s) => ({
        ...s,
        notices: s.notices.map((n) => (!id || n.id === id ? { ...n, read: true } : n)),
      })),
    readFindings: () =>
      setState((s) => ({ ...s, findings: s.findings.map((f) => ({ ...f, read: true })) })),
    reset: () => {
      setState(seedWorkspace(name, email));
      toast("Sample data restored");
    },
  };
}
export function WorkspaceProvider({
  children,
  id,
  name,
  email,
}: {
  children: ReactNode;
  id: string;
  name: string;
  email: string;
}) {
  const store = useStore(id, name, email);
  return <WorkspaceContext value={store}>{children}</WorkspaceContext>;
}
