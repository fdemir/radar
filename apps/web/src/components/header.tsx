import { cn } from "@radar/ui/lib/utils";
import { Bell } from "lucide-react";
import { Link, NavLink } from "react-router";
import { buttonVariants } from "@radar/ui/components/button";
import { authClient } from "@/lib/auth-client";
import { Brand } from "@/features/radar/components";

export default function Header({ unread = 0 }: { unread?: number }) {
  const { data: session } = authClient.useSession();

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b bg-background/95 backdrop-blur-sm">
      <div className="relative mx-auto flex max-w-340 flex-wrap items-center justify-between gap-x-6 px-5 py-4 sm:h-20 sm:flex-nowrap sm:px-7 sm:py-0 lg:px-12">
        <Link to={session ? "/tasks" : "/"} aria-label="Radar home">
          <Brand />
        </Link>
        {session ? (
          <>
            <nav
              aria-label="Main navigation"
              className="order-last mt-3 flex w-full justify-center gap-1 sm:absolute sm:left-1/2 sm:order-none sm:mt-0 sm:w-auto sm:-translate-x-1/2"
            >
              {[
                { to: "/tasks", label: "Tasks" },
                { to: "/discoveries", label: "Discoveries" },
                { to: "/settings", label: "Settings" },
              ].map(({ to, label }) => (
                <NavLink
                  to={to}
                  key={to}
                  className={cn(
                    buttonVariants({
                      variant: "ghost",
                      className: "font-sans font-medium [&.active]:bg-muted",
                    }),
                  )}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <Link
                to="/notifications"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                className={cn(
                  buttonVariants({
                    variant: "ghost",
                    size: "icon",
                    className: "relative",
                  }),
                )}
              >
                <Bell className="size-5" strokeWidth={1.6} />
                {unread > 0 && (
                  <span className="absolute top-1 right-1 size-2 rounded-full border-2 border-background bg-sky-accent" />
                )}
              </Link>
              <Link
                to="/settings"
                aria-label="Account settings"
                className={cn(
                  buttonVariants({
                    variant: "outline",
                    size: "icon",
                    className: "text-xs font-normal",
                  }),
                )}
              >
                {(session.user.username ?? session.user.name).slice(0, 1).toUpperCase()}
              </Link>
            </div>
          </>
        ) : (
          <>
            <nav
              aria-label="Main navigation"
              className="hidden sm:absolute sm:left-1/2 sm:block sm:-translate-x-1/2"
            >
              <Link to="/#examples" className={cn(buttonVariants({ variant: "ghost" }))}>
                Examples
              </Link>
            </nav>
            <div className="flex items-center gap-2">
              <Link to="/login" className={cn(buttonVariants({ variant: "outline" }))}>
                Sign in <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
