import { Button } from "@radar/ui/components/button";
import {
  Navigate,
  redirect,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  Outlet,
} from "react-router";
import z from "zod";
import { workspaceSchema } from "@radar/core";

import { WorkspaceProvider } from "@/features/radar/store";
import { useWorkspace } from "@/features/radar/context";
import Header from "@/components/header";
import Loader from "@/components/loader";
import { ENV } from "@/env.public";
import { authClient } from "@/lib/auth-client";

const currentUser = z.object({
  user: z.object({ id: z.string(), username: z.string() }),
});

function signInPath(search: URLSearchParams) {
  const prompt = search.get("prompt");
  return prompt ? `/login?prompt=${encodeURIComponent(prompt)}` : "/login";
}
export async function clientLoader({ request }: { request: Request }) {
  const response = await fetch(`${ENV.VITE_SERVER_URL}/api/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) throw redirect(signInPath(new URL(request.url).searchParams));
  if (!response.ok) throw new Error("Unable to load your account. Please try again.");
  const account = currentUser.parse(await response.json());
  const workspace = await fetch(`${ENV.VITE_SERVER_URL}/api/workspace`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!workspace.ok) throw new Error("Unable to load your workspace.");
  return { ...account, workspace: workspaceSchema.parse(await workspace.json()) };
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <Loader />;
}

export default function Tasks() {
  const { user, workspace } = useLoaderData<typeof clientLoader>();
  const [params] = useSearchParams();
  const { data: session, isPending, error, refetch } = authClient.useSession();

  if (isPending) return <Loader />;
  if (error)
    return (
      <div className="mx-auto max-w-md p-6" role="alert">
        <p>Unable to check your session.</p>
        <button className="mt-2 underline" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  if (!session) return <Navigate to={signInPath(params)} replace />;
  // A different tab may have switched accounts since this route was loaded.
  if (session.user.id !== user.id) return <Navigate to={signInPath(params)} replace />;

  return (
    <WorkspaceProvider key={user.id} initial={workspace}>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

export function ErrorBoundary() {
  const revalidator = useRevalidator();
  return (
    <main className="mx-auto w-full max-w-md p-6" role="alert">
      <h1 className="text-xl font-semibold">Unable to load workspace</h1>
      <p className="my-4 text-muted-foreground">Check your connection and try again.</p>
      <Button disabled={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>
        {revalidator.state === "loading" ? "Retrying..." : "Try again"}
      </Button>
    </main>
  );
}

function WorkspaceLayout() {
  const { state } = useWorkspace();
  return (
    <>
      <Header unread={state.notices.filter((n) => !n.read).length} />
      <Outlet />
      <footer className="workspace-footer container">
        <span>Radar</span>
      </footer>
    </>
  );
}
