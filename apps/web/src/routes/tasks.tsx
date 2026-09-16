import { Button } from "@radar/ui/components/button";
import { Navigate, redirect, useLoaderData, useRevalidator } from "react-router";
import z from "zod";

import Loader from "@/components/loader";
import { ENV } from "@/env.public";
import { authClient } from "@/lib/auth-client";

const currentUser = z.object({
  user: z.object({ id: z.string(), username: z.string() }),
});

export async function clientLoader() {
  const response = await fetch(`${ENV.VITE_SERVER_URL}/api/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) throw redirect("/login");
  if (!response.ok) throw new Error("Unable to load your account. Please try again.");
  return currentUser.parse(await response.json());
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <Loader />;
}

export default function Tasks() {
  const { user } = useLoaderData<typeof clientLoader>();
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
  if (!session) return <Navigate to="/login" replace />;
  // A different tab may have switched accounts since this route was loaded.
  if (session.user.id !== user.id) return <Navigate to="/login" replace />;

  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <h1 className="text-3xl font-bold">Tasks</h1>
      <p className="mt-2 text-muted-foreground">Welcome, {user.username}.</p>
      <div className="mt-8 rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">No tasks yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Your research tasks will appear here.</p>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  const revalidator = useRevalidator();
  return (
    <main className="mx-auto w-full max-w-md p-6" role="alert">
      <h1 className="text-xl font-semibold">Unable to load your account</h1>
      <p className="my-4 text-muted-foreground">Check your connection and try again.</p>
      <Button disabled={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>
        {revalidator.state === "loading" ? "Retrying..." : "Try again"}
      </Button>
    </main>
  );
}
