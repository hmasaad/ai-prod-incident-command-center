import Link from "next/link";
import type { ReactNode } from "react";
import { formatDuration, formatTime } from "@/lib/format";
import type { Postmortem } from "@/lib/types";
import { SevBadge } from "./chrome";
import { IconArrow } from "./icons";
import { PostmortemCard } from "./postmortem-board";

export function PostmortemView({ pm }: { pm: Postmortem }) {
  return (
    <article className="min-h-screen bg-bg">
      <header className="border-b border-line bg-bg-2 px-4 py-3">
        <Link href={`/incidents/${pm.incidentId}`} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
          <IconArrow />
          War room
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-medium tracking-tight">
            {pm.incidentId} post-incident analysis
          </h1>
          <SevBadge severity={pm.severity} />
          <span className="mono text-[12px] text-muted">{pm.durationMin} min</span>
        </div>
        <p className="mt-1 text-sm text-muted">{pm.title}</p>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <PostmortemCard pm={pm} />

        <section>
          <h2 className="kicker mb-3">Pipeline</h2>
          <ol className="space-y-2">
            {pm.stages.map((stage) => (
              <li key={stage.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>{stage.label}</span>
                <span className="mono text-[11px] uppercase text-faint">{stage.status}</span>
              </li>
            ))}
          </ol>
        </section>

        <Section title="Root cause">{pm.rootCause}</Section>
        <Section title="Detection">{pm.detection}</Section>
        <Section title="Response">{pm.response}</Section>
        <Section title="Impact">{pm.impact}</Section>

        {pm.contributing.length > 0 && (
          <section>
            <h2 className="kicker mb-3">Contributing factors</h2>
            <ul className="space-y-2 text-[13px] text-muted">
              {pm.contributing.map((factor) => (
                <li key={factor}>{factor}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="kicker mb-3">Timeline</h2>
          <ol className="space-y-2">
            {pm.timeline.map((ev) => (
              <li key={ev.id} className="text-[13px]">
                <span className="mono text-[11px] text-faint">{formatTime(ev.ts)}</span>{" "}
                {ev.title}
                {ev.detail ? <div className="text-[12px] text-muted">{ev.detail}</div> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="kicker mb-3">What went well</h2>
            <ul className="space-y-2 text-[13px] text-muted">
              {pm.wentWell.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="kicker mb-3">What went poorly</h2>
            <ul className="space-y-2 text-[13px] text-muted">
              {pm.wentPoorly.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <p className="text-[12px] text-faint">
          Compiled from detection, investigation, RCA, blast radius, and remediation — not an LLM asked to
          write a postmortem. {formatDuration(pm.durationMin * 60_000)} on the card.
        </p>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-2">{title}</h2>
      <p className="text-[14px] leading-6 text-ink/90">{children}</p>
    </section>
  );
}
