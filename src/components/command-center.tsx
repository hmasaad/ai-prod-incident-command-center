"use client";

import Link from "next/link";
import { DEPLOY_AT } from "@/lib/clock";
import { isClosed } from "@/lib/platform/machine";
import { formatDelta, formatDuration, formatNumber, formatPct, formatTime } from "@/lib/format";
import type { WorldState } from "@/lib/types";
import { ConfidenceBar, HealthDot, MetricChart, SevBadge, StatusBadge, TopBar } from "./chrome";
import { DetectionBoard } from "./detection-board";
import { IconBolt } from "./icons";
import { PipelineBoard } from "./pipeline-board";
import { StateMachineBoard } from "./state-machine-board";
import { resetWorld } from "./use-command-state";

export function CommandCenter({ state }: { state: WorldState }) {
  const open = state.incidents.filter((i) => !isClosed(i.status));
  const primary = state.incidents.find((i) => i.id === "INC-4821") ?? state.incidents[0];
  const last = state.metrics[state.metrics.length - 1];
  const spark = state.metrics.filter((m) => m.ts >= DEPLOY_AT - 25 * 60_000);

  return (
    <div className="min-h-screen bg-bg">
      <TopBar
        now={state.now}
        region={state.region}
        openCount={open.length}
        onCall={state.onCall}
      />

      <section className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
        <FleetCell label="HTTP 500" value={formatDelta(state.fleet.http500DeltaPct)} hot={state.fleet.http500DeltaPct > 50} />
        <FleetCell label="API latency" value={formatDelta(state.fleet.latencyDeltaPct)} hot={state.fleet.latencyDeltaPct > 50} />
        <FleetCell label="Database connections" value={formatDelta(state.fleet.dbConnDeltaPct)} hot={state.fleet.dbConnDeltaPct > 40} />
        <FleetCell label="Crash rate" value={formatDelta(state.fleet.crashDeltaPct)} hot={state.fleet.crashDeltaPct > 50} />
      </section>

      {state.pipeline && (
        <div className="border-b border-line">
          <PipelineBoard pipeline={state.pipeline} compact />
        </div>
      )}

      {primary?.detection && (
        <div className="border-b border-line">
          <DetectionBoard detection={primary.detection} />
        </div>
      )}

      {primary && (
        <div className="border-b border-line">
          <StateMachineBoard incident={primary} compact />
        </div>
      )}

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="kicker">Open incidents</span>
            <button
              type="button"
              className="kicker hover:text-ink"
              onClick={() => void resetWorld()}
            >
              Reset simulation
            </button>
          </div>
          <div className="divide-y divide-line">
            {state.incidents.map((inc) => (
              <Link
                key={inc.id}
                href={`/incidents/${inc.id}`}
                className="block px-4 py-3 hover:bg-panel"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[12px] text-muted">{inc.id}</span>
                    <SevBadge severity={inc.severity} />
                    <StatusBadge status={inc.status} />
                  </div>
                  <span className="mono text-[11px] text-faint">
                    {isClosed(inc.status)
                      ? "closed"
                      : formatDuration(state.now - inc.startedAt)}
                  </span>
                </div>
                <div className="mt-1 text-sm">{inc.title}</div>
                <div className="mt-1 text-[12px] text-muted">
                  {inc.impact}
                  {inc.investigation.likelyCause ? ` · ${inc.investigation.likelyCause}` : ""}
                  {inc.investigation.confidence
                    ? ` · ${(inc.investigation.confidence * 100).toFixed(0)}%`
                    : ""}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {primary && (
          <div className="bg-panel">
            <div className="border-b border-line px-4 py-2">
              <span className="kicker">Commander brief · {primary.id}</span>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SevBadge severity={primary.severity} />
                <span className="text-sm font-medium">{primary.impact}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <BriefRow label="Affected" value={primary.affectedServiceIds.map(prettyService).join(", ")} />
                <BriefRow label="Started" value={formatTime(primary.startedAt)} />
                <BriefRow label="Likely cause" value={primary.investigation.likelyCause} />
                <BriefRow label="Blast radius" value={`~${formatNumber(primary.investigation.blastRadius.users)} users`} />
                <BriefRow label="Recommended" value={primary.investigation.recommendedAction} />
                <div>
                  <div className="kicker mb-1">Confidence</div>
                  <ConfidenceBar value={primary.investigation.confidence} />
                </div>
              </dl>
              <p className="text-[13px] leading-5 text-muted">{primary.investigation.summary}</p>
              <Link
                href={`/incidents/${primary.id}`}
                className="inline-flex items-center gap-2 border border-sev1 bg-sev1/10 px-3 py-2 text-[12px] text-sev1"
              >
                <IconBolt />
                Open war room
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className="grid border-t border-line lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)_minmax(280px,0.8fr)]">
        <section className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="kicker">Error rate · last 90m</span>
            <span className="mono text-[11px] text-muted">{formatPct(last?.errorRate ?? 0)}</span>
          </div>
          <MetricChart
            points={spark.map((m) => ({ ts: m.ts, value: m.errorRate }))}
            markerTs={DEPLOY_AT}
            markerLabel="v2.8.14"
          />
        </section>

        <section className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="kicker mb-3">Service map</div>
          <div className="space-y-2">
            {(["edge", "gateway", "api", "data", "async"] as const).map((layer) => (
              <div key={layer} className="flex flex-wrap items-center gap-1.5">
                <span className="kicker w-16">{layer}</span>
                {state.services
                  .filter((s) => s.layer === layer)
                  .map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 border border-line px-1.5 py-1 text-[11px]"
                    >
                      <HealthDot health={s.health} />
                      {s.name}
                    </span>
                  ))}
              </div>
            ))}
          </div>
        </section>

        <section className="p-4">
          <div className="kicker mb-3">Detection stream</div>
          <ul className="space-y-2">
            {state.alerts.map((ev) => (
              <li key={ev.id} className="text-[12px]">
                <div className="mono text-[10px] text-faint">{formatTime(ev.ts)}</div>
                <div>{ev.title}</div>
                <div className="text-muted">{ev.detail}</div>
              </li>
            ))}
            {state.deployments.slice(0, 2).map((d) => (
              <li key={d.id} className="text-[12px]">
                <div className="mono text-[10px] text-faint">{formatTime(d.completedAt)}</div>
                <div>
                  Deploy {d.version} · {prettyService(d.serviceId)}
                </div>
                <div className="text-muted">
                  {d.author} · {d.commit} · {d.status}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FleetCell({ label, value, hot }: { label: string; value: string; hot: boolean }) {
  return (
    <div className="border-b border-r border-line px-4 py-3 last:border-r-0">
      <div className="kicker">{label}</div>
      <div className={`mt-1 font-mono text-2xl tracking-tight ${hot ? "text-sev1" : "text-ok"}`}>
        {value}
      </div>
    </div>
  );
}

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="kicker mb-0.5">{label}</div>
      <div className="text-[12px]">{value}</div>
    </div>
  );
}

function prettyService(id: string) {
  return id
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bApi\b/g, "API")
    .replace(/\bDb\b/g, "db");
}
