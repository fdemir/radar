import AuthLayout from "@/components/auth-layout";
import { Button } from "@radar/ui/components/button";
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
        <Button variant="link" className="mt-2 px-0" onClick={() => refetch()}>
          Try again
        </Button>
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
    <AuthLayout>
      {showSignIn ? (
        <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
      ) : (
        <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
      )}
    </AuthLayout>
  );
}
