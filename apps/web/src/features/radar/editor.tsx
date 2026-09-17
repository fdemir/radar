import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowUp, Check, Plus, RotateCcw, Square } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button, buttonVariants } from "@radar/ui/components/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@radar/ui/components/message-scroller";
import { Spinner } from "@radar/ui/components/spinner";
import { Textarea } from "@radar/ui/components/textarea";
import { cn } from "@radar/ui/lib/utils";
import { useWorkspace } from "./context";
import { Empty, Status, WorkspacePage } from "./components";
import { ChatMessage } from "./chat-message";
import { TaskSetupSummary } from "./task-setup-summary";
import { useTaskChat } from "./use-task-chat";
import { examples, type Task } from "./model";

export default function Editor() {
  const { state } = useWorkspace();
  const { taskId } = useParams();
  const [params] = useSearchParams();
  const existing = state.tasks.find((task) => task.id === taskId);
  const prompt = params.get("prompt") ?? "";

  if (taskId && !existing)
    return (
      <WorkspacePage>
        <Empty action={<Link to="/tasks">Back to tasks</Link>}>Task not found.</Empty>
      </WorkspacePage>
    );

  return (
    <MessageScrollerProvider key={taskId ?? "new"} defaultScrollPosition="end">
      <TaskEditor
        initial={
          existing ?? {
            id: crypto.randomUUID(),
            title: "",
            category: "Other",
            frequency: "Daily",
            revision: 0,
            brief: "",
            status: "draft",
            time: "09:00",
            language: /türkçe|turkish/i.test(prompt) ? "Türkçe" : state.preferences.language,
            email: true,
            failures: 0,
            nextRunAt: null,
            messages: [],
          }
        }
        prompt={prompt}
      />
    </MessageScrollerProvider>
  );
}

