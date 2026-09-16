import { cn } from "@radar/ui/lib/utils";
import { useState } from "react";
import { ArrowUpRight, CheckCheck, Mail } from "lucide-react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@radar/ui/components/button";
import { Card } from "@radar/ui/components/card";
import { useWorkspace } from "./context";
import { Empty, Modal, PageTitle, WorkspacePage } from "./components";
import { formatDate, type Notice } from "./model";

export default function Activity() {
  const { state, readNotices } = useWorkspace();
  const [selected, setSelected] = useState<Notice | null>(null);
  const notices = state.notices;
  const finding = state.findings.find((item) => item.id === selected?.findingId);

  return (
    <WorkspacePage>
      <PageTitle
        title="Notifications"
        action={
          <Button variant="outline" onClick={() => readNotices()}>
            <CheckCheck />
            Mark all read
          </Button>
        }
      />
      <Card className="gap-0 divide-y py-0">
        {notices.map((notice) => (
          <Button
            variant="ghost"
            className="h-auto justify-start gap-5 rounded-none border-0 px-6 py-6 text-left font-sans font-normal whitespace-normal sm:px-8"
            key={notice.id}
            onClick={() => {
              readNotices(notice.id);
              setSelected(notice);
            }}
          >
            <Mail className="size-5 text-sky-accent" />
            <span className="flex-1">
              <strong className="font-medium">
                {state.findings.find((item) => item.id === notice.findingId)?.title ??
                  "New finding"}
              </strong>
              <small className="mt-1 block text-xs text-muted-foreground">
                {notice.channel} · {formatDate(notice.date)}
              </small>
            </span>
            {!notice.read && <span className="size-1.5 rounded-full bg-sky-accent" />}
            <ArrowUpRight />
          </Button>
        ))}
        {!notices.length && <Empty>No notifications.</Empty>}
      </Card>
      {selected && (
        <Modal title={`${selected.channel} preview`} close={() => setSelected(null)}>
          <div className="space-y-3 rounded-xl bg-muted p-6">
            <h3>{finding?.title}</h3>
            <p>{finding?.summary}</p>
            {finding && (
              <a
                href={finding.url}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "link", size: "sm", className: "px-0" }))}
              >
                {finding.source} <ArrowUpRight />
              </a>
            )}
          </div>
          <Link
            to={`/tasks/${selected.taskId}`}
            className={cn(buttonVariants({ className: "justify-self-start" }))}
          >
            View task <ArrowUpRight />
          </Link>
        </Modal>
      )}
    </WorkspacePage>
  );
}
