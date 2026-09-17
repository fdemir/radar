import { cn } from "@radar/ui/lib/utils";
import { useEffect, useState } from "react";
import { ArrowRight, Clock3, Pause, Play, Plus } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@radar/ui/components/badge";
import { Button, buttonVariants } from "@radar/ui/components/button";
import { Card, CardContent, CardFooter } from "@radar/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@radar/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@radar/ui/components/tooltip";
import { useWorkspace } from "./context";
import {
  CategoryIcon,
  Empty,
  FindingCard,
  FindingModal,
  SearchField,
  Status,
  WorkspacePage,
} from "./components";
import { formatDate, type Finding } from "./model";

function RelativeTime({ date, timezone }: { date: string | number; timezone: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  const exact = formatDate(date, timezone);
  const difference = new Date(date).getTime() - (now ?? 0);
  const minutes = Math.floor(Math.abs(difference) / 60_000);
  const amount =
    minutes >= 1440
      ? `${Math.floor(minutes / 1440)}d`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h`
        : `${minutes}m`;
  const relative = minutes < 1 ? "now" : difference > 0 ? `in ${amount}` : `${amount} ago`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<time dateTime={new Date(date).toISOString()} tabIndex={0} />}
        className="cursor-help underline decoration-dotted underline-offset-2"
      >
        {now === null ? exact : relative}
      </TooltipTrigger>
      <TooltipContent>{exact}</TooltipContent>
    </Tooltip>
  );
}

export default function Overview() {
  const { state, toggle } = useWorkspace();
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Finding | null>(null);
  const tasks = state.tasks.filter(
    (task) =>
      (filter === "All" || task.status === filter.toLowerCase()) &&
      `${task.title} ${task.brief}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <section className="bg-sky px-5 py-13 text-center">
        <h1 className="text-[46px] leading-none tracking-[-0.055em] text-white sm:text-[64px]">
          Your tasks
        </h1>
        <p className="mt-4 mb-6 text-sky-foreground">
          {state.tasks.filter((task) => task.status === "active").length} active{" "}
          <span className="mx-2">·</span> {state.findings.filter((finding) => !finding.read).length}{" "}
          unread
        </p>
        <Link to="/tasks/new" className={cn(buttonVariants())}>
          <Plus />
          New task
        </Link>
      </section>
      <WorkspacePage className="min-h-0 pt-10">
        <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
          <div className="flex flex-wrap items-center justify-between gap-5">
            <TabsList aria-label="Task status" className="w-full sm:w-fit">
              {["All", "Active", "Paused", "Draft"].map((status) => (
                <TabsTrigger key={status} value={status}>
                  {status}
                  {status === "All" && (
                    <span className="text-[11px] text-muted-foreground">{state.tasks.length}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <SearchField label="Search tasks" value={query} onChange={setQuery} />
          </div>
          <TabsContent value={filter}>
            <div className="grid gap-6 md:grid-cols-2">
              {tasks.map((task) => {
                const latest = state.runs.find((run) => run.taskId === task.id);
                const count = state.findings.filter(
                  (finding) => finding.taskId === task.id && !finding.read,
                ).length;
                const path =
                  task.status === "draft" ? `/tasks/${task.id}/edit` : `/tasks/${task.id}`;

                return (
                  <Card
                    key={task.id}
                    className="gap-0 pt-8 [--card-spacing:--spacing(6)] lg:[--card-spacing:--spacing(9)]"
                  >
                    <CardContent className="flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          <CategoryIcon category={task.category} />
                          {task.category}
                        </Badge>
                        <Status
                          status={
                            latest?.status === "running"
                              ? latest.retryAt
                                ? "waiting"
                                : "running"
                              : task.status
                          }
                        />
                      </div>
                      <Link to={path} className="group my-6 block">
                        <h2 className="text-[26px] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                          {task.title}
                        </h2>
                        <p className="mt-2.5 min-h-12 leading-relaxed [overflow-wrap:anywhere]">
                          {task.brief}
                        </p>
                      </Link>
                      <div className="flex items-center gap-2 pb-6 text-xs text-muted-foreground">
                        <Clock3 size={15} className="text-sky-accent" />
                        <span>
                          {task.frequency}
                          {task.frequency !== "Hourly" && ` · ${task.time}`}
                        </span>
                        {count > 0 && (
                          <span className="ml-auto font-medium text-foreground">{count} new</span>
                        )}
                      </div>
                    </CardContent>
                    <CardFooter className="mx-(--card-spacing) justify-between gap-3 px-0 py-4">
                      <span className="text-[11px] text-muted-foreground">
                        {latest?.status === "running" && latest.retryAt ? (
                          <>
                            Waiting until {formatDate(latest.retryAt, state.preferences.timezone)}
                          </>
                        ) : latest ? (
                          <>
                            Last check:{" "}
                            <RelativeTime
                              date={latest.started}
                              timezone={state.preferences.timezone}
                            />
                          </>
                        ) : (
                          "Not checked yet"
                        )}
                        {task.status === "active" &&
                          latest?.status !== "running" &&
                          task.nextRunAt && (
                            <>
                              <br />
                              Next:{" "}
                              <RelativeTime
                                date={task.nextRunAt}
                                timezone={state.preferences.timezone}
                              />
                            </>
                          )}
                      </span>
                      <div className="flex items-center gap-3">
                        {task.status !== "draft" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={task.status === "active" ? "Pause task" : "Resume task"}
                            title={task.status === "active" ? "Pause" : "Resume"}
                            className="text-muted-foreground"
                            onClick={() => toggle(task.id)}
                          >
                            {task.status === "active" ? <Pause size={16} /> : <Play size={16} />}
                          </Button>
                        )}
                        <Link
                          to={path}
                          aria-label={`Open ${task.title}`}
                          className={cn(buttonVariants({ variant: "outline", size: "icon" }))}
                        >
                          <ArrowRight />
                        </Link>
                      </div>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
            {!tasks.length && (
              <Empty
                action={
                  <Link to="/tasks/new" className={cn(buttonVariants())}>
                    New task
                  </Link>
                }
              >
                No tasks found.
              </Empty>
            )}
          </TabsContent>
        </Tabs>
        <section className="mt-16">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-2xl">Latest findings</h2>
            <Link to="/discoveries" className={cn(buttonVariants({ variant: "link", size: "sm" }))}>
              View all <ArrowRight />
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {state.findings.slice(0, 3).map((finding) => (
              <FindingCard key={finding.id} item={finding} open={setSelected} />
            ))}
          </div>
          {!state.findings.length && <Empty>No findings yet.</Empty>}
        </section>
      </WorkspacePage>
      {selected && <FindingModal item={selected} close={() => setSelected(null)} />}
    </>
  );
}
