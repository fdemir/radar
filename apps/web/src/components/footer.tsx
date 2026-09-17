import { ArrowUpRight } from "lucide-react";

export default function Footer() {
  return (
    <footer className="mx-auto flex w-[calc(100%-36px)] max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t py-7 text-xs text-muted-foreground md:w-[calc(100%-56px)] lg:w-[calc(100%-96px)]">
      <span>Radar</span>
      <a
        href="https://github.com/fdemir/radar"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-9 items-center gap-2 rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
          <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.542 0-.267-.01-.974-.015-1.912-3.13.68-3.79-1.51-3.79-1.51-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.077-.686.077-.686 1.131.08 1.726 1.161 1.726 1.161 1.005 1.722 2.637 1.225 3.279.937.102-.728.393-1.225.715-1.507-2.499-.284-5.126-1.25-5.126-5.566 0-1.23.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.153a10.8 10.8 0 0 1 5.625 0c2.148-1.456 3.092-1.153 3.092-1.153.614 1.55.227 2.695.112 2.98.722.787 1.158 1.79 1.158 3.02 0 4.327-2.631 5.279-5.138 5.558.404.35.764 1.043.764 2.1 0 1.516-.014 2.74-.014 3.112 0 .3.203.65.774.54A11.251 11.251 0 0 0 12 .75Z" />
        </svg>
        Open source on GitHub
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      </a>
    </footer>
  );
}
