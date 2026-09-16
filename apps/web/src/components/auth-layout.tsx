import type { ReactNode } from "react";
import { Card } from "@radar/ui/components/card";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate min-h-[calc(100svh-80px)] px-5 py-9 sm:py-18">
      <div className="absolute inset-x-0 top-0 -z-10 h-83 bg-sky" />
      <Card className="mx-auto max-w-115 gap-6 p-6 sm:p-10">{children}</Card>
    </main>
  );
}
