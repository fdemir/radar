import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Bookmark, Code2, Compass, Music2, Plane, Radar, X } from "lucide-react";
import { Link } from "react-router";
import { formatDate, type Category, type Finding, type Task } from "./model";
import { useWorkspace } from "./context";

export function Brand() {
  return (
    <span className="brand">
      <Radar strokeWidth={1.6} size={26} />
      radar
    </span>
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
  return <Icon size={20} strokeWidth={1.6} className="blue-icon" />;
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
    <div className="page-title">
      {back && (
        <Link className="back" to={back}>
          ← Back
        </Link>
      )}
      <div>
        <h1>{title}</h1>
        {action}
      </div>
    </div>
  );
}
export function Status({ status }: { status: Task["status"] | "running" }) {
  return (
    <span className={`status ${status}`}>
      <span />
      {{ active: "Active", paused: "Paused", draft: "Draft", running: "Checking" }[status]}
    </span>
  );
}
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Compass size={26} strokeWidth={1.3} />
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Toggle({
  label,
  checked,
  change,
  disabled,
}: {
  label: string;
  checked: boolean;
  change: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? "checked" : ""}`}
      onClick={() => change(!checked)}
    >
      <span />
    </button>
  );
}
export function FindingCard({ item, open }: { item: Finding; open: (finding: Finding) => void }) {
  const { finding } = useWorkspace();
  return (
    <article className="finding-card card">
      <div className="row between">
        <span className="source">
          <CategoryIcon category={item.category} />
          {item.source}
        </span>
        <button
          className="icon-button"
          aria-label={`${item.saved ? "Unsave" : "Save"} ${item.title}`}
          aria-pressed={item.saved}
          onClick={() => finding(item.id, { saved: !item.saved })}
        >
          <Bookmark size={18} fill={item.saved ? "currentColor" : "none"} />
        </button>
      </div>
      <button
        className="finding-open"
        onClick={() => {
          finding(item.id, { read: true });
          open(item);
        }}
      >
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
      </button>
      <div className="row between card-bottom">
        <time dateTime={item.date}>{formatDate(item.date)}</time>
        <button
          className="text-button"
          onClick={() => {
            finding(item.id, { read: true });
            open(item);
          }}
        >
          {!item.read && <i className="unread-dot" />}View <ArrowUpRight size={15} />
        </button>
      </div>
    </article>
  );
}
export function FindingModal({ item, close }: { item: Finding; close: () => void }) {
  const { state, finding } = useWorkspace();
  const current = state.findings.find((f) => f.id === item.id) ?? item;
  return (
    <Modal title={item.title} close={close}>
      <p>{item.summary}</p>
      <div className="inset">
        <h3>Why it matches</h3>
        <p>{item.reason}</p>
      </div>
      <div className="modal-actions">
        <a className="button primary" href={item.url} target="_blank" rel="noreferrer">
          Open source <ArrowUpRight size={16} />
        </a>
        <button
          className="button secondary"
          onClick={() => finding(item.id, { saved: !current.saved })}
        >
          <Bookmark size={16} fill={current.saved ? "currentColor" : "none"} />
          {current.saved ? "Saved" : "Save"}
        </button>
      </div>
      <p className="caption">{formatDate(item.date)}</p>
    </Modal>
  );
}
