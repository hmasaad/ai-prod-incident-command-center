"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DEPLOY_AT } from "@/lib/clock";
import type { Recommendation } from "@/lib/engine/recommend";
import { formatDuration, formatNumber, formatPct, formatTime } from "@/lib/format";
import { isClosed } from "@/lib/platform/machine";
import type { ActionType, Incident, WorldState } from "@/lib/types";
import { ConfidenceBar, HealthDot, MetricChart, SevBadge, StatusBadge, TopBar } from "./chrome";
import { DetectionBoard } from "./detection-board";
import { InvestigationBoard } from "./investigation-board";
import { CommsBoard } from "./comms-board";
import { RcaBoard } from "./rca-board";
import { MemoryBoard } from "./memory-board";
import { BlastBoard } from "./blast-board";
import { RemediationBoard } from "./remediation-board";
import { PostmortemBoard } from "./postmortem-board";
import { SecurityBoard } from "./security-board";
import { HumanLoopBoard } from "./human-loop-board";
import { PipelineBoard } from "./pipeline-board";
import { StateMachineBoard } from "./state-machine-board";
import { EvalBoard } from "./eval-board";
import { AutonomyBoard } from "./autonomy-board";
import { StackBoard } from "./stack-board";
import { IconArrow, IconGit, IconUsers } from "./icons";
import { runAction } from "./use-command-state";

