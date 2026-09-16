import { createContext, useContext } from "react";
import type { Finding, Outcome, Preferences, Task, Workspace } from "./model";
export type WorkspaceStore = {
  state: Workspace;
  save: (task: Task) => boolean;
  run: (id: string, outcome?: Outcome) => boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  finding: (id: string, patch: Partial<Pick<Finding, "read" | "saved">>) => void;
  preferences: (patch: Partial<Preferences>) => void;
  readNotices: (id?: string) => void;
  readFindings: () => void;
  reset: () => void;
};
export const WorkspaceContext = createContext<WorkspaceStore | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace provider is required");
  return value;
}
