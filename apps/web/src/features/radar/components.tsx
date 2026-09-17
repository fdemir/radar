import type { ReactNode } from "react";
import { ArrowUpRight, Bookmark, Code2, Compass, Music2, Plane, Search } from "lucide-react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@radar/ui/components/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@radar/ui/components/accordion";
import { Card } from "@radar/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@radar/ui/components/dialog";
import {
  Empty as EmptyState,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@radar/ui/components/empty";
import { Input } from "@radar/ui/components/input";
import { cn } from "@radar/ui/lib/utils";
import { inlineEmphasis } from "@radar/core/emphasis";
import radarLogo from "@/assets/radar.svg";
import { formatDate, type Category, type Finding, type Task } from "./model";
import { useWorkspace } from "./context";

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-[27px] font-bold tracking-[-0.06em]">
      <img src={radarLogo} alt="" width={28} height={28} className="size-7 shrink-0" />
      radar
    </span>
  );
}

export function FindingSummary({ text }: { text: string }) {
  return inlineEmphasis(text).map((part, index) =>
    part.bold ? <strong key={index}>{part.text}</strong> : part.text,
  );
}

export function CategoryIcon({ category }: { category: Category }) {
  const Icon =
    category === "Technology"
      ? Code2
      : category === "Events"
        ? Music2
        : category === "Travel"
          ? Plane
          : Compass;

  return <Icon size={20} strokeWidth={1.6} className="shrink-0 text-sky-accent" />;
}

export function WorkspacePage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto min-h-[calc(100svh-180px)] w-[calc(100%-36px)] max-w-[1200px] py-12 pb-16 md:w-[calc(100%-56px)] lg:w-[calc(100%-96px)]",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageTitle({
  title,
  action,
  back,
}: {
  title: string;
  action?: ReactNode;
  back?: string;
}) {
  return (
    <div className="mb-9">
      {back && (
        <Link
          to={back}
          className={cn(
            buttonVariants({
              variant: "link",
              size: "sm",
              className: "mb-6 h-auto p-0 text-muted-foreground",
            }),
          )}
        >
          ← Back
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <h1 className="min-w-0 [overflow-wrap:anywhere]">{title}</h1>
        {action}
      </div>
    </div>
  );
}

export function Status({ status }: { status: Task["status"] | "running" | "waiting" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground",
          (status === "active" || status === "running") && "bg-sky-accent",
          status === "draft" && "border border-muted-foreground bg-transparent",
        )}
      />
      {
        {
          active: "Active",
          paused: "Paused",
          draft: "Draft",
          running: "Checking",
          waiting: "Waiting",
        }[status]
      }
    </span>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <EmptyState>
      <EmptyHeader>
        <EmptyMedia>
          <Compass size={26} strokeWidth={1.3} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action}
    </EmptyState>
  );
}

export function Modal({
  title,
  description,
  children,
  close,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader className="gap-4">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-60">
      <Search
        size={17}
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className="h-11 rounded-full pl-11 text-[13px]"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SourceEvidence({ evidence }: { evidence: string }) {
  if (!evidence) return null;

  return (
    <Accordion>
      <AccordionItem value="evidence">
        <AccordionTrigger className="py-3 text-xs">Source excerpt</AccordionTrigger>
        <AccordionContent className="pb-4">
          <blockquote className="border-l-2 border-sky-accent pl-3 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
            {evidence}
          </blockquote>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function FindingCard({ item, open }: { item: Finding; open: (finding: Finding) => void }) {
  const { finding } = useWorkspace();

  function view() {
    finding(item.id, { read: true });
    open(item);
  }

  return (
    <Card className="min-w-0 gap-0 p-6 [overflow-wrap:anywhere]">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          <CategoryIcon category={item.category} />
          {item.source}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${item.saved ? "Unsave" : "Save"} ${item.title}`}
          aria-pressed={item.saved}
          onClick={() => finding(item.id, { saved: !item.saved })}
        >
          <Bookmark fill={item.saved ? "currentColor" : "none"} />
        </Button>
      </div>
      <div className="flex-1 py-6">
        <h3>
          <Button
            variant="link"
            onClick={view}
            className="h-auto w-full justify-start p-0 text-left text-xl leading-snug font-semibold tracking-tight whitespace-normal"
          >
            {item.title}
          </Button>
        </h3>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-3.5">
        <time className="text-[11px] text-muted-foreground" dateTime={item.date}>
          {formatDate(item.date)}
        </time>
        <Button variant="link" size="sm" onClick={view}>
          {!item.read && <span className="size-1.5 rounded-full bg-sky-accent" />}View{" "}
          <ArrowUpRight />
        </Button>
      </div>
    </Card>
  );
}

export function FindingModal({ item, close }: { item: Finding; close: () => void }) {
  const { state, finding } = useWorkspace();
  const current = state.findings.find((f) => f.id === item.id) ?? item;

  return (
    <Modal title={item.title} description={<FindingSummary text={item.summary} />} close={close}>
      <div className="space-y-2 rounded-xl bg-muted p-5">
        <h3 className="text-sm">Why it matches</h3>
        <p>{item.reason}</p>
      </div>
      <SourceEvidence evidence={item.evidence} />
      <div className="flex flex-wrap gap-3">
        <a href={item.url} target="_blank" rel="noreferrer" className={cn(buttonVariants())}>
          Open source <ArrowUpRight />
        </a>
        <Button variant="outline" onClick={() => finding(item.id, { saved: !current.saved })}>
          <Bookmark fill={current.saved ? "currentColor" : "none"} />
          {current.saved ? "Saved" : "Save"}
        </Button>
      </div>
      <p className="text-xs">{formatDate(item.date)}</p>
    </Modal>
  );
}