export function WarRoom({
  state,
  incident,
  rec,
}: {
  state: WorldState;
  incident: Incident;
  rec: Recommendation | null;
}) {
  const [busy, setBusy] = useState<ActionType | null>(null);
  const spark = state.metrics.filter((m) => m.ts >= DEPLOY_AT - 25 * 60_000);
  const deploy = state.deployments.find((d) => d.id === "dep-payments-2814");
  const openCount = state.incidents.filter((i) => !isClosed(i.status)).length;
  const machineState = incident.machine?.state ?? incident.status;

  async function fire(type: ActionType) {
    setBusy(type);
    try {
      await runAction(incident.id, type);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <TopBar now={state.now} region={state.region} openCount={openCount} onCall={state.onCall} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
            <IconArrow />
            Command center
          </Link>
          <span className="mono text-sm">{incident.id}</span>
          <SevBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
          <span className="text-sm">{incident.title}</span>
        </div>
        <div className="mono text-[12px] text-muted">{formatDuration(state.now - incident.startedAt)} open</div>
      </div>

      {incident.humanLoop && (
        <HumanLoopBoard
          brief={incident.humanLoop}
          busy={busy !== null}
          onApprove={
            incident.humanLoop.awaiting
              ? () => void fire(incident.humanLoop.actionType)
              : undefined
          }
          onReject={
            machineState === "REMEDIATION_PENDING" && !incident.remediation?.approved
              ? () => void fire("reject_remediation")
              : undefined
          }
        />
      )}

      {state.pipeline && state.pipeline.incidentId === incident.id && (
        <PipelineBoard pipeline={state.pipeline} />
      )}

      {state.stack && <StackBoard stack={state.stack} compact />}

      {state.autonomy && <AutonomyBoard report={state.autonomy} compact />}

      {state.evals && <EvalBoard report={state.evals} compact />}

      {state.pipeline?.security && <SecurityBoard security={state.pipeline.security} />}

      {incident.detection && <DetectionBoard detection={incident.detection} />}

      <InvestigationBoard investigation={incident.investigation} incidentId={incident.id} />

      {incident.comms && <CommsBoard comms={incident.comms} />}

      {incident.rca && <RcaBoard rca={incident.rca} />}

      {incident.memory && <MemoryBoard memory={incident.memory} />}

      {incident.blast && <BlastBoard blast={incident.blast} />}

      {incident.remediation && (
        <RemediationBoard
          remediation={incident.remediation}
          busy={busy !== null}
          onApprove={
            machineState === "REMEDIATION_PENDING"
              ? () => void fire(incident.remediation.actionType)
              : undefined
          }
          onReject={
            machineState === "REMEDIATION_PENDING" && !incident.remediation.approved
              ? () => void fire("reject_remediation")
              : undefined
          }
        />
      )}

      {incident.postmortem && <PostmortemBoard postmortem={incident.postmortem} />}

      <StateMachineBoard incident={incident} />

      <section className="grid gap-0 border-b border-line lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="kicker mb-2">Commander brief</div>
          <h1 className="text-xl font-medium tracking-tight">{incident.impact}</h1>
          <p className="mt-2 max-w-3xl text-[13px] leading-5 text-muted">{incident.investigation.summary}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
            <Meta label="Affected" value={(incident.blast?.services.filter((s) => s.mark === "affected").map((s) => s.name) ?? incident.affectedServiceIds.map(pretty)).join(", ")} />
            <Meta label="Started" value={formatTime(incident.startedAt)} />
            <Meta label="Likely cause" value={incident.investigation.likelyCause} />
            <Meta label="Blast radius" value={`~${formatNumber(incident.blast?.users ?? incident.investigation.blastRadius.users)} users`} />
          </dl>
        </div>
        <div className="bg-panel p-4">
          <div className="kicker mb-2">Recommended action</div>
          <div className="text-sm font-medium">{rec?.label ?? incident.investigation.recommendedAction}</div>
          <p className="mt-1 text-[12px] text-muted">{rec?.detail}</p>
          <div className="mt-3">
            <div className="kicker mb-1">Confidence</div>
            <ConfidenceBar value={incident.investigation.confidence} />
          </div>
          {machineState === "REMEDIATION_PENDING" && (
            <p className="mt-4 border border-line px-3 py-2 text-[12px] text-muted">
              Playbook is waiting on the remediation agent above. The agent will not execute until
              you approve.
            </p>
          )}
          {(machineState === "NEED_HUMAN_INPUT" || machineState === "ESCALATED") && (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={busy !== null}
                className="w-full border border-sev2 bg-sev2/10 px-3 py-2 text-[12px] text-sev2"
                onClick={() => void fire("provide_input")}
              >
                {busy === "provide_input" ? "Attaching…" : rec?.label ?? "Attach missing evidence"}
              </button>
              {machineState === "NEED_HUMAN_INPUT" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  className="w-full border border-line px-3 py-2 text-[12px] text-muted"
                  onClick={() => void fire("escalate")}
                >
                  {busy === "escalate" ? "Escalating…" : "Escalate"}
                </button>
              )}
            </div>
          )}
          {machineState === "REMEDIATING" && (
            <p className="mt-4 border border-line px-3 py-2 text-[12px] text-muted">
              Remediation in flight. Machine advances to VERIFYING when the change lands — agents
              resume from checkpoints, they do not re-run from scratch.
            </p>
          )}
          {machineState === "VERIFYING" && (
            <>
              <p className="mt-4 border border-line px-3 py-2 text-[12px] text-muted">
                Verification owns recovery. The autonomous commander will declare RESOLVED when
                error rate is back under baseline.
              </p>
              <button
                type="button"
                disabled={busy !== null}
                className="mt-4 w-full border border-ok px-3 py-2 text-[12px] text-ok"
                onClick={() => void fire("resolve")}
              >
                Resolve incident
              </button>
            </>
          )}
          {isClosed(machineState) && (
            <Link
              href={`/incidents/${incident.id}/postmortem`}
              className="mt-4 block border border-line px-3 py-2 text-center text-[12px]"
            >
              Open post-incident analysis
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-0 border-b border-line lg:grid-cols-2">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="mb-1 flex justify-between">
            <span className="kicker">Error rate %</span>
            <span className="mono text-[11px] text-muted">
              {formatPct(spark.at(-1)?.errorRate ?? 0)}
            </span>
          </div>
          <MetricChart
            points={spark.map((m) => ({ ts: m.ts, value: m.errorRate }))}
            markerTs={DEPLOY_AT}
            markerLabel="v2.8.14"
          />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniChart
              label="Latency p95"
              color="var(--sev2)"
              points={spark.map((m) => ({ ts: m.ts, value: m.latencyP95 }))}
            />
            <MiniChart
              label="DB connections"
              color="var(--info)"
              points={spark.map((m) => ({ ts: m.ts, value: m.dbConnections }))}
            />
            <MiniChart
              label="DB CPU %"
              color="var(--sev3)"
              points={spark.map((m) => ({ ts: m.ts, value: m.dbCpu }))}
            />
            <MiniChart
              label="Crash rate"
              color="var(--sev1)"
              points={spark.map((m) => ({ ts: m.ts, value: m.crashRate }))}
            />
          </div>
        </div>
        <div className="p-4">
          <div className="kicker mb-3">RCA candidates</div>
          <ul className="space-y-3">
            {(incident.rca?.candidates ?? []).map((row, idx) => (
              <li key={row.id} className="border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px]">
                    {idx + 1}. {row.candidate}
                  </span>
                  <span className="mono text-[11px] text-muted">{(row.probability * 100).toFixed(0)}%</span>
                </div>
                <div className="mt-1.5">
                  <ConfidenceBar value={row.probability} />
                </div>
                <p className="mt-2 text-[12px] text-muted">{row.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-0 border-b border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="kicker mb-3">Timeline</div>
          <ol className="space-y-3">
            {[...incident.timeline].sort((a, b) => b.ts - a.ts).map((ev) => (
              <li key={ev.id} className="text-[12px]">
                <div className="mono text-[10px] text-faint">
                  {formatTime(ev.ts)} · {ev.kind} {ev.actor ? `· ${ev.actor}` : ""}
                </div>
                <div>{ev.title}</div>
                <div className="text-muted">{ev.detail}</div>
              </li>
            ))}
          </ol>
        </div>
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="kicker mb-3">Blast radius</div>
          <p className="text-[13px] leading-5">{incident.blast?.answer ?? incident.investigation.blastRadius.description}</p>
          <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            <IconUsers />
            {formatNumber(incident.blast?.users ?? incident.investigation.blastRadius.users)} {incident.blast?.segment ? incident.blast.segment.toLowerCase() : "users"} ·{" "}
            {(incident.blast?.regions.filter((r) => r.mark === "affected").map((r) => r.name) ?? incident.investigation.blastRadius.regions).join(", ")}
            {(incident.blast?.revenuePath ?? incident.investigation.blastRadius.revenuePath) ? " · revenue path" : ""}
          </div>
          <div className="mt-4 kicker mb-2">Correlations</div>
          <ul className="space-y-2">
            {incident.investigation.correlations.map((c) => (
              <li key={c.id} className="text-[12px]">
                <div>
                  {c.left} → {c.right}
                  <span className="mono ml-2 text-faint">{Math.round(c.strength * 100)}%</span>
                </div>
                <div className="text-muted">{c.note}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4">
          <div className="kicker mb-3">Coordinate</div>
          {(["human", "service"] as const).map((kind) => (
            <div key={kind} className="mb-3">
              <div className="kicker mb-1">{kind}s</div>
              <ul className="space-y-1">
                {incident.actors
                  .filter((a) => a.kind === kind)
                  .map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span>
                        {a.name}
                        <span className="text-faint"> · {a.role}</span>
                      </span>
                      <span className="text-muted">{a.status}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p className="mb-3 text-[11px] text-muted">
            Agents live in the platform pipeline above — detection, investigation, comms, and
            memory run in parallel; root cause through postmortem is serial.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {incident.id === "INC-4821" && (
              <>
                <GhostAction disabled={busy !== null} onClick={() => void fire("page_oncall")}>
                  Page on-call
                </GhostAction>
                <GhostAction disabled={busy !== null} onClick={() => void fire("open_channel")}>
                  Open #inc-4821
                </GhostAction>
                <GhostAction disabled={busy !== null} onClick={() => void fire("scale_pool")}>
                  Raise pool cap
                </GhostAction>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-0 lg:grid-cols-2">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="kicker mb-3">Change inspection</div>
          {deploy && (
            <div className="text-[12px]">
              <div className="flex items-center gap-2">
                <IconGit />
                <span className="mono">{deploy.commit}</span>
                <span>
                  {deploy.version} · {deploy.status}
                </span>
              </div>
              <div className="mt-1">
                {deploy.author} · {deploy.message}
              </div>
              <ul className="mt-2 mono text-[11px] text-muted">
                {deploy.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="kicker mb-2 mt-4">Evidence</div>
          <ul className="space-y-2">
            {incident.investigation.evidence.map((e) => (
              <li key={e.id} className="text-[12px]">
                <span className="mono text-[10px] text-faint">{e.source}</span> {e.title}
                <div className="text-muted">{e.detail}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4">
          <div className="kicker mb-3">Logs</div>
          <ul className="space-y-1.5 font-mono text-[11px]">
            {state.logs.slice(-14).reverse().map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="text-faint">{formatTime(l.ts)}</span>
                <span className={l.level === "error" || l.level === "fatal" ? "text-sev1" : "text-muted"}>
                  {l.level}
                </span>
                <span className="text-faint">{pretty(l.serviceId)}</span>
                <span>{l.message}</span>
              </li>
            ))}
          </ul>
          <div className="kicker mb-2 mt-4">Service health</div>
          <ul className="grid grid-cols-2 gap-1.5">
            {state.services.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[12px]">
                <HealthDot health={s.health} />
                {s.name}
                <span className="ml-auto mono text-[10px] text-faint">{s.version}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="kicker mb-0.5">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function MiniChart({
  label,
  points,
  color,
}: {
  label: string;
  points: { ts: number; value: number }[];
  color: string;
}) {
  return (
    <div>
      <div className="kicker mb-1">{label}</div>
      <MetricChart points={points} color={color} markerTs={DEPLOY_AT} />
    </div>
  );
}

function GhostAction({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="border border-line px-2.5 py-1.5 text-[11px] text-muted hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function pretty(id: string) {
  return id
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bApi\b/g, "API")
    .replace(/\bDb\b/g, "db");
}
