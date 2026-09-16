import { useState } from "react";
import { ArrowRight, ArrowUpRight, Clock3, Mail, Search } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router";
import { authClient } from "@/lib/auth-client";
import { CategoryIcon, Modal } from "@/features/radar/components";
import { examples, samples } from "@/features/radar/model";
export function meta() {
  return [
    { title: "Radar — Web monitoring" },
    {
      name: "description",
      content:
        "Scheduled web research with source-backed findings and email or Discord notifications.",
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
      <section className="sky landing-hero">
        <div className="container">
          <h1>
            Track the web.
            <br />
            Get updates.
          </h1>
          <p>Source-backed findings, delivered to email or Discord.</p>
          <form
            className="hero-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) navigate(`/login?prompt=${encodeURIComponent(prompt.trim())}`);
            }}
          >
            <Search size={21} />
            <input
              required
              aria-label="What should Radar follow?"
              placeholder="What should Radar follow?"
              value={prompt}
              maxLength={2000}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button className="button primary">
              Create task <ArrowUpRight size={17} />
            </button>
          </form>
          <div className="example-prompts">
            {examples.map((e, i) => (
              <button key={e} onClick={() => setPrompt(e)}>
                {["AI tools", "Concerts", "Flights"][i]} <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="container landing-examples" id="examples">
        <div className="center-heading">
          <h2>Example findings</h2>
          <p>Sample data. No live research.</p>
        </div>
        <div className="finding-grid">
          {[samples[0]!, samples[2]!, samples[4]!].map((s) => (
            <article className="card finding-card" key={s.url}>
              <span className="source">
                <CategoryIcon category={s.category} />
                {s.category}
              </span>
              <h3>{s.title}</h3>
              <p>{s.summary}</p>
              <button className="text-button" onClick={() => setSelected(s)}>
                View finding <ArrowRight size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="steps container">
        {[
          [Search, "Describe your task"],
          [Clock3, "Choose a schedule"],
          [Mail, "Receive new findings"],
        ].map(([Icon, label]) => {
          const StepIcon = Icon as typeof Search;
          return (
            <div key={String(label)}>
              <StepIcon size={22} className="blue-icon" />
              <h3>{String(label)}</h3>
            </div>
          );
        })}
      </section>
      <footer className="container workspace-footer">
        <span>Radar</span>
        <Link to="/login">Sign in</Link>
      </footer>
      {selected && (
        <Modal title={selected.title} close={() => setSelected(null)}>
          <p>{selected.summary}</p>
          <div className="inset">
            <h3>Why it matches</h3>
            <p>{selected.reason}</p>
          </div>
          <a className="button primary" href={selected.url} target="_blank" rel="noreferrer">
            Open source <ArrowUpRight size={16} />
          </a>
          <p className="caption">Sample result. Prices and dates are illustrative.</p>
        </Modal>
      )}
    </main>
  );
}
