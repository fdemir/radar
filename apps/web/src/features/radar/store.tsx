import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import z from "zod";
import { taskInputSchema, workspaceSchema, type Workspace, type Task } from "@radar/core";
import { WorkspaceContext, type WorkspaceStore } from "./context";
import { api } from "./api";

export function WorkspaceProvider({ children, initial }: { children: ReactNode; initial: Workspace }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const next = workspaceSchema.parse(await api("/workspace"));
    if (request === sequence.current) setState(next);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (busy.current || document.visibilityState === "hidden") return;
      void refresh().catch(() => toast.error("Connection lost. Retrying…", { id: "workspace-connection" }));
    }, state.runs.some((run) => run.status === "running") ? 2000 : 15000);
    const focus = () => { if (!busy.current) void refresh().catch(() => {}); };
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh, state.runs]);
  async function write(action: () => Promise<unknown>) {
    if (busy.current) return false;
    busy.current = true;
    sequence.current++;
    setPending(true);
    try {
      await action();
      try { await refresh(); toast.dismiss("workspace-connection"); }
      catch { toast.error("Saved. Reconnecting…", { id: "workspace-connection" }); }
      return true;
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save changes."); return false; }
    finally { busy.current = false; setPending(false); }
  }
  async function save(task: Task) {
    let id: string | null = null;
    const exists = state.tasks.some((item) => item.id === task.id);
    const ok = await write(async () => {
      const result = await api(exists ? `/tasks/${task.id}` : "/tasks", exists ? "PUT" : "POST", taskInputSchema.parse(task));
      id = z.object({ id: z.string() }).parse(result).id;
      const saved = { ...task, id, revision: exists ? task.revision + 1 : 0, failures: 0 };
      setState((current) => ({ ...current, tasks: [saved, ...current.tasks.filter((item) => item.id !== saved.id)] }));
    });
    return ok ? id : null;
  }
  const store: WorkspaceStore = {
    state, pending, save,
    run: (id) => write(() => api(`/tasks/${id}/run`, "POST")),
    toggle: async (id) => {
      const task = state.tasks.find((item) => item.id === id);
      if (task && await save({ ...task, status: task.status === "active" ? "paused" : "active" })) toast(task.status === "active" ? "Task paused" : "Task resumed");
    },
    remove: (id) => write(() => api(`/tasks/${id}`, "DELETE")),
    finding: (id, patch) => write(() => api(`/findings/${id}`, "PATCH", patch)),
    preferences: (patch) => write(() => api("/preferences", "PATCH", patch)),
    readNotices: (id) => write(() => api("/notices/read", "POST", { id })),
    readFindings: () => write(() => api("/findings/read", "POST")),
  };
  return <WorkspaceContext value={store}>{children}</WorkspaceContext>;
}
