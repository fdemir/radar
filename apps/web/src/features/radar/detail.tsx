import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@radar/ui/components/accordion";
import { Alert, AlertDescription } from "@radar/ui/components/alert";
import { Button, buttonVariants } from "@radar/ui/components/button";
import { Card } from "@radar/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@radar/ui/components/tabs";
import { cn } from "@radar/ui/lib/utils";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
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
import {
  Empty,
  FindingCard,
  FindingModal,
  Modal,
  PageTitle,
  Status,
  WorkspacePage,
} from "./components";
import { TaskMessages } from "./chat-message";
import { formatDate, stages, stageLabel, type Finding } from "./model";

export default function Detail() {
  const { state, run, toggle, remove, pending } = useWorkspace();
  const { taskId } = useParams();
  const navigate = useNavigate();
  const task = state.tasks.find((t) => t.id === taskId);
  const runs = state.runs.filter((r) => r.taskId === taskId);
  const running = runs.find((r) => r.status === "running");
  const waiting = Boolean(running?.retryAt);
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
      <WorkspacePage>
        <Empty
          action={
            <Link to="/tasks" className={cn(buttonVariants())}>
              Back to tasks
            </Link>
          }
        >
          Task not found.
        </Empty>
      </WorkspacePage>
    );

  return (
    <WorkspacePage>
      <PageTitle
        title={task.title}
        back="/tasks"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/tasks/${task.id}/edit`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Pencil size={16} />
              Edit
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete task"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={18} />
            </Button>
          </div>
        }
      />
      <Card className="gap-0 p-6 lg:px-10 lg:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Status status={waiting ? "waiting" : running ? "running" : task.status} />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 size={14} />
            {task.frequency}
            {task.frequency !== "Hourly" && ` at ${task.time}`} · {state.preferences.timezone}
          </span>
        </div>
        <p className="mt-6 mb-7 max-w-225 text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {task.brief}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail size={15} />
            {task.language}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {task.status !== "draft" && (
              <Button variant="outline" onClick={() => toggle(task.id)}>
                {task.status === "active" ? <Pause size={16} /> : <Play size={16} />}
                {task.status === "active" ? "Pause" : "Resume"}
              </Button>
            )}
            <Button
              disabled={
                pending ||
                task.status !== "active" ||
                Boolean(running) ||
                cooldown > 0 ||
                state.checks >= 30
              }
              onClick={() => run(task.id)}
            >
              {waiting ? (
                <Clock3 size={16} />
              ) : running ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              {waiting
                ? "Waiting"
                : running
                  ? "Checking…"
                  : cooldown
                    ? `Wait ${cooldown}s`
                    : state.checks >= 30
                      ? "Daily limit reached"
                      : "Run now"}
            </Button>
          </div>
        </div>
      </Card>
      {task.failures >= 3 && (
        <Alert className="mt-5 bg-muted">
          <TriangleAlert size={20} />
          <AlertDescription>Paused after 3 failed checks. Resume to try again.</AlertDescription>
        </Alert>
      )}
      {waiting && running?.retryAt && (
        <Alert className="mt-6" role="status">
          <Clock3 />
          <AlertDescription>
            Waiting for search capacity. Your check will resume automatically after{" "}
            {formatDate(running.retryAt, state.preferences.timezone)}.
          </AlertDescription>
        </Alert>
      )}
      {running?.stage === 6 && (
        <Alert className="mt-6" role="status">
          <LoaderCircle className="animate-spin" />
          <AlertDescription>Checking additional sources</AlertDescription>
        </Alert>
      )}
      {running && !waiting && running.stage !== 6 && (
        <Card
          className="mt-6 grid grid-cols-2 gap-4 p-7 sm:flex-row sm:justify-between md:flex"
          aria-live="polite"
        >
          {stages.map((stage, i) => (
            <span
              key={stage}
              className={cn(
                "flex items-center gap-2 text-xs text-muted-foreground",
                i <= running.stage && "text-foreground [&_svg]:text-sky-accent",
              )}
            >
              {i < running.stage ? (
                <Check size={18} />
              ) : i === running.stage ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <Circle size={18} />
              )}
              {stage}
            </span>
          ))}
        </Card>
      )}
      <Tabs className="mt-9" value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList aria-label="Task details" className="w-full sm:w-fit">
          {["Findings", "Run history", "Conversation"].map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
              <span>
                {t === "Findings"
                  ? findings.length
                  : t === "Run history"
                    ? runs.length
                    : task.messages.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {tab === "Findings" ? (
            <>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {findings.map((f) => (
                  <FindingCard key={f.id} item={f} open={setSelected} />
                ))}
              </div>
              {!findings.length && (
                <Empty>
                  {waiting
                    ? "Your check is waiting and will resume automatically."
                    : running
                      ? "Your check is in progress."
                      : runs[0]?.status === "failed"
                        ? "The last check failed. No results were saved. Try Run now."
                        : runs[0]?.coverage === "limited"
                          ? "Research was incomplete. See run history for details."
                          : runs[0]?.status === "completed"
                            ? "No new matches in the sources checked."
                            : "Run a check to find your first result."}
                </Empty>
              )}
              {!running && runs[0] && (
                <div className="mt-6 space-y-2 text-xs">
                  <p>Last check: {runs[0].summary}</p>
                  {runs[0].coverage === "limited" && findings.length > 0 && (
                    <p>
                      Research incomplete. Some sources could not be read or evidence was
                      insufficient. See run history for details.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : tab === "Run history" ? (
            <Card className="gap-0 py-0">
              <Accordion multiple>
                {runs.map((r) => (
                  <AccordionItem key={r.id} value={r.id}>
                    <AccordionTrigger className="items-center gap-4 px-6 py-6 hover:no-underline">
                      <span className="shrink-0 text-sky-accent">
                        {r.status === "failed" || r.coverage === "limited" ? (
                          <TriangleAlert size={19} />
                        ) : r.status === "running" && r.retryAt ? (
                          <Clock3 size={19} />
                        ) : r.status === "running" ? (
                          <LoaderCircle className="animate-spin" size={19} />
                        ) : r.status === "cancelled" ? (
                          <Pause size={19} />
                        ) : (
                          <Check size={19} />
                        )}
                      </span>
                      <span className="flex-1">
                        <strong className="font-medium">
                          {r.status === "running"
                            ? r.retryAt
                              ? "Waiting for search capacity"
                              : stageLabel(r.stage)
                            : r.summary}
                        </strong>
                        <small className="mt-1.5 block text-xs text-muted-foreground">
                          {formatDate(r.started)} ·{" "}
                          {r.status === "running"
                            ? r.retryAt
                              ? "Waiting"
                              : "In progress"
                            : r.status === "cancelled"
                              ? "Cancelled"
                              : `${Math.max(0, Math.round(((r.finished ?? r.started) - r.started) / 1000))} sec`}{" "}
                          · {r.sources.length} sources
                        </small>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-2 px-6 pb-6 sm:pl-16">
                      <p>{r.findings} new findings</p>
                      {r.status === "running" && r.retryAt && (
                        <p>
                          Resumes automatically after{" "}
                          {formatDate(r.retryAt, state.preferences.timezone)}.
                        </p>
                      )}
                      {r.coverage === "limited" && (
                        <p>
                          Research incomplete: some sources could not be read or evidence was
                          insufficient. Any findings shown are supported by the pages we could read.
                        </p>
                      )}
                      {r.sources.map((source) => (
                        <a
                          className="flex items-center gap-2 text-[13px]"
                          key={source}
                          href={source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {new URL(source).hostname}
                          <ArrowUpRight size={14} />
                        </a>
                      ))}
                      {r.status === "failed" && <p>No results saved. Retry from Run now.</p>}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              {!runs.length && <Empty>No checks yet.</Empty>}
            </Card>
          ) : (
            <Card className="mx-auto max-w-190 gap-0 p-6 sm:p-9">
              <TaskMessages messages={task.messages} />
              {!task.messages.length && <Empty>No setup conversation.</Empty>}
              <Link
                to={`/tasks/${task.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Edit task <Pencil size={15} />
              </Link>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      {selected && <FindingModal item={selected} close={() => setSelected(null)} />}
      {deleting && (
        <Modal
          title="Delete task?"
          description={`“${task.title}” and its findings, history and notifications will be removed.`}
          close={() => setDeleting(false)}
        >
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (await remove(task.id)) navigate("/tasks");
              }}
            >
              Delete task
            </Button>
          </div>
        </Modal>
      )}
    </WorkspacePage>
  );
}
