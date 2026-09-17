import { cn } from "@radar/ui/lib/utils";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Clock3, Mail, Search } from "lucide-react";
import { Navigate, useNavigate } from "react-router";
import { Button, buttonVariants } from "@radar/ui/components/button";
import { Card } from "@radar/ui/components/card";
import { Input } from "@radar/ui/components/input";
import Footer from "@/components/footer";
import { authClient } from "@/lib/auth-client";
import { CategoryIcon, Modal } from "@/features/radar/components";
import { examples, samples } from "@/features/radar/model";

export function meta() {
  return [
    { title: "Radar | Web monitoring" },
    {
      name: "description",
      content: "Scheduled web research with source-backed findings and email notifications.",
    },
  ];
}

export default function Home() {
  const { data: session } = authClient.useSession();
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<(typeof samples)[number] | null>(null);
  const navigate = useNavigate();

  if (session) return <Navigate to="/tasks" replace />;

  return (
    <main>
      <section className="bg-sky px-5 py-16 text-center sm:pt-22 sm:pb-19">
        <h1 className="text-[52px] leading-[0.95] tracking-[-0.055em] text-white sm:text-[80px]">
          Track the web.
          <br />
          Get updates.
        </h1>
        <p className="mt-6 text-sky-foreground">Source-backed findings, delivered to email.</p>
        <form
          className="mx-auto mt-9 flex max-w-170 flex-wrap items-center gap-2 rounded-2xl bg-background p-3 sm:flex-nowrap sm:rounded-full sm:p-2 sm:pl-5"
          onSubmit={(event) => {
            event.preventDefault();

            if (prompt.trim()) navigate(`/login?prompt=${encodeURIComponent(prompt.trim())}`);
          }}
        >
          <Search size={21} className="ml-1 shrink-0 text-muted-foreground" />
          <Input
            required
            className="flex-1 border-0 shadow-none focus-visible:ring-0"
            aria-label="What should Radar follow?"
            placeholder="What should Radar follow?"
            value={prompt}
            maxLength={2000}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Button type="submit" className="w-full sm:w-auto">
            Create task <ArrowUpRight />
          </Button>
        </form>
        <div className="mt-5 flex justify-center gap-2">
          {examples.map((example, index) => (
            <Button
              key={example}
              variant="ghost"
              size="sm"
              className="font-sans font-normal text-sky-foreground hover:bg-white/20 hover:text-sky-foreground"
              onClick={() => setPrompt(example)}
            >
              {["AI tools", "Concerts", "Flights"][index]} <ArrowUpRight />
            </Button>
          ))}
        </div>
      </section>
      <section
        className="mx-auto w-[calc(100%-36px)] max-w-[1200px] py-18 md:w-[calc(100%-56px)] lg:w-[calc(100%-96px)]"
        id="examples"
      >
        <div className="mb-9 space-y-3 text-center">
          <h2>Example findings</h2>
          <p>Sample data. No live research.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[samples[0]!, samples[2]!, samples[4]!].map((sample) => (
            <Card className="gap-0 p-6" key={sample.url}>
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <CategoryIcon category={sample.category} />
                {sample.category}
              </span>
              <h3 className="mt-6">{sample.title}</h3>
              <p className="mt-3 mb-6 flex-1 text-[13px] leading-relaxed">{sample.summary}</p>
              <Button
                variant="link"
                size="sm"
                className="justify-start px-0"
                onClick={() => setSelected(sample)}
              >
                View finding <ArrowRight />
              </Button>
            </Card>
          ))}
        </div>
      </section>
      <section className="mx-auto grid w-[calc(100%-36px)] max-w-[1200px] gap-9 border-t py-14 text-center md:w-[calc(100%-56px)] md:grid-cols-3 lg:w-[calc(100%-96px)]">
        {[
          { icon: Search, label: "Describe your task" },
          { icon: Clock3, label: "Choose a schedule" },
          { icon: Mail, label: "Receive new findings" },
        ].map(({ icon: Icon, label }) => (
          <div key={label}>
            <Icon size={22} className="mx-auto mb-4 text-sky-accent" />
            <h3 className="text-lg">{label}</h3>
          </div>
        ))}
      </section>
      <Footer />
      {selected && (
        <Modal
          title={selected.title}
          description={selected.summary}
          close={() => setSelected(null)}
        >
          <div className="space-y-2 rounded-xl bg-muted p-6">
            <h3 className="text-base">Why it matches</h3>
            <p>{selected.reason}</p>
          </div>
          <a
            href={selected.url}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ className: "justify-self-start" }))}
          >
            View source <ArrowUpRight />
          </a>
          <p className="text-xs">Sample result. Prices and dates are illustrative.</p>
        </Modal>
      )}
    </main>
  );
}
