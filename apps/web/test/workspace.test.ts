import { describe, expect, it } from "vitest";
import {
  advanceRuns,
  seedWorkspace,
  type Outcome,
  type Workspace,
} from "../src/features/radar/model";

function pending(state: Workspace, outcome: Outcome, id = "test-run"): Workspace {
  return {
    ...state,
    runs: [
      {
        id,
        taskId: "ai-tools",
        started: 1000,
        stage: 0,
        outcome,
        status: "running",
        sources: [],
        summary: "",
        findings: 0,
      },
      ...state.runs,
    ],
  };
}
describe("sample research lifecycle", () => {
  it("stages research before creating findings and sends one preview per selected channel", () => {
    const before = pending(seedWorkspace("tester", "tester@example.com"), "new");
    const working = advanceRuns(before, 3000);
    expect(working.runs[0]?.stage).toBe(2);
    expect(working.findings).toHaveLength(before.findings.length);
    const done = advanceRuns(working, 7000);
    expect(done.runs[0]?.status).toBe("completed");
    expect(done.findings).toHaveLength(before.findings.length + 1);
    expect(
      done.notices
        .slice(0, 2)
        .map((n) => n.channel)
        .sort(),
    ).toEqual(["Discord", "Email"]);
    expect(advanceRuns(done, 9000)).toBe(done);
  });
  it("filters previously found sources and emits no duplicate notification", () => {
    const initial = seedWorkspace("tester", "tester@example.com");
    const once = advanceRuns(pending(initial, "new"), 7000);
    const twice = advanceRuns(pending(once, "new", "second-run"), 7000);
    expect(twice.findings).toHaveLength(once.findings.length);
    expect(twice.notices).toHaveLength(once.notices.length);
    expect(twice.runs[0]?.findings).toBe(0);
  });
  it("respects verification and disconnected notification channels", () => {
    const before = seedWorkspace("tester", "tester@example.com");
    before.preferences.verified = false;
    before.preferences.discord = null;
    const done = advanceRuns(pending(before, "new"), 7000);
    expect(done.findings).toHaveLength(before.findings.length + 1);
    expect(done.notices).toHaveLength(before.notices.length);
  });
  it("pauses after three failures, then resets the failure count on a successful check", () => {
    let state = seedWorkspace("tester", "tester@example.com");
    for (let i = 0; i < 3; i++) state = advanceRuns(pending(state, "error", `failure-${i}`), 7000);
    expect(state.tasks[0]?.status).toBe("paused");
    expect(state.tasks[0]?.failures).toBe(3);
    const resumed: Workspace = {
      ...state,
      tasks: state.tasks.map((t) => (t.id === "ai-tools" ? { ...t, status: "active" } : t)),
    };
    const done = advanceRuns(pending(resumed, "unchanged"), 7000);
    expect(done.tasks[0]?.failures).toBe(0);
    expect(done.notices).toHaveLength(state.notices.length);
  });
  it("cancels an in-flight check when its task is paused without saving a result", () => {
    const before = pending(seedWorkspace("tester", "tester@example.com"), "new");
    before.tasks[0]!.status = "paused";
    const done = advanceRuns(before, 7000);
    expect(done.runs[0]?.status).toBe("cancelled");
    expect(done.findings).toHaveLength(before.findings.length);
    expect(done.notices).toHaveLength(before.notices.length);
  });
  it("uses the task result language", () => {
    const before = seedWorkspace("tester", "tester@example.com");
    before.tasks[0]!.language = "Türkçe";
    const done = advanceRuns(pending(before, "new"), 7000);
    expect(done.findings[0]?.title).toBe("Open WebUI: yerel yapay zekâ çalışma alanı");
  });
});
