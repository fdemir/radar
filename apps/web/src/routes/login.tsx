import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";

import Loader from "@/components/loader";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth-client";

export default function Login() {
  const [params] = useSearchParams();
  const prompt = params.get("prompt");
  const [showSignIn, setShowSignIn] = useState(true);
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

  if (session)
    return (
      <Navigate
        to={prompt ? `/tasks/new?prompt=${encodeURIComponent(prompt)}` : "/tasks"}
        replace
      />
    );

  return (
    <main className="auth-page">
      <div className="auth-sky sky" />
      <section className="card auth-card">
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </section>
    </main>
  );
}
