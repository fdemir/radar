import { createContext, useContext } from "react";
import type { Finding, PreferencesInput, Task, Workspace } from "@radar/core";
export type WorkspaceStore = {
  state: Workspace;
  pending: boolean;
  save: (task: Task) => Promise<string | null>;
  run: (id: string) => Promise<boolean>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  finding: (id: string, patch: Partial<Pick<Finding, "read" | "saved">>) => Promise<boolean>;
  preferences: (patch: PreferencesInput) => Promise<boolean>;
  readNotices: (id?: string) => Promise<boolean>;
  readFindings: () => Promise<boolean>;
};
export const WorkspaceContext = createContext<WorkspaceStore | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace provider is required");
  return value;
}
