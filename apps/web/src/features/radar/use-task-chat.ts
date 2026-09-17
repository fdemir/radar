import { useEffect, useRef, useState } from "react";
import { taskInputSchema, type Task } from "@radar/core";
import { compose } from "./compose";

type Turn = { message: string; reply: string; historyLength: number; error?: string };

export function useTaskChat(initial: Task, onComplete: (task: Task) => Promise<Task>) {
  const [task, setTask] = useState(initial);
  const [input, setInput] = useState("");
  const [turn, setTurn] = useState<Turn | null>(null);
  const [phase, setPhase] = useState<"idle" | "streaming" | "saving">("idle");
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function send(text = input, historyLength = task.messages.length) {
    const message = text.trim();

    if (!message || request.current || phase === "saving") return;

    const controller = new AbortController();

    request.current = controller;
    setInput("");
    setTurn({ message, reply: "", historyLength });
    setPhase("streaming");

    try {
      const result = await compose(
        taskInputSchema.parse({
          ...task,
          status: "draft",
          messages: task.messages.slice(0, historyLength),
        }),
        message,
        (reply) => {
          if (request.current === controller && !controller.signal.aborted)
            setTurn({ message, reply, historyLength });
        },
        controller.signal,
      );

      controller.signal.throwIfAborted();

      if (request.current !== controller) return;

      const next = { ...task, ...result, status: task.status };

      setTask(next);
      setTurn(null);
      setPhase("saving");
      setTask(await onComplete(next));
    } catch (error) {
      if (request.current !== controller) return;

      setTurn((current) => ({
        message,
        historyLength,
        reply: current?.reply ?? "",
        error: controller.signal.aborted
          ? "Reply stopped. Task details were not changed."
          : error instanceof Error
            ? error.message
            : "Unable to finish the reply. Try again.",
      }));
      setInput((current) => current || message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPhase("idle");
      }
    }
  }

  function stop() {
    request.current?.abort();
    request.current = null;
    setPhase("idle");
    setTurn(
      (current) =>
        current && {
          ...current,
          error: "Reply stopped. Task details were not changed.",
        },
    );
    setInput((current) => current || turn?.message || "");
  }

  return { task, setTask, input, setInput, turn, phase, send, stop };
}
