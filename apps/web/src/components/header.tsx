import { Bell } from "lucide-react";
import { Link, NavLink } from "react-router";
import { authClient } from "@/lib/auth-client";
import { Brand } from "@/features/radar/components";
export default function Header({ unread = 0 }: { unread?: number }) {
  const { data: session } = authClient.useSession();
  return (
    <header className="site-header">
      <div className="nav-container">
        <Link to={session ? "/tasks" : "/"} aria-label="Radar home">
          <Brand />
        </Link>
        {session ? (
          <>
            <nav aria-label="Main navigation">
              <NavLink to="/tasks">Tasks</NavLink>
              <NavLink to="/discoveries">Discoveries</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
            <div className="nav-account">
              <Link
                to="/notifications"
                className="icon-button bell"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              >
                <Bell size={20} strokeWidth={1.6} />
                {unread > 0 && <i />}
              </Link>
              <Link className="avatar" to="/settings" aria-label="Account settings">
                {(session.user.username ?? session.user.name).slice(0, 1).toUpperCase()}
              </Link>
            </div>
          </>
        ) : (
          <>
            <nav aria-label="Main navigation">
              <Link to="/#examples">Examples</Link>
            </nav>
            <Link to="/login" className="button secondary">
              Sign in <span aria-hidden="true">↗</span>
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
