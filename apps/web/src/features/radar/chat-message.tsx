import { Bubble, BubbleContent } from "@radar/ui/components/bubble";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@radar/ui/components/message";
import { Button } from "@radar/ui/components/button";
import { Check, Copy, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import type { Message as TaskMessage } from "@radar/core";

export function TaskMessages({ messages }: { messages: TaskMessage[] }) {
  return messages.map((message, index) => (
    <div key={index} className="mb-6">
      <ChatMessage message={message} />
    </div>
  ));
}

export function ChatMessage({
  message,
  streaming = false,
  actions = true,
  onRetry,
}: {
  message: TaskMessage;
  streaming?: boolean;
  actions?: boolean;
  onRetry?: () => void;
}) {
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
    } catch {
      toast.error("Unable to copy this reply.");
    }
  }

  return (
    <Message align={user ? "end" : "start"}>
      <MessageContent>
        <MessageHeader className="text-[11px] font-normal">{user ? "You" : "Radar"}</MessageHeader>
        <Bubble
          variant={user ? "muted" : "ghost"}
          className={user ? "max-w-[90%] sm:max-w-[80%]" : "w-full"}
        >
          <BubbleContent className="rounded-2xl px-4 py-3 text-sm leading-7 [overflow-wrap:anywhere] sm:px-5">
            {user ? (
              <p className="whitespace-pre-wrap">{message.text}</p>
            ) : (
              <Streamdown
                mode={streaming ? "streaming" : "static"}
                isAnimating={streaming}
                controls={false}
                skipHtml
                disallowedElements={["img"]}
                className="space-y-3 [&_a]:text-sky-accent [&_a]:underline [&_p]:text-foreground"
              >
                {message.text}
              </Streamdown>
            )}
          </BubbleContent>
        </Bubble>
        {!user && !streaming && actions && (
          <MessageFooter className="gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? "Reply copied" : "Copy reply"}
              onClick={copy}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
            {onRetry && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Regenerate reply"
                onClick={onRetry}
              >
                <RotateCcw />
              </Button>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
