import { useState } from "react";
import { ArrowUpRight, CheckCheck, Mail } from "lucide-react";
import { Link } from "react-router";
import { useWorkspace } from "./context";
import { Empty, Modal, PageTitle } from "./components";
import { formatDate, type Notice } from "./model";

export default function Activity() {
  const { state, readNotices } = useWorkspace();
  const [selected, setSelected] = useState<Notice | null>(null);
  const notices = state.notices;
  const finding = state.findings.find((f) => f.id === selected?.findingId);

  return (
    <main className="container workspace-main">
      <PageTitle
        title="Notifications"
        action={
          <button className="button secondary" onClick={() => readNotices()}>
            <CheckCheck size={17} />
            Mark all read
          </button>
        }
      />
      <div className="card notification-list">
        {notices.map((n) => (
          <button
            className="notification-row"
            key={n.id}
            onClick={() => {
              readNotices(n.id);
              setSelected(n);
            }}
          >
            <span className="channel-icon">
              <Mail size={21} />
            </span>
            <span>
              <strong>
                {state.findings.find((f) => f.id === n.findingId)?.title ?? "New finding"}
              </strong>
              <small>
                {n.channel} · {formatDate(n.date)}
              </small>
            </span>
            {!n.read && <i className="unread-dot" />}
            <ArrowUpRight size={18} />
          </button>
        ))}
        {!notices.length && <Empty>No notifications.</Empty>}
      </div>
      {selected && (
        <Modal title={`${selected.channel} preview`} close={() => setSelected(null)}>
          <div className="inset">
            <h3>{finding?.title}</h3>
            <p>{finding?.summary}</p>
            {finding && (
              <a className="text-button" href={finding.url} target="_blank" rel="noreferrer">
                {finding.source} <ArrowUpRight size={15} />
              </a>
            )}
          </div>
          <Link className="button primary" to={`/tasks/${selected.taskId}`}>
            View task <ArrowUpRight size={16} />
          </Link>
        </Modal>
      )}
    </main>
  );
}
