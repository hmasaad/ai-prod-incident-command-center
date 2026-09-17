import { investigate } from "../engine/correlate";
import { detectIncident, latestMetrics } from "../engine/detect";
import { buildPostmortem } from "../engine/postmortem";
import { recommend, type Recommendation } from "../engine/recommend";
import type {
  ActionType,
  Actor,
  Deployment,
  GatewayEvent,
  Incident,
  LogEvent,
  MetricSample,
  PipelineSnapshot,
  Postmortem,
  Service,
} from "../types";
import { activeStage, runAgents } from "./agents";

export interface EvaluateInput {
  now: number;
  incident: Incident;
  services: Service[];
  metrics: MetricSample[];
  deployments: Deployment[];
  logs: LogEvent[];
  onCall: { primary: string; comms: string };
  ingest: GatewayEvent[];
  lastHumanAction?: ActionType;
}

export interface Evaluation {
  investigation: Incident["investigation"];
  recommendation: Recommendation;
  pipeline: PipelineSnapshot;
  agentActors: Actor[];
  postmortem: Postmortem | null;
}

export function evaluateIncident(input: EvaluateInput): Evaluation {
  const analysis = investigate({
    now: input.now,
    services: input.services,
    metrics: input.metrics,
    deployments: input.deployments,
    logs: input.logs,
    affectedServiceIds: input.incident.affectedServiceIds,
    rollbackApplied: input.incident.rollbackApplied,
    mitigationApplied: input.incident.mitigationApplied,
  });

  const detection = detectIncident({
    incidentId: input.incident.id,
    now: input.now,
    metrics: input.metrics,
    logs: input.logs,
    deployments: input.deployments,
    services: input.services,
    rollbackApplied: input.incident.rollbackApplied,
    closed: input.incident.status === "RESOLVED" || input.incident.status === "POSTMORTEM",
  });

  const agents = runAgents({
    now: input.now,
    incident: input.incident,
    services: input.services,
    metrics: input.metrics,
    deployments: input.deployments,
    logs: input.logs,
    onCall: input.onCall,
    analysis,
    detection,
    lastHumanAction: input.lastHumanAction,
  });

  const rec = recommend(input.incident, analysis);
  const err = latestMetrics(input.metrics).errorRate;
  const stage = activeStage(agents);
  const blocked = agents.find((a) => a.id === "remediation");

  const pipeline: PipelineSnapshot = {
    incidentId: input.incident.id,
    activeStage: stage,
    gateway: {
      title: "Incident Gateway",
      summary: `Normalized ${input.ingest[0]?.source ?? "metrics"} · last: ${input.ingest[0]?.title ?? "telemetry tick"} (${err.toFixed(1)}% failing).`,
    },
    orchestrator: {
      title: "Incident Orchestrator",
      summary: `Machine ${input.incident.machine.state}. Wave 1 parallel (detect · investigate · comms). Wave 2 serial through ${stage}. ${blocked?.status === "blocked" ? "Remediation waiting on commander." : "Pipeline live."}`,
    },
    agents,
    ingest: input.ingest,
    detection,
  };

  const agentActors: Actor[] = agents.map((a) => ({
    id: `agent-${a.id}`,
    kind: "agent",
    name: a.name.replace(" Agent", ""),
    role: a.role,
    status: a.summary,
  }));

  return {
    investigation: analysis,
    recommendation: rec,
    pipeline,
    agentActors,
    postmortem:
      input.incident.status === "RESOLVED" || input.incident.status === "POSTMORTEM"
        ? buildPostmortem(input.incident, input.now)
        : null,
  };
}
