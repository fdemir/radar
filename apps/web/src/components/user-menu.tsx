import { Button } from "@radar/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@radar/ui/components/dropdown-menu";
import { Skeleton } from "@radar/ui/components/skeleton";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Button variant="outline" nativeButton={false} render={<Link to="/login" />}>
        Sign In
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {session.user.username}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);

              try {
                const { error } = await authClient.signOut();

                if (error) {
                  toast.error("Unable to sign out. Please try again.");

                  return;
                }

                navigate("/login", { replace: true });
              } catch {
                toast.error("Unable to connect. Please try again.");
              } finally {
                setSigningOut(false);
              }
            }}
          >
            {signingOut ? "Signing out..." : "Sign Out"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