function TaskEditor({ initial, prompt }: { initial: Task; prompt: string }) {
  const { state, save, pending } = useWorkspace();
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { scrollToEnd } = useMessageScroller();
  const initialPromptSent = useRef(false);

  async function persistDraft(next: Task) {
    if (next.status !== "draft") return next;

    const id = await save({ ...next, title: next.title.trim() || "Untitled task" });

    if (!id) return next;

    const saved = { ...next, id, revision: taskId ? next.revision + 1 : 0 };

    if (!taskId) navigate(`/tasks/${id}/edit`, { replace: true });

    return saved;
  }

  const { task, setTask, input, setInput, turn, phase, send, stop } = useTaskChat(
    initial,
    persistDraft,
  );
  const busy = phase !== "idle" || pending;
  const ready = Boolean(task.title.trim()) && task.brief.trim().length >= 10;
  const conversationFull = task.messages.length >= 80;

  useEffect(() => {
    if (!prompt || initial.messages.length || initialPromptSent.current) return;

    const timer = setTimeout(() => {
      initialPromptSent.current = true;
      void send(prompt);
    }, 0);

    return () => clearTimeout(timer);
    // The initial prompt is consumed once; subsequent messages come from the composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  function submitMessage(text = input, historyLength = task.messages.length) {
    if (busy || historyLength >= 80) return;

    scrollToEnd({ behavior: "smooth" });
    void send(text, historyLength);
  }

  async function updateDetails(next: Task) {
    setTask(next);
    setTask(await persistDraft(next));
  }

  async function submit(active: boolean) {
    if (busy || (active && !ready)) return;

    const id = await save({
      ...task,
      title: task.title.trim() || "Untitled task",
      status: active ? "active" : "draft",
      failures: 0,
    });

    if (id) {
      toast(active ? "Task saved" : "Draft saved");
      navigate(active ? `/tasks/${id}` : "/tasks");
    }
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col sm:border-x">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-4 sm:px-7">
        <Link
          to={taskId ? `/tasks/${taskId}` : "/tasks"}
          aria-label="Back to tasks"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "shrink-0")}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
          {task.title || "New task"}
        </h1>
        <Status status={task.status} />
      </div>
      <MessageScroller>
        <MessageScrollerViewport aria-label="Task conversation">
          <MessageScrollerContent
            className="gap-7 px-5 py-7 sm:px-10"
            aria-busy={phase === "streaming"}
          >
            {!task.messages.length && !turn && (
              <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6 py-12 text-center sm:py-20">
                <p className="text-sm text-muted-foreground">What should Radar follow?</p>
                <div className="grid w-full gap-2">
                  {examples.map((example, index) => (
                    <Button
                      key={example}
                      variant="outline"
                      className="justify-between text-xs font-normal"
                      disabled={busy}
                      onClick={() => submitMessage(example)}
                    >
                      {["Open-source AI tools", "Concerts in Istanbul", "Flights to Tokyo"][index]}
                      <Plus className="size-3.5" />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {task.messages
              .slice(0, turn?.historyLength ?? task.messages.length)
              .map((message, index) => (
                <MessageScrollerItem key={index} messageId={`message-${index}`}>
                  <ChatMessage
                    key={message.text}
                    message={message}
                    actions={!busy}
                    onRetry={
                      !turn &&
                      index === task.messages.length - 1 &&
                      task.messages[index - 1]?.role === "user"
                        ? () => submitMessage(task.messages[index - 1]!.text, index - 1)
                        : undefined
                    }
                  />
                </MessageScrollerItem>
              ))}
            {turn && (
              <>
                <MessageScrollerItem messageId="pending-user">
                  <ChatMessage message={{ role: "user", text: turn.message }} />
                </MessageScrollerItem>
                {turn.reply && (
                  <MessageScrollerItem messageId="pending-assistant">
                    <ChatMessage
                      message={{ role: "assistant", text: turn.reply }}
                      streaming={phase === "streaming"}
                      actions={false}
                    />
                  </MessageScrollerItem>
                )}
                {turn.error && (
                  <MessageScrollerItem>
                    <div
                      role="alert"
                      className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
                    >
                      <p className="flex-1 text-muted-foreground">{turn.error}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => submitMessage(turn.message, turn.historyLength)}
                      >
                        <RotateCcw className="size-3.5" />
                        Try again
                      </Button>
                    </div>
                  </MessageScrollerItem>
                )}
              </>
            )}
            {phase === "idle" && (task.messages.length > 0 || task.title || task.brief) && (
              <MessageScrollerItem messageId="task-details">
                <TaskSetupSummary
                  task={task}
                  timezone={state.preferences.timezone}
                  disabled={busy}
                  onChange={(next) => void updateDetails(next)}
                />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
      <div className="shrink-0 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
        <div className="flex min-h-7 justify-center pb-2" role="status" aria-live="polite">
          {phase !== "idle" && (
            <span className="inline-flex items-center gap-2 rounded-full bg-sky-wash px-3 py-1 text-xs text-sky-accent">
              <Spinner className="size-3.5" aria-hidden="true" />
              {phase === "saving" ? "Saving task..." : "Setting up your task..."}
            </span>
          )}
        </div>
        <form
          className="relative rounded-2xl border bg-background p-2 shadow-xs focus-within:border-ring"
          onSubmit={(event) => {
            event.preventDefault();
            submitMessage();
          }}
        >
          <Textarea
            aria-label="Message to Radar"
            className="max-h-40 min-h-14 resize-none border-0 bg-transparent pr-12 text-sm shadow-none focus-visible:ring-0"
            placeholder={
              conversationFull
                ? "Conversation limit reached. Edit the details above."
                : "Describe what to look for..."
            }
            value={input}
            disabled={busy || conversationFull}
            onChange={(event) => setInput(event.target.value)}
            rows={2}
            maxLength={2000}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitMessage();
              }
            }}
          />
          {phase === "streaming" ? (
            <Button
              key="stop"
              type="button"
              size="icon-sm"
              className="absolute right-3 bottom-3"
              aria-label="Stop reply"
              onClick={stop}
            >
              <Square className="size-3.5" fill="currentColor" />
            </Button>
          ) : (
            <Button
              key="send"
              type="submit"
              size="icon-sm"
              className="absolute right-3 bottom-3"
              aria-label="Send message"
              disabled={!input.trim() || busy || conversationFull}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </form>
        <div className="mt-3 flex items-center justify-end gap-2">
          {task.status === "draft" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !task.messages.length}
              onClick={() => submit(false)}
            >
              Save draft
            </Button>
          )}
          <Button size="sm" disabled={!ready || busy} onClick={() => submit(true)}>
            {pending ? <Spinner aria-hidden="true" /> : <Check className="size-4" />}
            {task.status === "draft" ? "Activate & run" : "Save & run"}
          </Button>
        </div>
      </div>
    </main>
  );
}
